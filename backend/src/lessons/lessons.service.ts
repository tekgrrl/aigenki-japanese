import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { FIRESTORE_CONNECTION, LESSONS_COLLECTION, KNOWLEDGE_UNITS_COLLECTION, REVIEW_FACETS_COLLECTION, USER_GRAMMAR_LESSONS_SUBCOLLECTION, USER_LESSONS_SUBCOLLECTION, FieldValue } from '../firebase/firebase.module';
import { Firestore, BulkWriter, Timestamp } from 'firebase-admin/firestore';
import { GeminiService } from '../gemini/gemini.service';
import { QuestionsService } from '../questions/questions.service';
import { KnowledgeUnit, Lesson, VocabLesson, KanjiLesson, GrammarLesson, GrammarKnowledgeUnit, UserGrammarLesson, UserRoot } from '../types';
import { performance } from 'perf_hooks';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { buildVocabLessonMessage, buildVocabCacheContext, buildKanjiLessonPrompt } from '../prompts/vocab.prompts';
import { GRAMMAR_INSTRUCTIONS, buildGrammarLessonMessage } from '../prompts/grammar.prompts';
import { ADMIN_USER_ID } from '../lib/constants';

@Injectable()
export class LessonsService {
  private readonly logger = new Logger(LessonsService.name);

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly geminiService: GeminiService,
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
  ) { }

  async generateLesson(uid: string, kuId: string, cachedContentName?: string) {
    this.logger.log(`in generateLesson(): kuId=${kuId}, cachedContentName=${cachedContentName}`);
    // 1. Fetch the KU
    const kuRef = this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(kuId);
    const kuDoc = await kuRef.get();
    if (!kuDoc.exists) {
      this.logger.error(`KnowledgeUnit ${kuId} not found`);
      return { error: "KnowledgeUnit not found" }; // TODO is this ok?
    }

    const ku = kuDoc.data() as KnowledgeUnit;

    const content = ku.content;

    const lessonDbRef = this.db.collection(LESSONS_COLLECTION).doc(kuId);
    const overlayRef = this.db.collection('users').doc(uid).collection(USER_LESSONS_SUBCOLLECTION).doc(kuId);

    // Check for lesson in 'lessons' collection
    const [lessonDoc, overlayDoc] = await Promise.all([lessonDbRef.get(), overlayRef.get()]);
    // Return existing lesson if it's completed OR if it has no status (legacy lesson)
    if (lessonDoc.exists && (lessonDoc.data()?.status === 'completed' || !lessonDoc.data()?.status)) {
      this.logger.log(`Returning existing lesson for KU ${kuId} from lessons collection`);
      const data = lessonDoc.data()!;
      if (data.userId) {
        void lessonDbRef.update({ userId: FieldValue.delete() });
        delete data.userId;
      }
      if (overlayDoc.exists) {
        return { ...data, ...overlayDoc.data() } as Lesson;
      }
      return data as Lesson;
    }

    this.logger.log(`No existing lesson for KU ${kuId}. Generating new lesson`);

    let userMessage: string;

    if (ku.type === "Grammar") {
      const grammarKu = ku as GrammarKnowledgeUnit;
      userMessage = buildGrammarLessonMessage(grammarKu);

      const lessonString = await this.geminiService.generateLesson(userMessage, { content: grammarKu.content, kuId }, undefined);
      if (!lessonString) throw new Error('AI response was empty.');

      let lessonJson: GrammarLesson;
      try {
        lessonJson = JSON.parse(lessonString) as GrammarLesson;
        lessonJson.kuId = kuId;
      } catch {
        this.logger.error('Failed to parse Grammar lesson JSON', lessonString);
        throw new Error('Failed to parse AI JSON response for grammar lesson');
      }

      await lessonDbRef.set(lessonJson);
      return lessonJson;
    }

    if (ku.type === "Kanji") {
      userMessage = buildKanjiLessonPrompt(ku.content);
    } else {
      userMessage = buildVocabLessonMessage(ku.content, !!cachedContentName);
    }

    const lessonString = await this.geminiService.generateLesson(
      userMessage,
      { content, kuId },
      cachedContentName
    );

    if (!lessonString) {
      this.logger.error("AI response was empty.");
      throw new Error("AI response was empty.");
    }

    let lessonJson: Lesson | undefined;

    try {
      lessonJson = JSON.parse(lessonString) as Lesson;
      (lessonJson as VocabLesson | KanjiLesson).kuId = kuId;

      // --- MERGE USER DEFINITIONS (if Vocab) ---
      // Rely on the KnowledgeUnit type, which is the source of truth
      if (ku.type === "Vocab") {
        const userDefinitions = ku.data.definition
          ? ku.data.definition.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0)
          : [];

        // Ensure definitions array exists
        if (!Array.isArray((lessonJson as any).definitions)) {
          (lessonJson as any).definitions = [];
        }

        const aiDefinitions = (lessonJson as any).definitions || [];

        // Deduplicate (case-insensitive)
        const combined = [...userDefinitions, ...aiDefinitions];
        const uniqueDefinitions = combined.reduce<string[]>((acc, curr) => {
          if (!acc.some(d => d.toLowerCase() === curr.toLowerCase())) {
            acc.push(curr);
          }
          return acc;
        }, []);

        (lessonJson as any).definitions = uniqueDefinitions;

        // Backward compatibility for definition field
        if ((lessonJson as any).definitions.length > 0) {
          (lessonJson as any).definition = (lessonJson as any).definitions.join(', ');
        }
      }

    } catch (parseError) {
      this.logger.error("Failed to parse AI JSON response for lesson", {
        lessonString,
        parseError,
      });
      throw new Error("Failed to parse AI JSON response for lesson");
    }

    // --- SAVE TO 'lessons' collection ---
    await lessonDbRef.set(lessonJson);

    // --- UPDATE KU WITH LESSON DATA ---
    if (ku.type === 'Vocab') {
      const vocabLesson = lessonJson as VocabLesson;
      const updates: Record<string, any> = {};

      // Use dot notation to update nested data fields without overwriting the map
      if (vocabLesson.reading) {
        updates['data.reading'] = vocabLesson.reading;
      }

      // definition is populated above by joining definitions
      if (vocabLesson.definition) {
        updates['data.definition'] = vocabLesson.definition;
      }

      if (vocabLesson.conjugationType) {
        updates['data.conjugationType'] = vocabLesson.conjugationType;
      }

      if (Object.keys(updates).length > 0) {
        try {
          this.logger.log(`Updating KU ${kuId} with lesson data: ${JSON.stringify(updates)}`);
          await this.knowledgeUnitsService.update(kuId, updates);
        } catch (e) {
          console.log(e);
          this.logger.error(`Failed to backfill KU ${kuId} with lesson data`, e);
          // Don't fail the response, just log error
        }
      }
    }

    return lessonJson;
  }

  async updateLesson(uid: string, kuId: string, section: string, content: string) {
    const lessonDoc = await this.db.collection(LESSONS_COLLECTION).doc(kuId).get();
    if (!lessonDoc.exists) throw new NotFoundException('Lesson not found');

    let valueToSave: any = content;
    try {
      const trimmed = content.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        valueToSave = JSON.parse(content);
      }
    } catch (e) {
      valueToSave = content;
    }

    const overlayRef = this.db.collection('users').doc(uid).collection(USER_LESSONS_SUBCOLLECTION).doc(kuId);
    await overlayRef.set({ [section]: valueToSave }, { merge: true });

    return { success: true };
  }

  async findByKuId(uid: string, kuId: string): Promise<Lesson | null> {
    const [lessonDoc, overlayDoc] = await Promise.all([
      this.db.collection(LESSONS_COLLECTION).doc(kuId).get(),
      this.db.collection('users').doc(uid).collection(USER_LESSONS_SUBCOLLECTION).doc(kuId).get(),
    ]);

    if (!lessonDoc.exists) return null;

    const lesson = lessonDoc.data() as Lesson;
    if (overlayDoc.exists) {
      return { ...lesson, ...overlayDoc.data() } as Lesson;
    }
    return lesson;
  }

  async createUserGrammarLesson(
    uid: string,
    kuId: string,
    source: { sourceType: 'scenario' | 'concept'; sourceId: string; sourceTitle: string },
    contextExample: { japanese: string; english: string; fragments: string[]; accepted_alternatives: string[] },
  ): Promise<UserGrammarLesson> {
    const docId = `${kuId}_${source.sourceType}_${source.sourceId}`;
    const ref = this.db.collection('users').doc(uid).collection(USER_GRAMMAR_LESSONS_SUBCOLLECTION).doc(docId);

    const data: Omit<UserGrammarLesson, 'id'> = {
      userId: uid,
      kuId,
      lessonId: kuId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceTitle: source.sourceTitle,
      contextExample,
      createdAt: Timestamp.now(),
    };

    await ref.set(data, { merge: false });
    this.logger.log(`Created UserGrammarLesson ${docId} for uid=${uid} kuId=${kuId}`);
    return { id: docId, ...data };
  }

  async getUserGrammarLessons(uid: string, kuId: string): Promise<UserGrammarLesson[]> {
    const snapshot = await this.db
      .collection('users').doc(uid)
      .collection(USER_GRAMMAR_LESSONS_SUBCOLLECTION)
      .where('kuId', '==', kuId)
      .get();

    if (snapshot.empty) return [];
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as unknown as UserGrammarLesson);
  }


  async getQueue(uid: string): Promise<{ kuId: string; content: string; type: string }[]> {
    const userDoc = await this.db.collection('users').doc(uid).get();
    const jlptLevel = (userDoc.data() as UserRoot | undefined)?.preferences?.jlptLevel ?? 'N5';

    const facetsCol = uid === ADMIN_USER_ID
      ? this.db.collection(REVIEW_FACETS_COLLECTION).where('userId', '==', uid)
      : this.db.collection('users').doc(uid).collection(REVIEW_FACETS_COLLECTION);

    const facetsSnap = await facetsCol.get();
    const startedKuIds = new Set(facetsSnap.docs.map(d => d.data().kuId as string).filter(Boolean));

    const kuSnap = await this.db.collection(KNOWLEDGE_UNITS_COLLECTION)
      .where('data.jlptLevel', '==', jlptLevel)
      .limit(200)
      .get();

    return kuSnap.docs
      .filter(d => !startedKuIds.has(d.id))
      .slice(0, 10)
      .map(d => ({ kuId: d.id, content: d.data().content as string, type: d.data().type as string }));
  }

  async processBatch(uid: string, vocabValues: { id: string; content: string }[]) {
    const cacheName = await this.geminiService.createContextCache(
      buildVocabCacheContext(),
      3600
    );

    this.logger.log(`Created Context Cache: ${cacheName} for batch processing`);
    const bulkWriter = this.db.bulkWriter();

    let processedCount = 0;
    const totalItems = vocabValues.length;

    try {
      for (const item of vocabValues) {
        processedCount++;
        this.logger.log(`[Batch ${processedCount}/${totalItems}] Processing item: ${item.content} (${item.id})`);

        try {
          const lessonRef = this.db.collection(LESSONS_COLLECTION).doc(item.id);
          const lessonDoc = await lessonRef.get();
          const lessonData = lessonDoc.data();

          // Skip if lesson exists and is not marked as failed.
          // This creates a "resume" capability and prevents overwriting legacy lessons (undefined status)
          // or lessons that are currently generating/completed.
          if (lessonDoc.exists && lessonData?.status !== 'failed') {
            this.logger.log(`Skipping ${item.content} - already exists (Status: ${lessonData?.status ?? 'legacy'})`);
            continue;
          }

          // Set status to generating
          await lessonRef.set({
            kuId: item.id,
            status: 'generating',
            createdAt: new Date(),
          }, { merge: true });

          // --- GENERATE ---
          this.logger.log(`Generating lesson for ${item.content} using cache ${cacheName}`);
          const lesson = await this.generateLesson(uid, item.id, cacheName);

          // --- SAVE ---
          void bulkWriter.set(lessonRef, {
            ...lesson,
            status: 'completed'
          }, { merge: true });

          this.logger.log(`Successfully generated and queued write for ${item.content}`);

          // --- RATE LIMIT DELAY (Trickle) ---
          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (err) {
          this.logger.error(`Failed to process item ${item.content}`, err);
          const lessonRef = this.db.collection(LESSONS_COLLECTION).doc(item.id);
          // Mark as failed so it can be retried later
          void bulkWriter.set(lessonRef, { status: 'failed', error: (err as Error).message }, { merge: true });
        }
      }

      this.logger.log('Batch iteration completed. Waiting for BulkWriter to flush...');

    } catch (e) {
      this.logger.error('Critical Error in processBatch loop', e);
    } finally {
      // Ensure BulkWriter is closed to commit all changes
      try {
        await bulkWriter.close();
        this.logger.log('BulkWriter closed successfully. Batch processing finished.');
      } catch (closeError) {
        this.logger.error('Failed to close BulkWriter', closeError);
      }

      // Cleanup Cache
      try {
        await this.geminiService.deleteContextCache(cacheName);
        this.logger.log(`Deleted Context Cache: ${cacheName}`);
      } catch (cacheError) {
        this.logger.error(`Failed to delete Context Cache: ${cacheName}`, cacheError);
      }
    }
  }
}
