import { BadRequestException, Injectable, Inject, Logger } from '@nestjs/common';
import { FieldValue, Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  FIRESTORE_CONNECTION,
  KNOWLEDGE_UNITS_COLLECTION,
  PICTURES_COLLECTION,
  USER_KUS_SUBCOLLECTION,
} from '../firebase/firebase.module';
import { ALREADY_KNOWN_STAGE, SRS_INTERVALS } from '../lib/constants';
import { FACET_SEQUENCES } from '../lib/facet-sequences';
import { kanjiIn } from '../lib/kanji-chars';
import { isUsefulAssembly } from '../lib/assembly-quality';
import {
  FacetStageDefinition,
  FacetStageEntry,
  GrammarLesson,
  KanjiLesson,
  KnowledgeUnit,
  SequenceVariant,
  KuFacetSequence,
  Lesson,
  ReviewFacet,
  VocabLesson,
} from '../types';
import { isUsagePicture } from '../pictures/pictures.service';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { LessonsService } from '../lessons/lessons.service';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { LearningProgressService } from '../learning-progress/learning-progress.service';
import { TutorContextService } from '../tutor-context/tutor-context.service';
import { FacetStore } from '../facets/facet-store';
import { UserService } from '../users/user.service';

/** A picture card needs the word plus three distractor words, or it can't record a result. */
const MIN_PICTURED_WORDS = 4;

/**
 * A word enrolled as "already known" whose every answer so far has been right. History
 * records the stage after each answer, so a known word's facets first record
 * ALREADY_KNOWN_STAGE + 1 (a learned word's first record 0 or 1). One miss anywhere and
 * the word follows the full SRS from then on. Facets not yet answered are ignored.
 */
export function isStillKnown(facets: Pick<ReviewFacet, 'history'>[]): boolean {
  const answered = facets.filter(f => (f.history?.length ?? 0) > 0);
  return answered.length > 0 && answered.every(f =>
    f.history![0].stage > ALREADY_KNOWN_STAGE && f.history!.every(h => h.result === 'pass'),
  );
}

