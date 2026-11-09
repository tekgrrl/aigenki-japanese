import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { StatsService } from '../stats/stats.service';
import { Firestore } from 'firebase-admin/firestore';
import {
  FIRESTORE_CONNECTION,
  LESSONS_COLLECTION,
  QUESTIONS_COLLECTION,
  QUESTION_STATES_SUBCOLLECTION,
  CONCEPTS_COLLECTION,
  Timestamp,
  FieldValue,
} from '../firebase/firebase.module';
import { ReviewFacet, QuestionItem, UserQuestionState, ConceptKnowledgeUnit, Lesson, VocabUsage } from '@/types';
import { usagesOf } from '../lessons/vocab-usages';
import { GeminiService } from '../gemini/gemini.service';
import { FacetStore } from '../facets/facet-store';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import {
  VOCAB_QUESTION_OPTIONS,
  buildVocabQuestionPrompt,
  buildVocabQuestionUserMessage,
  pickRandomQuestionType,
  NOUN_QUESTION_OPTIONS,
  buildNounParticleQuestionPrompt,
  NOUN_PARTICLE_FEW_SHOT_TURNS,
  CONCEPT_QUESTION_OPTIONS,
  buildConceptQuestionPrompt,
  ConceptMechanic,
  GRAMMAR_QUESTION_OPTIONS,
  buildGrammarQuestionPrompt,
  GrammarQuestionType,
} from '../prompts/quiz.prompts';
import { GET_USER_LEVEL_DECLARATION, JlptLevel } from '../prompts/curriculum';

const SUITABLE_RANK_THRESHOLD = 30;
const RANK_CORRECT_DELTA = 5;
const RANK_KEEP_DELTA = 5;
const RANK_REPORT_DELTA = -25;
const MAX_CONSECUTIVE_FAILURES = 3;

type QuestionResponse = {
  question: string;
  context: string | undefined;
  answer: string;
  accepted_alternatives: string[] | undefined;
  questionId: string;
  isNew: boolean;
  /** Vocab: the usage the question tests, if known. */
  usageId?: string;
};

/** A Vocab usage to ask about, and whether it's the word's only usage (then older, usage-less questions fit too). */
type TargetUsage = { usage: VocabUsage; only: boolean };

