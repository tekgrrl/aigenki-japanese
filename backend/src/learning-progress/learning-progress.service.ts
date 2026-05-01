import { Injectable, Inject, Logger } from '@nestjs/common';
import { CollectionReference, Firestore, Query } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION, REVIEW_FACETS_COLLECTION } from '../firebase/firebase.module';
import { ADMIN_USER_ID, MASTERED_STAGE } from '../lib/constants';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { ReviewFacet } from '../types';

@Injectable()
export class LearningProgressService {
    private readonly logger = new Logger(LearningProgressService.name);

    constructor(
        @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
        private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
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
        const facets = await this.getFacetsForKu(uid, kuId);

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
        } catch (e) {
            this.logger.error(`Failed to recompute UKU status for uid=${uid} kuId=${kuId}`, e);
        }
    }
}
