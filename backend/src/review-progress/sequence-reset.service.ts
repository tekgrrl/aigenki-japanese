import { BadRequestException, Injectable, Inject, Logger } from '@nestjs/common';
import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION, KNOWLEDGE_UNITS_COLLECTION, USER_KUS_SUBCOLLECTION } from '../firebase/firebase.module';
import { ReviewFacet } from '../types';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { LessonsService } from '../lessons/lessons.service';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { LearningProgressService } from '../learning-progress/learning-progress.service';
import { TutorContextService } from '../tutor-context/tutor-context.service';
import { FacetStore } from '../facets/facet-store';
import { ReviewProgressService } from './review-progress.service';

/**
 * Admin tools that tear down a word's facet sequence: reset it (optionally after regenerating
 * the lesson) or send it back to lessons to be relearned audio-first. Rebuilding goes through
 * ReviewProgressService.initializeSequence; this service only depends on it, never the reverse.
 */
@Injectable()
export class SequenceResetService {
  private readonly logger = new Logger(SequenceResetService.name);

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly facetStore: FacetStore,
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
    private readonly lessonsService: LessonsService,
    private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
    private readonly learningProgressService: LearningProgressService,
    private readonly tutorContext: TutorContextService,
    private readonly reviewProgress: ReviewProgressService,
  ) {}

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

    const { stage, facetsCreated } = await this.reviewProgress.initializeSequence(uid, kuId, 0, { variant: previous?.sequenceVariant });
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
    const blocker = await this.reviewProgress.audioFirstBlocker(uid, kuId, { checkFlag: true });
    if (blocker) return no(blocker, facetCount);
    if (facets.length === 0) return no('Already waiting in your lessons: it will be taught audio-first');
    return { eligible: true, facetCount };
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
}