@Injectable()
export class ReviewProgressService {
  private readonly logger = new Logger(ReviewProgressService.name);

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly facetStore: FacetStore,
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
    private readonly lessonsService: LessonsService,
    private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
    private readonly learningProgressService: LearningProgressService,
    private readonly tutorContext: TutorContextService,
    private readonly userService: UserService,
  ) {}

  /**
   * Called when a user completes a lesson. Creates the first applicable stage's
   * facets and records currentStage on the UKU.
   *
   * `resetFrom` (resetSequence only): the variant the word had before the reset, which
   * the reset keeps when it can, so the experiment flag never converts words in progress.
   */
  async initializeSequence(
    uid: string,
    kuId: string,
    startAtSrsStage = 0,
    resetFrom?: { variant?: SequenceVariant },
  ): Promise<{ stage: number; facetsCreated: number }> {
    // Idempotent: if this KU's sequence was already initialized (e.g. a retried
    // enrollment call, or the item briefly reappearing in the learning queue),
    // creating facets again would silently duplicate the whole first stage.
    const existingUku = await this.userKnowledgeUnitsService.findByKuId(uid, kuId);
    if (existingUku?.currentStage) {
      this.logger.log(
        `initializeSequence: already initialized for uid=${uid} kuId=${kuId} (currentStage=${existingUku.currentStage}), skipping`,
      );
      return { stage: existingUku.currentStage, facetsCreated: 0 };
    }

    const ku = await this.knowledgeUnitsService.findOne(kuId);
    if (!ku) {
      this.logger.warn(`initializeSequence: KU not found kuId=${kuId}`);
      return { stage: 0, facetsCreated: 0 };
    }

    const lesson = await this.lessonsService.lessonForSequence(uid, ku);
    if (!lesson) {
      this.logger.warn(`initializeSequence: no lesson found for kuId=${kuId}`);
      return { stage: 0, facetsCreated: 0 };
    }

    const variant = await this.chooseVariant(uid, ku, resetFrom);
    const sequence = this.sequenceFor(ku.type, variant);
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

    // A stage can look applicable from lesson data alone (findFirstApplicableStage)
    // yet still produce zero facets once per-user dedup is applied — e.g. every
    // component kanji already has its own Kanji-Component-Meaning facet from an
    // earlier-enrolled word. Keep trying the next applicable stage rather than
    // leaving the KU stranded on a stage with no facets that can never advance.
    const result = await this.createFacetsSkippingEmptyStages(uid, kuId, ku, lesson, sequence, firstStage, startAtSrsStage);
    if (!result) {
      this.logger.warn(`initializeSequence: every stage fully deduped for kuId=${kuId}, no facets created`);
      return { stage: 0, facetsCreated: 0 };
    }

    await this.userKnowledgeUnitsService.update(uid, kuId, {
      currentStage: result.stage.stage,
      // Always written: a reset re-chooses the variant, and a stale one would point
      // checkAndAdvanceStage at a sequence the facets weren't built from.
      sequenceVariant: variant ?? FieldValue.delete(),
    });
    await this.learningProgressService.recomputeAndCache(uid, kuId);

    this.logger.log(
      `Initialized sequence for uid=${uid} kuId=${kuId}: stage=${result.stage.stage} facets=${result.facetsCreated} startAtSrsStage=${startAtSrsStage}${variant ? ` variant=${variant}` : ''}`,
    );

    // If the caller front-loaded the SRS stage far enough to already satisfy this
    // stage's unlock condition, cascade forward immediately rather than waiting
    // for the (now distant) nextReviewAt to come due. Carry the same startAtSrsStage
    // through the cascade so every unlocked stage is equally front-loaded — otherwise
    // "I already know this" would front-load only stage 1 and dump the very next
    // stage's facets in immediately-due at srsStage 0.
    if (startAtSrsStage > 0) {
      await this.checkAndAdvanceStage(uid, kuId, startAtSrsStage);
    }

    return { stage: result.stage.stage, facetsCreated: result.facetsCreated };
  }

  /**
   * Admin tool: regenerates the KU's global lesson, then rebuilds this user's facet
   * sequence from the new lesson. SRS progress for the KU is deliberately lost.
   */
  async regenerateAndReset(
    uid: string,
    kuId: string,
  ): Promise<{ facetsDeleted: number; stage: number; facetsCreated: number }> {
    const ku = await this.knowledgeUnitsService.findOne(kuId);
    if (ku.type !== 'Vocab' && ku.type !== 'Grammar') {
      throw new BadRequestException(`Regeneration supports Vocab and Grammar only (kuId=${kuId} is ${ku.type})`);
    }
    await this.lessonsService.regenerateLesson(uid, kuId);
    return this.resetSequence(uid, kuId);
  }

  /**
   * Deletes all of this user's facets for a KU's sequence and re-initializes it from
   * the current lesson. Matches source.id (stage facets, incl. kanji-component facets
   * attributed to this KU) OR kuId (legacy facets without a source).
   */
  async resetSequence(
    uid: string,
    kuId: string,
  ): Promise<{ facetsDeleted: number; stage: number; facetsCreated: number }> {
    const { facetsDeleted, countByKuId } = await this.deleteSequenceFacets(uid, kuId);
    const previous = await this.userKnowledgeUnitsService.findByKuId(uid, kuId);
    await this.userKnowledgeUnitsService.update(uid, kuId, { currentStage: 0, facet_count: 0 });

    const { stage, facetsCreated } = await this.initializeSequence(uid, kuId, 0, { variant: previous?.sequenceVariant });
    if (facetsCreated === 0) await this.learningProgressService.recomputeAndCache(uid, kuId);

    await this.removeOrphanedComponentKanji(uid, kuId, countByKuId.keys());

    this.logger.log(
      `resetSequence uid=${uid} kuId=${kuId}: deleted ${facetsDeleted} facets (${JSON.stringify(Object.fromEntries(countByKuId))}), re-initialized stage=${stage} facets=${facetsCreated}`,
    );
    return { facetsDeleted, stage, facetsCreated };
  }

  /**
   * Whether this user's enrolled word can be sent back to lessons to be relearned
   * audio-first, and if not, why. Steps 5–7 are chooseVariant's own conditions, so an
   * eligible word is guaranteed to be enrolled audio-first when the lesson is finished.
   */
  async audioFirstStatus(uid: string, kuId: string): Promise<{ eligible: boolean; reason?: string; facetCount: number }> {
    const no = (reason: string, facetCount = 0) => ({ eligible: false, reason, facetCount });
    const ku = await this.knowledgeUnitsService.findOneById(kuId);
    if (ku?.type !== 'Vocab') return no('Only Vocab words can be audio-first');
    const uku = await this.userKnowledgeUnitsService.findByKuId(uid, kuId);
    if (!uku) return no('Not enrolled: it will be taught audio-first when it comes up in lessons');
    if (uku.sequenceVariant === 'audio-first') return no('Already audio-first');
    const facets = await this.facetStore.forKu(uid, kuId);
    const facetCount = facets.length - (await this.planKanjiRehoming(uid, kuId, facets)).size; // exactly what the switch deletes
    const blocker = await this.audioFirstBlocker(uid, kuId, { checkFlag: true });
    if (blocker) return no(blocker, facetCount);
    if (facets.length === 0) return no('Already waiting in your lessons: it will be taught audio-first');
    return { eligible: true, facetCount };
  }

  /**
   * Why a Vocab word can't be audio-first right now, or null if it can. The one source of
   * truth for chooseVariant (enrollment) and audioFirstStatus (the admin switch), so a word
   * the switch accepts is always enrolled audio-first. `checkFlag: false` is the reset path,
   * which keeps an existing audio-first word's variant whatever the flag says.
   */
  private async audioFirstBlocker(uid: string, kuId: string, { checkFlag }: { checkFlag: boolean }): Promise<string | null> {
    if (checkFlag) {
      if ((await this.userService.getPreferences(uid)).audioFirstExperiment !== true) return 'The audio-first experiment is off in your profile';
    }
    if ((await this.approvedPictures(kuId)).length === 0) {
      // Whole-KU pictures aren't shown to learners yet (no card, slide or distractor uses them).
      const wholeKu = await this.db.collection(PICTURES_COLLECTION)
        .where('kuId', '==', kuId).where('status', '==', 'approved').where('subject.kind', '==', 'ku').limit(1).get();
      return wholeKu.empty
        ? 'No approved usage picture'
        : 'Only a whole-KU picture, which isn\'t used yet: re-attach it as a usage of the word';
    }
    if ((await this.picturedWordCount()) < MIN_PICTURED_WORDS) return `Fewer than ${MIN_PICTURED_WORDS} pictured words for distractors`;
    return null;
  }

  /**
   * Admin tool: deletes the word's facets but keeps it enrolled at stage 0 with no variant,
   * waiting (status 'learning'), so Start Learning serves it again and it's relearned with
   * audio-first slides, then enrolled audio-first by chooseVariant. SRS progress is lost.
   */
  async returnToLessonsAsAudioFirst(uid: string, kuId: string): Promise<{ facetsDeleted: number }> {
    const status = await this.audioFirstStatus(uid, kuId);
    if (!status.eligible) throw new BadRequestException(status.reason);

    // Kanji-component facets this word introduced are shared: another enrolled word with the
    // same kanji skipped making its own (per-user dedup). Hand those to that word instead of
    // deleting them, so its kanji stays reviewed.
    const rehome = await this.planKanjiRehoming(uid, kuId, await this.facetStore.forKu(uid, kuId));
    for (const [facetId, { toKuId, kanjiKuId }] of rehome) {
      await this.facetStore.doc(uid, facetId).update({ 'source.id': toKuId });
      const kanjiUku = await this.userKnowledgeUnitsService.findByKuId(uid, kanjiKuId);
      if (kanjiUku?.source?.type === 'lesson' && kanjiUku.source.id === kuId) {
        await this.userKnowledgeUnitsService.update(uid, kanjiKuId, { source: { type: 'lesson', id: toKuId } });
      }
      await this.userKnowledgeUnitsService.update(uid, toKuId, { facet_count: FieldValue.increment(1) });
    }
    for (const toKuId of new Set([...rehome.values()].map(r => r.toKuId))) {
      await this.learningProgressService.recomputeAndCache(uid, toKuId);
    }

    const { facetsDeleted, countByKuId } = await this.deleteSequenceFacets(uid, kuId);
    await this.userKnowledgeUnitsService.update(uid, kuId, {
      status: 'learning', // waiting for its lesson again (recompute below agrees: no facets)
      currentStage: 0,
      facet_count: 0,
      sequenceVariant: FieldValue.delete(),
    });
    await this.removeOrphanedComponentKanji(uid, kuId, countByKuId.keys());
    await this.learningProgressService.recomputeAndCache(uid, kuId);
    // Audio-first words are kept out of the tutor context (recomputeAndCache never adds
    // them), but this one may have been added while it was standard: Gemini would keep
    // writing it in kanji. Drop it from both lists.
    const ku = await this.knowledgeUnitsService.findOneById(kuId);
    if (ku?.content) await this.tutorContext.removeFromTutorVocab(uid, ku.content);

    this.logger.log(`returnToLessonsAsAudioFirst uid=${uid} kuId=${kuId}: deleted ${facetsDeleted} facets, handed ${rehome.size} kanji facets to other words, back in lessons`);
    return { facetsDeleted };
  }

  /**
   * Deletes every facet in a word's sequence (by source.id) or targeting it (by kuId), and
   * decrements/recomputes the other KUs those facets counted toward (component kanji).
   */
  private async deleteSequenceFacets(
    uid: string,
    kuId: string,
  ): Promise<{ facetsDeleted: number; countByKuId: Map<string, number> }> {
    const facets = await this.facetStore.forKu(uid, kuId);

    const countByKuId = new Map<string, number>();
    const batch = this.db.batch();
    facets.forEach(f => {
      const target = f.kuId ?? kuId;
      countByKuId.set(target, (countByKuId.get(target) ?? 0) + 1);
      batch.delete(this.facetStore.doc(uid, f.id!));
    });
    if (facets.length > 0) await batch.commit();

    await Promise.all(
      Array.from(countByKuId.entries())
        .filter(([target]) => target !== kuId)
        .map(async ([target, n]) => {
          await this.userKnowledgeUnitsService.update(uid, target, { facet_count: FieldValue.increment(-n) });
          await this.learningProgressService.recomputeAndCache(uid, target);
        }),
    );
    return { facetsDeleted: facets.length, countByKuId };
  }

  /**
   * For each kanji-component facet in this word's sequence, another enrolled default-sequence
   * Vocab word containing the same kanji (oldest enrolment first) that should own it instead.
   * Facets with no such word aren't in the map (they're deleted with the word's sequence).
   */
  private async planKanjiRehoming(
    uid: string,
    kuId: string,
    facets: ReviewFacet[],
  ): Promise<Map<string, { toKuId: string; kanjiKuId: string }>> {
    const plan = new Map<string, { toKuId: string; kanjiKuId: string }>();
    const kanjiFacets = facets.filter(f =>
      String(f.facetType).startsWith('Kanji-Component') && f.kuId !== kuId && f.data?.content,
    );
    if (kanjiFacets.length === 0) return plan;

    const ukus = (await this.db.collection('users').doc(uid).collection(USER_KUS_SUBCOLLECTION).get()).docs.map(d => d.data());
    const enrolled = new Map(ukus.filter(u => u.kuId && u.kuId !== kuId && u.sequenceVariant !== 'audio-first').map(u => [u.kuId as string, u]));
    const millis = (t: any) => (typeof t?.toMillis === 'function' ? t.toMillis() : (t?.seconds ?? t?._seconds ?? 0) * 1000);
    for (const f of kanjiFacets) {
      const char = f.data.content as string;
      const words = await this.db.collection(KNOWLEDGE_UNITS_COLLECTION).where('data.kanji', 'array-contains', char).get();
      const owner = words.docs
        .filter(w => w.data().type === 'Vocab' && enrolled.has(w.id))
        .sort((a, b) => millis(enrolled.get(a.id)!.createdAt) - millis(enrolled.get(b.id)!.createdAt))[0];
      if (owner) plan.set(f.id!, { toKuId: owner.id, kanjiKuId: f.kuId });
    }
    return plan;
  }

  /**
   * A component kanji enrolled through this word (its UKU's source) that has no facets
   * left would otherwise sit in the learning queue. Kanji enrolled any other way
   * (directly, a flag, a scenario, another word) are left alone.
   */
  private async removeOrphanedComponentKanji(uid: string, kuId: string, targets: Iterable<string>): Promise<void> {
    await Promise.all(
      Array.from(targets)
        .filter(target => target !== kuId)
        .map(async target => {
          const kanjiUku = await this.userKnowledgeUnitsService.findByKuId(uid, target);
          if (kanjiUku?.source?.type !== 'lesson' || kanjiUku.source.id !== kuId) return;
          const [byTarget, bySequence] = await Promise.all([
            this.facetStore.query(uid).where('kuId', '==', target).limit(1).get(),
            this.facetStore.query(uid).where('source.id', '==', target).limit(1).get(),
          ]);
          if (byTarget.empty && bySequence.empty) await this.userKnowledgeUnitsService.remove(uid, target);
        }),
    );
  }

  /**
   * Called after every facet SRS update. Checks whether the current stage's
   * unlock condition is met and if so creates the next stage's facets.
   * Non-blocking — caller should fire-and-forget.
   *
   * startAtSrsStage is only non-zero when cascading from an "already known"
   * front-loaded enrollment (see initializeSequence) — it's carried through
   * and re-checked recursively so the cascade keeps unlocking every stage the
   * elevated SRS stage satisfies, rather than stopping after one hop.
   *
   * When a review unlocks a stage (startAtSrsStage 0) on a word that's still known (see
   * isStillKnown), the new facets start at ALREADY_KNOWN_STAGE but are due straight away:
   * the word is known, its new facet just hasn't been tested yet.
   *
   * Guard clauses below are deliberately split into two tiers, not treated
   * uniformly:
   *  - "Normal flow" no-ops (terminal stage reached, not every facet ready
   *    yet) are the common case on most calls and stay silent — logging them
   *    would just be noise on nearly every review.
   *  - Every other early return means this call reached a state that
   *    shouldn't normally be possible if the caller passed the right kuId and
   *    the data is intact (e.g. a UKU with no sequence, a stage number with
   *    no definition, a stage with zero facets under it). These warn with
   *    enough context to diagnose without needing ad-hoc data digging —
   *    exactly what this function couldn't tell us the first time this class
   *    of bug showed up.
   *
   * Returns true when it advanced the sequence (and so already recomputed the UKU status).
   */
  async checkAndAdvanceStage(uid: string, kuId: string, startAtSrsStage = 0): Promise<boolean> {
    const uku = await this.userKnowledgeUnitsService.findByKuId(uid, kuId);
    if (!uku?.currentStage) {
      this.logger.warn(`checkAndAdvanceStage: no UKU or currentStage for uid=${uid} kuId=${kuId} — sequence not initialized, or called with the wrong kuId`);
      return false;
    }

    const ku = await this.knowledgeUnitsService.findOne(kuId);
    if (!ku) {
      this.logger.warn(`checkAndAdvanceStage: UKU exists but KU ${kuId} not found (uid=${uid}) — orphaned UKU`);
      return false;
    }

    const sequence = this.sequenceFor(ku.type, uku.sequenceVariant);
    if (!sequence) {
      this.logger.warn(`checkAndAdvanceStage: no FACET_SEQUENCES entry for kuType=${ku.type} (kuId=${kuId})`);
      return false;
    }

    // A stage removed from the sequence (Vocab's old AI-question stage 6) has no readiness rule:
    // a word still parked on it moves on to the next defined stage.
    const currentStageDef = sequence.stages.find(s => s.stage === uku.currentStage);
    if (!currentStageDef && !sequence.stages.some(s => s.stage > (uku.currentStage ?? 0))) {
      this.logger.warn(`checkAndAdvanceStage: UKU.currentStage=${uku.currentStage} for kuId=${kuId} doesn't match any defined stage in the ${ku.type} sequence`);
      return false;
    }
    if (currentStageDef?.unlockAtSrsStage === null) return false; // terminal stage — normal, common, not logged

    // One read serves both the readiness check and isStillKnown below.
    const kuFacets = await this.getSequenceFacets(uid, kuId);
    const stageFacets = kuFacets.filter(f => f.sequenceStage === uku.currentStage);
    if (stageFacets.length === 0) {
      this.logger.warn(`checkAndAdvanceStage: UKU says currentStage=${uku.currentStage} for kuId=${kuId} but zero facets exist at that stage — sequence is stuck with nothing left to review`);
      return false;
    }

    const allReady = !currentStageDef || stageFacets.every(
      f => (f.srsStage ?? 0) >= currentStageDef.unlockAtSrsStage!,
    );
    if (!allReady) return false; // not every facet ready yet — normal, the common case, not logged

    const lesson = await this.lessonsService.lessonForSequence(uid, ku);
    if (!lesson) {
      this.logger.warn(`checkAndAdvanceStage: no lesson found for kuId=${kuId} (uid=${uid}) despite having facets — can't determine next stage`);
      return false;
    }

    const nextStage = this.findNextApplicableStage(sequence, lesson, uku.currentStage);
    if (!nextStage) {
      this.logger.debug(`checkAndAdvanceStage: no further applicable stage for kuId=${kuId} after stage ${uku.currentStage} — remaining stages not applicable to this lesson's content`);
      return false;
    }

    // Guard against concurrent calls (e.g. two sentence-assembly facets reviewed in quick
    // succession): if next-stage facets already exist, the first call already advanced us.
    const alreadyCreated = await this.getFacetsAtStage(uid, kuId, nextStage.stage);
    if (alreadyCreated.length > 0) {
      this.logger.log(`Stage ${nextStage.stage} facets already exist for kuId=${kuId}, skipping duplicate advance`);
      return false;
    }

    this.logger.log(
      `Advancing sequence uid=${uid} kuId=${kuId}: ${uku.currentStage} → ${nextStage.stage}`,
    );

    // Same per-user-dedup concern as initializeSequence: nextStage looked applicable
    // from lesson data alone but may still produce zero facets for this user.
    const knownUnlock = startAtSrsStage === 0 && isStillKnown(kuFacets);
    const result = await this.createFacetsSkippingEmptyStages(
      uid, kuId, ku, lesson, sequence, nextStage,
      knownUnlock ? ALREADY_KNOWN_STAGE : startAtSrsStage,
      knownUnlock,
    );
    if (!result) {
      this.logger.warn(`checkAndAdvanceStage: every remaining stage fully deduped for kuId=${kuId} (uid=${uid}), no facets created`);
      return false;
    }

    await this.userKnowledgeUnitsService.update(uid, kuId, { currentStage: result.stage.stage });
    await this.learningProgressService.recomputeAndCache(uid, kuId);

    if (startAtSrsStage > 0) {
      await this.checkAndAdvanceStage(uid, kuId, startAtSrsStage);
    }
    return true;
  }

  /**
   * Starting at `stageDef`, creates facets for the first stage that actually
   * produces at least one facet for this user, trying subsequent applicable
   * stages if earlier ones are fully deduped (see callers for why that happens).
   * Returns null if no remaining stage produces any facet.
   */
  private async createFacetsSkippingEmptyStages(
    uid: string,
    kuId: string,
    ku: KnowledgeUnit,
    lesson: Lesson,
    sequence: KuFacetSequence,
    stageDef: FacetStageDefinition,
    startAtSrsStage: number,
    dueNow = false,
  ): Promise<{ stage: FacetStageDefinition; facetsCreated: number } | null> {
    let candidate: FacetStageDefinition | null = stageDef;
    while (candidate) {
      const facetsCreated = await this.createFacetsForStage(uid, kuId, ku, lesson, candidate, startAtSrsStage, dueNow);
      if (facetsCreated > 0) return { stage: candidate, facetsCreated };
      this.logger.log(`Stage ${candidate.stage} produced no facets for kuId=${kuId} (fully deduped), trying next stage`);
      candidate = this.findNextApplicableStage(sequence, lesson, candidate.stage);
    }
    return null;
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

  /**
   * The facets in a KU's own sequence, every stage (not those that only test it: see FacetStore.forKu).
   * Queries by source.id (the lesson/sequence lineage), not kuId — some facets
   * (e.g. Kanji-Component-*) target a different KU's content than the one whose
   * sequence they gate, so kuId alone can't identify stage membership.
   */
  private async getSequenceFacets(uid: string, kuId: string): Promise<ReviewFacet[]> {
    const snapshot = await this.facetStore.query(uid).where('source.id', '==', kuId).get();
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }) as ReviewFacet);
  }

  /** The facets belonging to one sequence stage (see getSequenceFacets). */
  private async getFacetsAtStage(
    uid: string,
    kuId: string,
    stage: number,
  ): Promise<ReviewFacet[]> {
    return (await this.getSequenceFacets(uid, kuId)).filter(f => f.sequenceStage === stage);
  }

  /** The sequence for a KU type and variant (absent variant = the default sequence). */
  private sequenceFor(kuType: string, variant?: SequenceVariant) {
    return FACET_SEQUENCES.find(s => s.kuType === kuType && s.variant === variant);
  }

  /**
   * Audio-first experiment: a Vocab word enrolled by a user with the flag on follows the
   * audio-first sequence, if it has an approved picture and enough other words are pictured
   * for a full four-picture card. Otherwise the default.
   *
   * On a reset, the flag isn't consulted: the word stays audio-first only if it already was
   * (and still qualifies), and a default word stays default.
   */
  private async chooseVariant(
    uid: string,
    ku: KnowledgeUnit,
    resetFrom?: { variant?: SequenceVariant },
  ): Promise<SequenceVariant | undefined> {
    if (ku.type !== 'Vocab') return undefined;
    if (resetFrom && resetFrom.variant !== 'audio-first') return undefined;
    return (await this.audioFirstBlocker(uid, ku.id, { checkFlag: !resetFrom })) ? undefined : 'audio-first';
  }

  /** Distinct words with an approved picture: the pool picture-card distractors come from. */
  private async picturedWordCount(): Promise<number> {
    const snap = await this.db.collection(PICTURES_COLLECTION).where('status', '==', 'approved').select('kuId', 'subject').get();
    return new Set(snap.docs.filter(d => isUsagePicture(d.data())).map(d => d.data().kuId)).size;
  }

  private async approvedPictures(kuId: string): Promise<{ id: string; file: string; usage: string }[]> {
    const snap = await this.db.collection(PICTURES_COLLECTION)
      .where('kuId', '==', kuId)
      .where('status', '==', 'approved')
      .get();
    return snap.docs
      .filter(d => d.data().file && isUsagePicture(d.data()))
      .map(d => ({ id: d.id, file: d.data().file as string, usage: d.data().usage as string }));
  }

  /** Creates all facets for a stage and increments UKU facet_count. */
  private async createFacetsForStage(
    uid: string,
    kuId: string,
    ku: KnowledgeUnit,
    lesson: Lesson,
    stageDef: FacetStageDefinition,
    startAtSrsStage = 0,
    /** Queue the facets now even though they start above 0 (a known word's newly unlocked stage). */
    dueNow = false,
  ): Promise<number> {
    const batch = this.db.batch();
    const now = Timestamp.now();
    const nextReviewAt = startAtSrsStage > 0 && !dueNow
      ? Timestamp.fromMillis(Date.now() + SRS_INTERVALS[startAtSrsStage] * 60 * 60 * 1000)
      : now;
    let count = 0;
    const facetCountByKuId = new Map<string, number>();

    for (const entry of stageDef.facets) {
      let dataItems = this.buildFacetData(entry, lesson);
      if (dataItems.length === 0) continue;

      // Picture cards carry the word's approved pictures (one per usage; the card rotates).
      if (entry.type === 'picture-choice') {
        const pictures = await this.approvedPictures(kuId);
        if (pictures.length === 0) continue;
        dataItems = dataItems.map(d => ({ ...d, pictures }));
      }

      // Kanji-component facets belong to the character's own Kanji KU, not the
      // parent's — ensure/create that per-character stub so "Review Lesson" and
      // other kuId-based lookups resolve to the Kanji itself instead of the parent.
      // source.id (below) keeps these attributed to the parent's sequence for gating.
      // A kanji can be a component of many different Vocab words, so also skip
      // creating a facet the Kanji KU already has (from a previously-enrolled word).
      const targetKuIds: (string | null)[] = entry.source === 'kanji-components'
        ? await Promise.all(dataItems.map(async d => {
            const kanjiKuId = await this.knowledgeUnitsService.ensureKanjiStub(d.content, d);
            await this.userKnowledgeUnitsService.create(uid, kanjiKuId, { type: 'lesson', id: kuId });
            const existing = await this.facetStore.query(uid)
              .where('kuId', '==', kanjiKuId)
              .where('facetType', '==', entry.type)
              .limit(1)
              .get();
            return existing.empty ? kanjiKuId : null;
          }))
        : dataItems.map(() => kuId);

      for (let i = 0; i < dataItems.length; i++) {
        const targetKuId = targetKuIds[i];
        if (targetKuId === null) continue;
        const data = dataItems[i];
        batch.set(this.facetStore.newDoc(uid), {
          kuId: targetKuId,
          sourceCollection: targetKuId === kuId ? (ku.type === 'Concept' ? 'concepts' : 'knowledge-units') : 'knowledge-units',
          facetType: entry.type,
          srsStage: startAtSrsStage,
          nextReviewAt,
          createdAt: now,
          history: [],
          sequenceStage: stageDef.stage,
          source: { type: 'lesson', id: kuId },
          ...(startAtSrsStage > 0 ? { selfCertified: true } : {}),
          ...this.facetStore.ownerTag(uid),
          data,
        });
        count++;
        facetCountByKuId.set(targetKuId, (facetCountByKuId.get(targetKuId) ?? 0) + 1);
      }
    }

    if (count === 0) return 0;

    await batch.commit();
    // The word counts every facet in its sequence, including Kanji-Component-* ones that
    // target a component kanji's KU (which counts them too); same rule as UKU status.
    const increments = new Map(facetCountByKuId).set(kuId, count);
    await Promise.all(
      Array.from(increments.entries()).map(([targetKuId, n]) =>
        this.userKnowledgeUnitsService.update(uid, targetKuId, {
          facet_count: FieldValue.increment(n),
        }),
      ),
    );

    // Recompute status for any KU other than the parent that just got a facet
    // (i.e. Kanji stubs from a kanji-components entry) — the parent's own status
    // is recomputed by the caller (initializeSequence/checkAndAdvanceStage), but
    // a Kanji stub's status would otherwise stay stuck at 'learning' until its
    // facet is actually reviewed for the first time (recomputeAndCache is also
    // called reactively from updateFacetSrs, but only after that first review).
    await Promise.all(
      Array.from(facetCountByKuId.keys())
        .filter(targetKuId => targetKuId !== kuId)
        .map(targetKuId => this.learningProgressService.recomputeAndCache(uid, targetKuId)),
    );

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
      if (vl.kanaOnly) return []; // never queue kanji-component facets for a word decided kana-only
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
        // One rotating facet per grammar point (the card picks an example each review),
        // not one facet per example — and only examples long enough to be a real
        // exercise. No useful example → [] → the stage is skipped (stageIsApplicable).
        const examples = (gl.examples ?? [])
          .filter(ex => ex.japanese && isUsefulAssembly(ex.fragments))
          .map(ex => ({
            fragments: ex.fragments,
            answer: ex.japanese,
            english: ex.english,
            accepted_alternatives: ex.accepted_alternatives ?? [],
            learnableTerms: ex.learnableTerms ?? [],
          }));
        return examples.length > 0 ? [{ goalTitle: gl.pattern, examples }] : [];
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

      // Skip the reading review for a word with no kanji: there's nothing to read. (Comparing
      // vocab with reading missed katakana words, whose reading is stored in hiragana.)
      if (entry.type === 'Content-to-Reading' && kanjiIn(vl.vocab).length === 0) return [];

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
