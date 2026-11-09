import { Injectable, Inject, Logger } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION, KNOWLEDGE_UNITS_COLLECTION } from '../firebase/firebase.module';
import { MASTERED_STAGE } from '../lib/constants';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { StatsService } from '../stats/stats.service';
import { ReviewFacet } from '../types';
import { FacetStore } from '../facets/facet-store';

@Injectable()
export class LearningProgressService {
    private readonly logger = new Logger(LearningProgressService.name);

    constructor(
        @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
        private readonly facetStore: FacetStore,
        private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
        private readonly statsService: StatsService,
    ) {}

    /**
     * Every facet that counts toward a KU's status: those targeting it (kuId) and those in
     * its own sequence (source.id). They differ for Kanji-Component-* facets, which target
     * the component kanji's KU while belonging to the word's sequence, so a word whose
     * first stage is only kanji components would otherwise look like it has no facets.
     */
    private async getFacetsForKu(uid: string, kuId: string): Promise<ReviewFacet[]> {
        const [byTarget, bySequence] = await Promise.all([
            this.facetStore.query(uid).where('kuId', '==', kuId).get(),
            this.facetStore.query(uid).where('source.id', '==', kuId).get(),
        ]);
        const byId = new Map<string, ReviewFacet>();
        for (const doc of [...byTarget.docs, ...bySequence.docs]) {
            byId.set(doc.id, { id: doc.id, ...doc.data() } as ReviewFacet);
        }
        return [...byId.values()];
    }

    /**
     * Derives UKU status from facet SRS data and writes it back to the UKU document.
     * This is the single place that determines and caches UKU status.
     *
     * Rules:
     *   - No facets          → 'learning'  (appears in learning queue)
     *   - Any facet < MASTERED_STAGE → 'reviewing'
     *   - All facets >= MASTERED_STAGE → 'mastered'
     */
    async recomputeAndCache(uid: string, kuId: string): Promise<void> {
        const [facets, currentUku] = await Promise.all([
            this.getFacetsForKu(uid, kuId),
            this.userKnowledgeUnitsService.findByKuId(uid, kuId),
        ]);

        const previousStatus = currentUku?.status;

        let status: 'learning' | 'reviewing' | 'mastered';
        if (facets.length === 0) {
            status = 'learning';
        } else if (facets.every(f => (f.srsStage ?? 0) >= MASTERED_STAGE)) {
            status = 'mastered';
        } else {
            status = 'reviewing';
        }

        try {
            await this.userKnowledgeUnitsService.update(uid, kuId, { status });
            this.logger.log(`UKU status=${status} for uid=${uid} kuId=${kuId}`);

            const isNewlyReviewing = status === 'reviewing' && previousStatus === 'learning';
            const isNewlyMastered = status === 'mastered' && previousStatus !== 'mastered';

            if (isNewlyReviewing || isNewlyMastered) {
                const kuDoc = await this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(kuId).get();
                const kuData = kuDoc.data();
                const jlptLevel = kuData?.data?.jlptLevel;
                const kuContent = kuData?.content as string | undefined;

                if (isNewlyReviewing && kuContent) {
                    const facetTypes = facets
                        .map(f => f.facetType)
                        // Audio-first words are known by sound and picture only: keep them out
                        // of the tutor context, or Gemini writes them in kanji as reinforcement.
                        .filter(t => t !== 'AI-Generated-Question' && t !== 'picture-choice');
                    if (facetTypes.length > 0) {
                        void this.statsService.addToFrontierVocab(uid, kuContent, facetTypes).catch(e =>
                            this.logger.error(`Failed to add frontierVocab uid=${uid} kuId=${kuId}`, e),
                        );
                    }
                }

                if (isNewlyMastered) {
                    if (jlptLevel) {
                        await this.statsService.recordKuMastered(uid, jlptLevel);
                        this.logger.log(`Mastered KU uid=${uid} kuId=${kuId} jlptLevel=${jlptLevel}`);
                    }
                    if (kuContent) {
                        void this.statsService.removeFromFrontierVocab(uid, kuContent).catch(e =>
                            this.logger.error(`Failed to remove frontierVocab uid=${uid} kuId=${kuId}`, e),
                        );
                    }
                }
            }
        } catch (e) {
            this.logger.error(`Failed to recompute UKU status for uid=${uid} kuId=${kuId}`, e);
        }
    }
}