@Injectable()
export class QuestionsService {
  private readonly logger = new Logger(QuestionsService.name);

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly geminiService: GeminiService,
    private readonly facetStore: FacetStore,
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
    private readonly statsService: StatsService,
  ) {}

  private questionStatesRef(uid: string) {
    return this.db.collection('users').doc(uid).collection(QUESTION_STATES_SUBCOLLECTION);
  }

  private toResponse(question: QuestionItem, isNew: boolean): QuestionResponse {
    return {
      question: question.data.question,
      context: question.data.context,
      answer: question.data.answer,
      accepted_alternatives: question.data.acceptedAlternatives,
      questionId: question.id,
      isNew,
      ...(question.usageId ? { usageId: question.usageId } : {}),
    };
  }

  async testConnection() {
    const snapshot = await this.db.collection(QUESTIONS_COLLECTION).limit(1).get();
    this.logger.log(`Found ${snapshot.size} questions`);
  }

  /**
   * `usageId`: a Vocab meaning card shown as an AI question asks about one usage; only
   * questions for that usage are reused, and a new one is generated for it.
   */
  async selectQuestion(uid: string, kuId: string, facetId: string, topic: string, usageId?: string): Promise<QuestionResponse> {
    if (!topic) throw new BadRequestException('Topic is required');

    const target = usageId ? await this.targetUsage(kuId, usageId) : null;
    const fits = (q: { usageId?: string }) => !target || q.usageId === target.usage.id || (!q.usageId && target.only);

    const facetData = facetId
      ? await this.facetStore.get(uid, facetId)
      : null;

    // The facet can be gone if it was deleted mid-session (e.g. an admin regenerate-and-reset).
    // Fail cleanly instead of generating a question and then crashing on the facet write.
    if (facetId && !facetData) throw new NotFoundException(`Facet ${facetId} not found`);

    // 1. Try to reuse the question already on the facet
    if (facetData?.currentQuestionId) {
      const reused = await this.tryReuseQuestion(uid, facetData.currentQuestionId);
      if (reused && fits(reused)) {
        this.logger.log(`Reusing question ${facetData.currentQuestionId} for facet ${facetId}`);
        return reused;
      }
    }

    // 2. Find another suitable question from the global corpus
    const suitable = await this.findSuitableQuestion(uid, kuId, facetData?.currentQuestionId, fits);
    if (suitable) {
      this.logger.log(`Found suitable question ${suitable.questionId} for KU ${kuId}`);
      if (facetId) await this.facetStore.updateQuestion(uid, facetId, suitable.questionId);
      return suitable;
    }

    // 3. Generate a new question via AI
    this.logger.log(`No suitable questions for KU ${kuId} — generating new one`);
    return this.generateAndSave(uid, topic, kuId, facetId, undefined, target?.usage);
  }

  /** The usage a meaning card asks about, from the word's lesson; null if it no longer exists. */
  private async targetUsage(kuId: string, usageId: string): Promise<TargetUsage | null> {
    const lesson = (await this.db.collection(LESSONS_COLLECTION).doc(kuId).get()).data() as Lesson | undefined;
    if (lesson?.type !== 'Vocab') return null;
    const usages = usagesOf(lesson);
    const usage = usages.find(u => u.id === usageId);
    return usage ? { usage, only: usages.length === 1 } : null;
  }

  private async tryReuseQuestion(uid: string, questionId: string): Promise<QuestionResponse | null> {
    const [questionDoc, stateDoc] = await Promise.all([
      this.db.collection(QUESTIONS_COLLECTION).doc(questionId).get(),
      this.questionStatesRef(uid).doc(questionId).get(),
    ]);

    if (!questionDoc.exists) return null;

    const question = { id: questionDoc.id, ...questionDoc.data() } as QuestionItem;
    const state = stateDoc.exists ? stateDoc.data() as UserQuestionState : null;

    const rank = question.rank ?? 50;
    if (
      !state?.rejected &&
      rank >= SUITABLE_RANK_THRESHOLD &&
      (state?.consecutiveFailures ?? 0) < MAX_CONSECUTIVE_FAILURES
    ) {
      return this.toResponse(question, !stateDoc.exists);
    }

    return null;
  }

  private async findSuitableQuestion(
    uid: string,
    kuId: string,
    excludeId?: string,
    fits: (q: QuestionItem) => boolean = () => true,
  ): Promise<QuestionResponse | null> {
    const snapshot = await this.db.collection(QUESTIONS_COLLECTION)
      .where('kuId', '==', kuId)
      .get();

    if (snapshot.empty) return null;

    const candidates = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() } as QuestionItem))
      .filter(q => q.id !== excludeId && (q.rank ?? 50) >= SUITABLE_RANK_THRESHOLD && fits(q));

    if (candidates.length === 0) return null;

    const stateDocs = await Promise.all(
      candidates.map(q => this.questionStatesRef(uid).doc(q.id).get())
    );

    for (let i = 0; i < candidates.length; i++) {
      const question = candidates[i];
      const stateDoc = stateDocs[i];
      const state = stateDoc.exists ? stateDoc.data() as UserQuestionState : null;

      if (state?.rejected) continue;
      if ((state?.consecutiveFailures ?? 0) >= MAX_CONSECUTIVE_FAILURES) continue;

      return this.toResponse(question, !stateDoc.exists);
    }

    return null;
  }

  private async generateAndSave(uid: string, topic: string, kuId: string, facetId?: string, mechanicData?: ConceptMechanic, usage?: VocabUsage): Promise<QuestionResponse> {
    if (mechanicData) {
      return this.generateConceptQuestion(uid, mechanicData, kuId, facetId);
    }

    if (kuId) {
      // Check knowledge-units collection first
      try {
        const kuData = await this.knowledgeUnitsService.findOne(kuId);
        if (kuData.type === 'Grammar') {
          this.logger.log(`Routing Grammar KU ${kuId} to grammar question path`);
          return this.generateGrammarQuestion(uid, kuData.content, kuData.data.title ?? kuData.content, kuId, facetId);
        }
        if (kuData.type === 'Concept' && kuData.data.mechanics?.length > 0) {
          const mechanic = kuData.data.mechanics[Math.floor(Math.random() * kuData.data.mechanics.length)];
          this.logger.log(`Routing concept KU ${kuId} to concept question path (mechanic: "${mechanic.goalTitle}")`);
          return this.generateConceptQuestion(uid, mechanic, kuId, facetId);
        }
      } catch {
        // Not in knowledge-units — try the concepts collection
      }

      // Concept KUs live in their own collection
      const conceptDoc = await this.db.collection(CONCEPTS_COLLECTION).doc(kuId).get();
      if (conceptDoc.exists) {
        const concept = conceptDoc.data() as ConceptKnowledgeUnit;
        if (concept.data?.mechanics?.length > 0) {
          const mechanic = concept.data.mechanics[Math.floor(Math.random() * concept.data.mechanics.length)];
          this.logger.log(`Routing concepts/${kuId} to concept question path (mechanic: "${mechanic.goalTitle}")`);
          return this.generateConceptQuestion(uid, mechanic, kuId, facetId);
        }
      }
    }

    return this.generateVocabQuestion(uid, topic, kuId, facetId, usage);
  }

  private buildLevelToolHandler(uid: string): Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> {
    return {
      get_user_level: async () => {
        const userDoc = await this.db.collection('users').doc(uid).get();
        const userData = userDoc.data() as any;
        const level = (userData?.preferences?.jlptLevel ?? 'N5') as JlptLevel;
        // Resolved from enrolled KU ids at call time — always current content + title.
        const allowedGrammar = await this.statsService.getAllowedGrammar(uid, userData);
        const excludedVocab: string[] = userData?.tutorContext?.excludedVocab ?? [];
        const excludedGrammar: string[] = userData?.tutorContext?.excludedGrammar ?? [];
        return { jlptLevel: level, allowedGrammar, excludedVocab, excludedGrammar };
      },
    };
  }

  private readonly questionResponseSchema = {
    type: 'OBJECT',
    properties: {
      question: { type: 'STRING' },
      context: { type: 'STRING' },
      answer: { type: 'STRING' },
      accepted_alternatives: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['question', 'answer'],
  };

  /** `usage`: ask about this usage's meaning (and store it on the question) instead of the KU's whole definition. */
  private async generateVocabQuestion(uid: string, topic: string, kuId: string, facetId?: string, usage?: VocabUsage): Promise<QuestionResponse> {
    let reading: string | undefined;
    let meaning: string | undefined;
    if (kuId) {
      try {
        const kuData = await this.knowledgeUnitsService.findOne(kuId);
        if (kuData.type === 'Vocab') {
          reading = kuData.data.reading;
          meaning = kuData.data.definition;
        } else if (kuData.type === 'Kanji') {
          meaning = kuData.data.meaning;
        }
      } catch {
        // concept IDs won't be in knowledge-units; proceed without enrichment
      }
    }
    if (usage) meaning = usage.meaning;

    const isVerb = meaning?.toLowerCase().trimStart().startsWith('to ') ?? false;
    this.logger.log(`Question type selection: kuId=${kuId} meaning="${meaning}" isVerb=${isVerb}`);

    let systemPrompt: string;
    let fewShotTurns: Array<{ user: string; model: string }> | undefined;
    if (isVerb) {
      systemPrompt = buildVocabQuestionPrompt(pickRandomQuestionType(VOCAB_QUESTION_OPTIONS));
    } else {
      const selectedType = pickRandomQuestionType(NOUN_QUESTION_OPTIONS);
      if (selectedType === 'noun-particle') {
        systemPrompt = buildNounParticleQuestionPrompt();
        fewShotTurns = NOUN_PARTICLE_FEW_SHOT_TURNS;
      } else {
        systemPrompt = buildVocabQuestionPrompt(selectedType);
      }
    }

    // Capture the level returned by the tool for use in the saved difficulty field
    let capturedLevel = 'N5';
    const toolHandlers = {
      ...this.buildLevelToolHandler(uid),
      get_user_level: async (args: Record<string, unknown>) => {
        const result = await this.buildLevelToolHandler(uid).get_user_level(args);
        capturedLevel = result.jlptLevel as string;
        return result;
      },
    };

    const userMessage = buildVocabQuestionUserMessage(topic, reading, meaning);
    const parsed = await this.geminiService.generateWithTools<{
      question: string;
      answer: string;
      context?: string;
      accepted_alternatives?: string[];
    }>(
      userMessage,
      systemPrompt,
      [GET_USER_LEVEL_DECLARATION],
      toolHandlers,
      this.questionResponseSchema,
      { route: '/questions/generate', topic: topic, kuId },
    );

    const ref = this.db.collection(QUESTIONS_COLLECTION).doc();
    const newQuestion: QuestionItem = {
      id: ref.id,
      kuId,
      sourceCollection: 'knowledge-units',
      ...(usage ? { usageId: usage.id } : {}),
      data: {
        question: parsed.question,
        context: parsed.context,
        answer: parsed.answer,
        acceptedAlternatives: parsed.accepted_alternatives,
        difficulty: `JLPT-${capturedLevel}` as import('@/types').LessonDifficulty,
      },
      rank: 50,
      rejectionCount: 0,
      createdAt: Timestamp.now(),
    };

    await ref.set(newQuestion);
    this.logger.log(`Saved new question ${ref.id} for KU ${kuId} (level: ${capturedLevel})`);

    if (facetId) {
      await this.facetStore.updateQuestion(uid, facetId, ref.id);
    }

    return this.toResponse(newQuestion, true);
  }

  private async generateGrammarQuestion(uid: string, pattern: string, title: string, kuId: string, facetId?: string): Promise<QuestionResponse> {
    const questionType = pickRandomQuestionType(GRAMMAR_QUESTION_OPTIONS) as GrammarQuestionType;
    const systemPrompt = buildGrammarQuestionPrompt(pattern, title, questionType);

    let capturedLevel = 'N5';
    const toolHandlers = {
      get_user_level: async (args: Record<string, unknown>) => {
        const result = await this.buildLevelToolHandler(uid).get_user_level(args);
        capturedLevel = result.jlptLevel as string;
        return result;
      },
    };

    const parsed = await this.geminiService.generateWithTools<{
      question: string;
      answer: string;
      context?: string;
      accepted_alternatives?: string[];
    }>(
      '',
      systemPrompt,
      [GET_USER_LEVEL_DECLARATION],
      toolHandlers,
      this.questionResponseSchema,
      { route: '/questions/generate', topic: pattern, kuId },
    );

    const ref = this.db.collection(QUESTIONS_COLLECTION).doc();
    const newQuestion: QuestionItem = {
      id: ref.id,
      kuId,
      sourceCollection: 'knowledge-units',
      data: {
        question: parsed.question,
        context: parsed.context,
        answer: parsed.answer,
        acceptedAlternatives: parsed.accepted_alternatives,
        difficulty: `JLPT-${capturedLevel}` as import('@/types').LessonDifficulty,
      },
      rank: 50,
      rejectionCount: 0,
      createdAt: Timestamp.now(),
    };

    await ref.set(newQuestion);
    this.logger.log(`Saved new grammar question ${ref.id} for KU ${kuId} (pattern: ${pattern}, level: ${capturedLevel})`);

    if (facetId) {
      await this.facetStore.updateQuestion(uid, facetId, ref.id);
    }

    return this.toResponse(newQuestion, true);
  }

  private async generateConceptQuestion(uid: string, mechanic: ConceptMechanic, kuId: string, facetId?: string): Promise<QuestionResponse> {
    const selectedType = pickRandomQuestionType(CONCEPT_QUESTION_OPTIONS);
    const systemPrompt = buildConceptQuestionPrompt(mechanic, selectedType);

    let capturedLevel = 'N5';
    const toolHandlers = {
      get_user_level: async (args: Record<string, unknown>) => {
        const result = await this.buildLevelToolHandler(uid).get_user_level(args);
        capturedLevel = result.jlptLevel as string;
        return result;
      },
    };

    const parsed = await this.geminiService.generateWithTools<{
      question: string;
      answer: string;
      context?: string;
      accepted_alternatives?: string[];
    }>(
      '',
      systemPrompt,
      [GET_USER_LEVEL_DECLARATION],
      toolHandlers,
      this.questionResponseSchema,
      { route: '/questions/generate', topic: mechanic.goalTitle, kuId },
    );

    const ref = this.db.collection(QUESTIONS_COLLECTION).doc();
    const newQuestion: QuestionItem = {
      id: ref.id,
      kuId,
      sourceCollection: 'concepts',
      data: {
        question: parsed.question,
        context: parsed.context,
        answer: parsed.answer,
        acceptedAlternatives: parsed.accepted_alternatives,
        difficulty: `JLPT-${capturedLevel}` as import('@/types').LessonDifficulty,
      },
      rank: 50,
      rejectionCount: 0,
      createdAt: Timestamp.now(),
    };

    await ref.set(newQuestion);
    this.logger.log(`Saved new concept question ${ref.id} for KU ${kuId} (mechanic: ${mechanic.goalTitle}, level: ${capturedLevel})`);

    if (facetId) {
      await this.facetStore.updateQuestion(uid, facetId, ref.id);
    }

    return this.toResponse(newQuestion, true);
  }

  async recordAnswer(uid: string, questionId: string, kuId: string, result: 'pass' | 'fail', facetType?: string) {
    const questionRef = this.db.collection(QUESTIONS_COLLECTION).doc(questionId);
    const stateRef = this.questionStatesRef(uid).doc(questionId);

    const batch = this.db.batch();

    if (result === 'pass') {
      batch.update(questionRef, { rank: FieldValue.increment(RANK_CORRECT_DELTA) });
      batch.set(stateRef, { questionId, consecutiveFailures: 0 }, { merge: true });
    } else {
      batch.set(stateRef, { questionId, consecutiveFailures: FieldValue.increment(1) }, { merge: true });
    }

    try {
      await batch.commit();
    } catch (err) {
      this.logger.error(`Failed to record answer for question ${questionId}`, err);
    }
  }

  /** Adds an AI-accepted answer to the question's alternatives so future attempts match locally. */
  async addAcceptedAlternative(questionId: string, answer: string): Promise<void> {
    await this.db.collection(QUESTIONS_COLLECTION).doc(questionId).update({
      'data.acceptedAlternatives': FieldValue.arrayUnion(answer),
    });
  }

  async recordFeedback(uid: string, questionId: string, feedback: 'keep' | 'request-new' | 'report') {
    const questionRef = this.db.collection(QUESTIONS_COLLECTION).doc(questionId);
    const doc = await questionRef.get();

    if (!doc.exists) throw new NotFoundException('Question not found');

    const stateRef = this.questionStatesRef(uid).doc(questionId);
    const batch = this.db.batch();

    switch (feedback) {
      case 'keep':
        batch.update(questionRef, { rank: FieldValue.increment(RANK_KEEP_DELTA) });
        break;
      case 'request-new':
        batch.update(questionRef, { rejectionCount: FieldValue.increment(1) });
        batch.set(stateRef, { rejected: true }, { merge: true });
        break;
      case 'report':
        batch.update(questionRef, { rank: FieldValue.increment(RANK_REPORT_DELTA) });
        break;
    }

    await batch.commit();
    this.logger.log(`Recorded feedback '${feedback}' for question ${questionId}`);
    return { questionId, feedback };
  }
}
