import { Injectable, Inject, Logger, forwardRef, NotFoundException, BadRequestException } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import {
  FIRESTORE_CONNECTION,
  QUESTIONS_COLLECTION,
  QUESTION_STATES_SUBCOLLECTION,
  CONCEPTS_COLLECTION,
  Timestamp,
  FieldValue,
} from '../firebase/firebase.module';
import { ReviewFacet, QuestionItem, UserQuestionState, ConceptKnowledgeUnit } from '@/types';
import { GeminiService } from '../gemini/gemini.service';
import { ReviewsService } from '../reviews/reviews.service';
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
} from '../prompts/quiz.prompts';

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
};

@Injectable()
export class QuestionsService {
  private readonly logger = new Logger(QuestionsService.name);

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly geminiService: GeminiService,
    @Inject(forwardRef(() => ReviewsService))
    private readonly reviewsService: ReviewsService,
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
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
    };
  }

  async testConnection() {
    const snapshot = await this.db.collection(QUESTIONS_COLLECTION).limit(1).get();
    this.logger.log(`Found ${snapshot.size} questions`);
  }

  async selectQuestion(uid: string, kuId: string, facetId: string, topic: string): Promise<QuestionResponse> {
    if (!topic) throw new BadRequestException('Topic is required');

    const facetData = facetId
      ? await this.reviewsService.getByFacetId(uid, facetId) as ReviewFacet | null
      : null;

    // 1. Try to reuse the question already on the facet
    if (facetData?.currentQuestionId) {
      const reused = await this.tryReuseQuestion(uid, facetData.currentQuestionId);
      if (reused) {
        this.logger.log(`Reusing question ${facetData.currentQuestionId} for facet ${facetId}`);
        return reused;
      }
    }

    // 2. Find another suitable question from the global corpus
    const suitable = await this.findSuitableQuestion(uid, kuId, facetData?.currentQuestionId);
    if (suitable) {
      this.logger.log(`Found suitable question ${suitable.questionId} for KU ${kuId}`);
      if (facetId) await this.reviewsService.updateFacetQuestion(uid, facetId, suitable.questionId);
      return suitable;
    }

    // 3. Generate a new question via AI
    this.logger.log(`No suitable questions for KU ${kuId} — generating new one`);
    return this.generateAndSave(uid, topic, kuId, facetId);
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

  private async findSuitableQuestion(uid: string, kuId: string, excludeId?: string): Promise<QuestionResponse | null> {
    const snapshot = await this.db.collection(QUESTIONS_COLLECTION)
      .where('kuId', '==', kuId)
      .get();

    if (snapshot.empty) return null;

    const candidates = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() } as QuestionItem))
      .filter(q => q.id !== excludeId && (q.rank ?? 50) >= SUITABLE_RANK_THRESHOLD);

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

  private async generateAndSave(uid: string, topic: string, kuId: string, facetId?: string, mechanicData?: ConceptMechanic): Promise<QuestionResponse> {
    if (mechanicData) {
      return this.generateConceptQuestion(uid, mechanicData, kuId, facetId);
    }

    if (kuId) {
      // Check knowledge-units collection first
      try {
        const kuData = await this.knowledgeUnitsService.findOne(kuId);
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

    return this.generateVocabQuestion(uid, topic, kuId, facetId);
  }

  private async generateVocabQuestion(uid: string, topic: string, kuId: string, facetId?: string): Promise<QuestionResponse> {
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

    const userMessage = buildVocabQuestionUserMessage(topic, reading, meaning);

    const questionString = await this.geminiService.generateQuestionAI(userMessage, systemPrompt, {}, fewShotTurns);

    if (!questionString) throw new Error('AI response was empty.');

    let parsed: { question: string; answer: string; context?: string; accepted_alternatives?: string[] };
    try {
      parsed = JSON.parse(questionString);
    } catch {
      throw new Error('Failed to parse AI JSON response');
    }

    const ref = this.db.collection(QUESTIONS_COLLECTION).doc();
    const newQuestion: QuestionItem = {
      id: ref.id,
      kuId,
      data: {
        question: parsed.question,
        context: parsed.context,
        answer: parsed.answer,
        acceptedAlternatives: parsed.accepted_alternatives,
        difficulty: 'JLPT-N5',
      },
      rank: 50,
      rejectionCount: 0,
      createdAt: Timestamp.now(),
    };

    await ref.set(newQuestion);
    this.logger.log(`Saved new question ${ref.id} for KU ${kuId}`);

    if (facetId) {
      await this.reviewsService.updateFacetQuestion(uid, facetId, ref.id);
    }

    return this.toResponse(newQuestion, true);
  }

  private async generateConceptQuestion(uid: string, mechanic: ConceptMechanic, kuId: string, facetId?: string): Promise<QuestionResponse> {
    const selectedType = pickRandomQuestionType(CONCEPT_QUESTION_OPTIONS);
    const systemPrompt = buildConceptQuestionPrompt(mechanic, selectedType);

    const questionString = await this.geminiService.generateQuestionAI('', systemPrompt, {});

    if (!questionString) throw new Error('AI response was empty.');

    let parsed: { question: string; answer: string; context?: string; accepted_alternatives?: string[] };
    try {
      parsed = JSON.parse(questionString);
    } catch {
      throw new Error('Failed to parse AI JSON response for concept question');
    }

    const ref = this.db.collection(QUESTIONS_COLLECTION).doc();
    const newQuestion: QuestionItem = {
      id: ref.id,
      kuId,
      data: {
        question: parsed.question,
        context: parsed.context,
        answer: parsed.answer,
        acceptedAlternatives: parsed.accepted_alternatives,
        difficulty: 'JLPT-N4',
      },
      rank: 50,
      rejectionCount: 0,
      createdAt: Timestamp.now(),
    };

    await ref.set(newQuestion);
    this.logger.log(`Saved new concept question ${ref.id} for KU ${kuId} (mechanic: ${mechanic.goalTitle})`);

    if (facetId) {
      await this.reviewsService.updateFacetQuestion(uid, facetId, ref.id);
    }

    return this.toResponse(newQuestion, true);
  }

  async recordAnswer(uid: string, questionId: string, kuId: string, result: 'pass' | 'fail', facetType?: string) {
    const questionRef = this.db.collection(QUESTIONS_COLLECTION).doc(questionId);
    const stateRef = this.questionStatesRef(uid).doc(questionId);

    const batch = this.db.batch();

    if (result === 'pass') {
      batch.update(questionRef, { rank: FieldValue.increment(RANK_CORRECT_DELTA) });
      batch.set(stateRef, { questionId, kuId, consecutiveFailures: 0 }, { merge: true });
    } else {
      batch.set(stateRef, { questionId, kuId, consecutiveFailures: FieldValue.increment(1) }, { merge: true });
    }

    try {
      await batch.commit();
    } catch (err) {
      this.logger.error(`Failed to record answer for question ${questionId}`, err);
    }
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
