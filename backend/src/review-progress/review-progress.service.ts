import { BadRequestException, Injectable, Inject, Logger } from '@nestjs/common';
import { CollectionReference, FieldValue, Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  FIRESTORE_CONNECTION,
  PICTURES_COLLECTION,
  REVIEW_FACETS_COLLECTION,
} from '../firebase/firebase.module';
import { ADMIN_USER_ID, ALREADY_KNOWN_STAGE, SRS_INTERVALS } from '../lib/constants';
import { FACET_SEQUENCES } from '../lib/facet-sequences';
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
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
    private readonly lessonsService: LessonsService,
    private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
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

    const lesson = await this.lessonsService.findByKuId(uid, kuId);
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
    const [bySource, byKu] = await Promise.all([
      this.facetsColRef(uid).where('source.id', '==', kuId).get(),
      this.facetsColRef(uid).where('kuId', '==', kuId).get(),
    ]);
    const docs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    [...bySource.docs, ...byKu.docs].forEach(d => docs.set(d.id, d));

    const countByKuId = new Map<string, number>();
    const batch = this.db.batch();
    docs.forEach(d => {
      const target = (d.data().kuId as string) ?? kuId;
      countByKuId.set(target, (countByKuId.get(target) ?? 0) + 1);
      batch.delete(d.ref);
    });
    if (docs.size > 0) await batch.commit();

    await Promise.all(
      Array.from(countByKuId.entries())
        .filter(([target]) => target !== kuId)
        .map(async ([target, n]) => {
          await this.userKnowledgeUnitsService.update(uid, target, { facet_count: FieldValue.increment(-n) });
          await this.learningProgressService.recomputeAndCache(uid, target);
        }),
    );
    const previous = await this.userKnowledgeUnitsService.findByKuId(uid, kuId);
    await this.userKnowledgeUnitsService.update(uid, kuId, { currentStage: 0, facet_count: 0 });

    const { stage, facetsCreated } = await this.initializeSequence(uid, kuId, 0, { variant: previous?.sequenceVariant });
    if (facetsCreated === 0) await this.learningProgressService.recomputeAndCache(uid, kuId);

    // A component kanji enrolled through this word (its UKU's source) that has no facets
    // left after the rebuild would otherwise sit in the learning queue. Kanji enrolled any
    // other way (directly, a flag, a scenario, another word) are left alone.
    await Promise.all(
      Array.from(countByKuId.keys())
        .filter(target => target !== kuId)
        .map(async target => {
          const kanjiUku = await this.userKnowledgeUnitsService.findByKuId(uid, target);
          if (kanjiUku?.source?.type !== 'lesson' || kanjiUku.source.id !== kuId) return;
          const [byTarget, bySequence] = await Promise.all([
            this.facetsColRef(uid).where('kuId', '==', target).limit(1).get(),
            this.facetsColRef(uid).where('source.id', '==', target).limit(1).get(),
          ]);
          if (byTarget.empty && bySequence.empty) await this.userKnowledgeUnitsService.remove(uid, target);
        }),
    );

    this.logger.log(
      `resetSequence uid=${uid} kuId=${kuId}: deleted ${docs.size} facets (${JSON.stringify(Object.fromEntries(countByKuId))}), re-initialized stage=${stage} facets=${facetsCreated}`,
    );
    return { facetsDeleted: docs.size, stage, facetsCreated };
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
   */
  async checkAndAdvanceStage(uid: string, kuId: string, startAtSrsStage = 0): Promise<void> {
    const uku = await this.userKnowledgeUnitsService.findByKuId(uid, kuId);
    if (!uku?.currentStage) {
      this.logger.warn(`checkAndAdvanceStage: no UKU or currentStage for uid=${uid} kuId=${kuId} — sequence not initialized, or called with the wrong kuId`);
      return;
    }

    const ku = await this.knowledgeUnitsService.findOne(kuId);
    if (!ku) {
      this.logger.warn(`checkAndAdvanceStage: UKU exists but KU ${kuId} not found (uid=${uid}) — orphaned UKU`);
      return;
    }

    const sequence = this.sequenceFor(ku.type, uku.sequenceVariant);
    if (!sequence) {
      this.logger.warn(`checkAndAdvanceStage: no FACET_SEQUENCES entry for kuType=${ku.type} (kuId=${kuId})`);
      return;
    }

    const currentStageDef = sequence.stages.find(s => s.stage === uku.currentStage);
    if (!currentStageDef) {
      this.logger.warn(`checkAndAdvanceStage: UKU.currentStage=${uku.currentStage} for kuId=${kuId} doesn't match any defined stage in the ${ku.type} sequence`);
      return;
    }
    if (currentStageDef.unlockAtSrsStage === null) return; // terminal stage — normal, common, not logged

    // One read serves both the readiness check and isStillKnown below.
    const kuFacets = await this.getFacetsForKu(uid, kuId);
    const stageFacets = kuFacets.filter(f => f.sequenceStage === uku.currentStage);
    if (stageFacets.length === 0) {
      this.logger.warn(`checkAndAdvanceStage: UKU says currentStage=${uku.currentStage} for kuId=${kuId} but zero facets exist at that stage — sequence is stuck with nothing left to review`);
      return;
    }

    const allReady = stageFacets.every(
      f => (f.srsStage ?? 0) >= currentStageDef.unlockAtSrsStage!,
    );
    if (!allReady) return; // not every facet ready yet — normal, the common case, not logged

    const lesson = await this.lessonsService.findByKuId(uid, kuId);
    if (!lesson) {
      this.logger.warn(`checkAndAdvanceStage: no lesson found for kuId=${kuId} (uid=${uid}) despite having facets — can't determine next stage`);
      return;
    }

    const nextStage = this.findNextApplicableStage(sequence, lesson, uku.currentStage);
    if (!nextStage) {
      this.logger.debug(`checkAndAdvanceStage: no further applicable stage for kuId=${kuId} after stage ${uku.currentStage} — remaining stages not applicable to this lesson's content`);
      return;
    }

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
      return;
    }

    await this.userKnowledgeUnitsService.update(uid, kuId, { currentStage: result.stage.stage });
    await this.learningProgressService.recomputeAndCache(uid, kuId);

    if (startAtSrsStage > 0) {
      await this.checkAndAdvanceStage(uid, kuId, startAtSrsStage);
    }
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
   * Returns all facets in a KU's sequence, every stage.
   * Queries by source.id (the lesson/sequence lineage), not kuId — some facets
   * (e.g. Kanji-Component-*) target a different KU's content than the one whose
   * sequence they gate, so kuId alone can't identify stage membership.
   */
  private async getFacetsForKu(uid: string, kuId: string): Promise<ReviewFacet[]> {
    const snapshot = await this.facetsColRef(uid).where('source.id', '==', kuId).get();
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }) as ReviewFacet);
  }

  /** The facets belonging to one sequence stage (see getFacetsForKu). */
  private async getFacetsAtStage(
    uid: string,
    kuId: string,
    stage: number,
  ): Promise<ReviewFacet[]> {
    return (await this.getFacetsForKu(uid, kuId)).filter(f => f.sequenceStage === stage);
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
    if (resetFrom) {
      if (resetFrom.variant !== 'audio-first') return undefined;
    } else {
      const user = await this.db.collection('users').doc(uid).get();
      if (user.data()?.preferences?.audioFirstExperiment !== true) return undefined;
    }
    if ((await this.approvedPictures(ku.id)).length === 0) return undefined;
    return (await this.picturedWordCount()) >= MIN_PICTURED_WORDS ? 'audio-first' : undefined;
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
            const existing = await this.facetsColRef(uid)
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
        batch.set(this.facetsColRef(uid).doc(), {
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
          ...(uid === ADMIN_USER_ID ? { userId: uid } : {}),
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
