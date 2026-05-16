import { Injectable, Inject, Logger } from '@nestjs/common';
import { CollectionReference, FieldValue, Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  FIRESTORE_CONNECTION,
  REVIEW_FACETS_COLLECTION,
} from '../firebase/firebase.module';
import { ADMIN_USER_ID } from '../lib/constants';
import { FACET_SEQUENCES } from '../lib/facet-sequences';
import {
  FacetStageDefinition,
  FacetStageEntry,
  GrammarLesson,
  KanjiLesson,
  KnowledgeUnit,
  KuFacetSequence,
  Lesson,
  ReviewFacet,
  VocabLesson,
} from '../types';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { LessonsService } from '../lessons/lessons.service';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { GeminiService } from '../gemini/gemini.service';
import { LearningProgressService } from '../learning-progress/learning-progress.service';

@Injectable()
export class ReviewProgressService {
  private readonly logger = new Logger(ReviewProgressService.name);

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
    private readonly lessonsService: LessonsService,
    private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
    private readonly geminiService: GeminiService,
    private readonly learningProgressService: LearningProgressService,
  ) {}

  private facetsColRef(uid: string): CollectionReference {
    if (uid === ADMIN_USER_ID) {
      return this.db.collection(REVIEW_FACETS_COLLECTION);
    }
    return this.db.collection('users').doc(uid).collection(REVIEW_FACETS_COLLECTION);
  }

  /**
   * Called when a user completes a lesson. Creates the first applicable stage's
   * facets and records currentStage on the UKU.
   */
  async initializeSequence(
    uid: string,
    kuId: string,
  ): Promise<{ stage: number; facetsCreated: number }> {
    const ku = await this.knowledgeUnitsService.findOne(kuId);
    if (!ku) {
      this.logger.warn(`initializeSequence: KU not found kuId=${kuId}`);
      return { stage: 0, facetsCreated: 0 };
    }

    const lesson = await this.lessonsService.findByKuId(uid, kuId);
    if (!lesson) {
      this.logger.warn(`initializeSequence: no lesson found for kuId=${kuId}`);
      return { stage: 0, facetsCreated: 0 };
    }

    const sequence = FACET_SEQUENCES.find(s => s.kuType === ku.type);
    if (!sequence) {
      this.logger.warn(`initializeSequence: no sequence defined for kuType=${ku.type}`);
      return { stage: 0, facetsCreated: 0 };
    }

    const firstStage = this.findFirstApplicableStage(sequence, lesson);
    if (!firstStage) {
      this.logger.warn(`initializeSequence: no applicable stage for kuId=${kuId}`);
      return { stage: 0, facetsCreated: 0 };
    }

    await this.userKnowledgeUnitsService.create(uid, kuId);
    const facetsCreated = await this.createFacetsForStage(uid, kuId, ku, lesson, firstStage);
    await this.userKnowledgeUnitsService.update(uid, kuId, { currentStage: firstStage.stage });
    await this.learningProgressService.recomputeAndCache(uid, kuId);

    this.logger.log(
      `Initialized sequence for uid=${uid} kuId=${kuId}: stage=${firstStage.stage} facets=${facetsCreated}`,
    );
    return { stage: firstStage.stage, facetsCreated };
  }

  /**
   * Called after every facet SRS update. Checks whether the current stage's
   * unlock condition is met and if so creates the next stage's facets.
   * Non-blocking — caller should fire-and-forget.
   */
  async checkAndAdvanceStage(uid: string, kuId: string): Promise<void> {
    const uku = await this.userKnowledgeUnitsService.findByKuId(uid, kuId);
    if (!uku?.currentStage) return; // 0 or missing = sequence not initialized

    const ku = await this.knowledgeUnitsService.findOne(kuId);
    if (!ku) return;

    const sequence = FACET_SEQUENCES.find(s => s.kuType === ku.type);
    if (!sequence) return;

    const currentStageDef = sequence.stages.find(s => s.stage === uku.currentStage);
    if (!currentStageDef || currentStageDef.unlockAtSrsStage === null) return; // terminal

    const stageFacets = await this.getFacetsAtStage(uid, kuId, uku.currentStage);
    if (stageFacets.length === 0) return;

    const allReady = stageFacets.every(
      f => (f.srsStage ?? 0) >= currentStageDef.unlockAtSrsStage!,
    );
    if (!allReady) return;

    const lesson = await this.lessonsService.findByKuId(uid, kuId);
    if (!lesson) return;

    const nextStage = this.findNextApplicableStage(sequence, lesson, uku.currentStage);
    if (!nextStage) return;

    // Guard against concurrent calls (e.g. two sentence-assembly facets reviewed in quick
    // succession): if next-stage facets already exist, the first call already advanced us.
    const alreadyCreated = await this.getFacetsAtStage(uid, kuId, nextStage.stage);
    if (alreadyCreated.length > 0) {
      this.logger.log(`Stage ${nextStage.stage} facets already exist for kuId=${kuId}, skipping duplicate advance`);
      return;
    }

    this.logger.log(
      `Advancing sequence uid=${uid} kuId=${kuId}: ${uku.currentStage} → ${nextStage.stage}`,
    );

    await this.createFacetsForStage(uid, kuId, ku, lesson, nextStage);
    await this.userKnowledgeUnitsService.update(uid, kuId, { currentStage: nextStage.stage });
    await this.learningProgressService.recomputeAndCache(uid, kuId);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /** First stage that has at least one applicable entry given the lesson data. */
  private findFirstApplicableStage(
    sequence: KuFacetSequence,
    lesson: Lesson,
  ): FacetStageDefinition | null {
    for (const stageDef of sequence.stages) {
      if (this.stageIsApplicable(stageDef, lesson)) return stageDef;
    }
    return null;
  }

  /** Next stage after currentStage that has at least one applicable entry. */
  private findNextApplicableStage(
    sequence: KuFacetSequence,
    lesson: Lesson,
    currentStage: number,
  ): FacetStageDefinition | null {
    const remaining = sequence.stages.filter(s => s.stage > currentStage);
    for (const stageDef of remaining) {
      if (this.stageIsApplicable(stageDef, lesson)) return stageDef;
    }
    return null;
  }

  /**
   * A stage is applicable if at least one of its entries can produce facet data.
   * Kanji-component entries are skipped when the lesson has no component_kanji.
   */
  private stageIsApplicable(stageDef: FacetStageDefinition, lesson: Lesson): boolean {
    return stageDef.facets.some(entry => this.buildFacetData(entry, lesson).length > 0);
  }

  /** Returns all facets for a KU that belong to a given sequence stage. */
  private async getFacetsAtStage(
    uid: string,
    kuId: string,
    stage: number,
  ): Promise<ReviewFacet[]> {
    const snapshot = await this.facetsColRef(uid).where('kuId', '==', kuId).get();
    return snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }) as ReviewFacet)
      .filter(f => f.sequenceStage === stage);
  }

  /** Creates all facets for a stage and increments UKU facet_count. */
  private async createFacetsForStage(
    uid: string,
    kuId: string,
    ku: KnowledgeUnit,
    lesson: Lesson,
    stageDef: FacetStageDefinition,
  ): Promise<number> {
    const batch = this.db.batch();
    const now = Timestamp.now();
    let count = 0;

    for (const entry of stageDef.facets) {
      let dataItems = this.buildFacetData(entry, lesson);
      if (dataItems.length === 0) continue;

      // Audio facets: generate cloze sentences before the batch write
      if (entry.type === 'audio') {
        dataItems = await Promise.all(
          dataItems.map(async d => {
            if (d.contextExample?.sentence) {
              try {
                d.clozeSentence = await this.geminiService.generateClozeSentence(
                  ku.content,
                  d.contextExample.sentence,
                );
              } catch (e) {
                this.logger.error(`Cloze generation failed for kuId=${kuId}`, e);
              }
            }
            return d;
          }),
        );
      }

      for (const data of dataItems) {
        batch.set(this.facetsColRef(uid).doc(), {
          kuId,
          sourceCollection: ku.type === 'Concept' ? 'concepts' : 'knowledge-units',
          facetType: entry.type,
          srsStage: 0,
          nextReviewAt: now,
          createdAt: now,
          history: [],
          sequenceStage: stageDef.stage,
          source: { type: 'lesson', id: kuId },
          ...(uid === ADMIN_USER_ID ? { userId: uid } : {}),
          data,
        });
        count++;
      }
    }

    if (count === 0) return 0;

    await batch.commit();
    await this.userKnowledgeUnitsService.update(uid, kuId, {
      facet_count: FieldValue.increment(count),
    });

    return count;
  }

  /**
   * Builds the data payload(s) for a single facet entry.
   * Returns an array: 'kanji-components' and 'examples' produce one item per component/example;
   * 'primary' produces a single item (or empty array when data is unavailable).
   */
  private buildFacetData(entry: FacetStageEntry, lesson: Lesson): Record<string, any>[] {
    if (entry.source === 'kanji-components') {
      if (lesson.type !== 'Vocab') return [];
      const vl = lesson as VocabLesson;
      const components = vl.component_kanji ?? [];
      if (components.length === 0) return [];

      return components.map(k => {
        if (entry.type === 'Kanji-Component-Meaning') {
          return { content: k.kanji, meaning: k.meaning };
        }
        // Kanji-Component-Reading — include vocabReading so the card can flag mismatches
        return {
          content: k.kanji,
          vocabReading: k.reading,
          onyomi: k.onyomi ?? [],
          kunyomi: k.kunyomi ?? [],
        };
      });
    }

    if (entry.source === 'examples') {
      if (lesson.type === 'Grammar') {
        const gl = lesson as GrammarLesson;
        return (gl.examples ?? []).map(ex => ({
          goalTitle: gl.pattern,
          fragments: ex.fragments,
          answer: ex.japanese,
          english: ex.english,
          accepted_alternatives: ex.accepted_alternatives ?? [],
        }));
      }
      return [];
    }

    // source === 'primary'
    if (lesson.type === 'Vocab') {
      const vl = lesson as VocabLesson;

      if (entry.type === 'audio') {
        const examples = vl.context_examples ?? [];
        if (examples.length === 0) return [];
        const contextExample = examples[Math.floor(Math.random() * examples.length)];
        return [{ content: vl.vocab, reading: vl.reading, definitions: vl.definitions ?? [], contextExample }];
      }

      // Skip reading review for kana-only vocab — content IS the reading
      if (entry.type === 'Content-to-Reading' && vl.vocab === vl.reading) return [];

      // Content-to-Definition, Definition-to-Content, Content-to-Reading, AI-Generated-Question
      return [{ content: vl.vocab, reading: vl.reading, definitions: vl.definitions ?? [] }];
    }

    if (lesson.type === 'Kanji') {
      const kl = lesson as KanjiLesson;
      if (entry.type === 'Kanji-Component-Meaning') {
        return [{ content: kl.kanji, meaning: kl.meaning, onyomi: kl.onyomi, kunyomi: kl.kunyomi }];
      }
      if (entry.type === 'Kanji-Component-Reading') {
        return [{ content: kl.kanji, onyomi: kl.onyomi, kunyomi: kl.kunyomi }];
      }
    }

    if (lesson.type === 'Grammar') {
      const gl = lesson as GrammarLesson;
      if (entry.type === 'AI-Generated-Question') {
        return [{ content: gl.pattern, pattern: gl.pattern, title: gl.title }];
      }
    }

    return [];
  }
}
