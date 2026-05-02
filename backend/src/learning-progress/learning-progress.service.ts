import { Injectable, Inject, Logger } from '@nestjs/common';
import { CollectionReference, Firestore, Query } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION, KNOWLEDGE_UNITS_COLLECTION, REVIEW_FACETS_COLLECTION } from '../firebase/firebase.module';
import { ADMIN_USER_ID, MASTERED_STAGE } from '../lib/constants';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { StatsService } from '../stats/stats.service';
import { ReviewFacet } from '../types';

@Injectable()
export class LearningProgressService {
    private readonly logger = new Logger(LearningProgressService.name);

    constructor(
        @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
        private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
        private readonly statsService: StatsService,
    ) {}

    private facetsColRef(uid: string): CollectionReference {
        if (uid === ADMIN_USER_ID) {
            return this.db.collection(REVIEW_FACETS_COLLECTION);
        }
        return this.db.collection('users').doc(uid).collection(REVIEW_FACETS_COLLECTION);
    }

    private facetsBaseQuery(uid: string): Query {
        const col = this.facetsColRef(uid);
        return uid === ADMIN_USER_ID ? col.where('userId', '==', uid) : col;
    }

    private async getFacetsForKu(uid: string, kuId: string): Promise<ReviewFacet[]> {
        const snapshot = await this.facetsBaseQuery(uid)
            .where('kuId', '==', kuId)
            .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ReviewFacet));
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
                        .filter(t => t !== 'AI-Generated-Question');
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
