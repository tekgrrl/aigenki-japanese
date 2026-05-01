import {
    Injectable,
    Inject,
    Logger,
    NotFoundException,
    forwardRef,
} from '@nestjs/common';
import { CollectionReference, FieldValue, Firestore, Query, Timestamp } from 'firebase-admin/firestore';
import {
    FIRESTORE_CONNECTION,
    REVIEW_FACETS_COLLECTION,
    USER_STATS_COLLECTION,
} from '../firebase/firebase.module';
import { ADMIN_USER_ID, MASTERED_STAGE, SELF_CERTIFIED_STAGE } from '../lib/constants';
import { GeminiService } from '../gemini/gemini.service';
import { QuestionsService } from '../questions/questions.service';
import { ReviewFacet } from '@/types';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { StatsService } from '../stats/stats.service';
import { ScenariosService } from '../scenarios/scenarios.service';
import { LearningProgressService } from '../learning-progress/learning-progress.service';
import { buildAnswerEvaluatorPrompt } from '../prompts/evaluation.prompts';

@Injectable()
export class ReviewsService {
    private readonly logger = new Logger(ReviewsService.name);

    // SRS intervals in hours (maps to srsStage)
    private readonly INTERVALS = {
        0: 10 / 60, // 10 minutes
        1: 8, // 8 hours
        2: 24, // 1 day
        3: 72, // 3 days
        4: 168, // 1 week
        5: 336, // 2 weeks
        6: 730, // 1 month (approx)
        7: 2920, // 4 months
        8: 8760, // 1 year
    };

    constructor(
        @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
        private readonly geminiService: GeminiService,
        @Inject(forwardRef(() => QuestionsService))
        private readonly questionsService: QuestionsService,
        private readonly knowledgeUnitsService: KnowledgeUnitsService,
        private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
        private readonly statsService: StatsService,
        private readonly scenariosService: ScenariosService,
        private readonly learningProgressService: LearningProgressService,
    ) { }

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

    async getByFacetId(uid: string, facetId: string) {
        const doc = await this.facetsColRef(uid).doc(facetId).get();
        if (!doc.exists) return null;
        return doc.data();
    }

    async updateFacetSrs(uid: string, facetId: string, result: 'pass' | 'fail') {
        const txResult = await this.db.runTransaction(async (transaction) => {
            const facetRef = this.facetsColRef(uid).doc(facetId);
            const facetDoc = await transaction.get(facetRef);

            if (!facetDoc.exists) {
                throw new NotFoundException('Facet not found');
            }

            // For user_default using the shared top-level collection, verify ownership
            if (uid === ADMIN_USER_ID && facetDoc.data()?.userId !== uid) {
                throw new NotFoundException('Facet not found');
            }

            const facetData = facetDoc.data() as ReviewFacet;

            // Determine the new SRS stage and time of next review
            const currentSrsStage = facetData.srsStage || 0;
            // Dates from Firestore are timestamps, convert if necessary (though usually handled by SDK)
            // const oldNextReviewDate = facetData.nextReviewAt ? facetData.nextReviewAt.toDate() : new Date();

            const nextSrsStage = this.calculateNextStage(currentSrsStage, result);

            const now = new Date();
            const hoursToAdd = nextSrsStage === 0 ? 0 : this.INTERVALS[nextSrsStage];
            const nextReviewDate = new Date(now.getTime() + hoursToAdd * 60 * 60 * 1000);

            // Calculate and update Stats via StatsService
            // Note: We use the *old* nextReviewAt for stats scheduling accuracy if needed
            const oldNextReviewDate = facetData.nextReviewAt instanceof Timestamp
                ? facetData.nextReviewAt.toDate()
                : (facetData.nextReviewAt ? new Date(facetData.nextReviewAt) : new Date());

            await this.statsService.updateReviewScheduleStats(
                uid,
                oldNextReviewDate,
                nextReviewDate,
                result,
                transaction
            );

            // WRITE (Facet)
            this.logger.log(`Updating facet ${facetId} to stage ${nextSrsStage} (${result.toUpperCase()})`);

            transaction.update(facetRef, {
                srsStage: nextSrsStage,
                nextReviewAt: nextReviewDate,
                lastReviewAt: now,
                history: FieldValue.arrayUnion({
                    stage: nextSrsStage,
                    timestamp: now,
                    result,
                }),
            });

            this.logger.log(
                `SRS Update [${facetId}]: ${result.toUpperCase()} | Stage ${currentSrsStage} -> ${nextSrsStage}`,
            );

            return {
                success: true,
                facetId,
                newStage: nextSrsStage,
                nextReview: nextReviewDate,
                kuId: facetData.kuId,
            };
        });

        // Post-transaction: recompute and cache UKU status from facet SRS data
        if (txResult.kuId) {
            await this.learningProgressService.recomputeAndCache(uid, txResult.kuId);
        }

        // Post-transaction: check if a linked scenario's vocab is now all drill-ready
        if (txResult.newStage >= 1 && txResult.kuId) {
            try {
                const uku = await this.userKnowledgeUnitsService.findByKuId(uid, txResult.kuId);
                if (uku?.source?.type === 'scenario') {
                    await this.scenariosService.checkAndSetVocabReady(uid, uku.source.id);
                }
            } catch (e) {
                this.logger.error(`Failed to check vocabReady for uid=${uid} kuId=${txResult.kuId}`, e);
            }
        }

        return { success: txResult.success, facetId: txResult.facetId, newStage: txResult.newStage, nextReview: txResult.nextReview };
    }

    /**
     * Calculates the next SRS stage based on the current stage and the result.
     * Implements the specific AISRS progression paths (Sumi-suri -> Mushin).
     */
    private calculateNextStage(currentStage: number, result: 'pass' | 'fail'): number {
        if (result === 'pass') {
            // Progression is linear: 0->1->2->3->4...->8
            // Capped at Stage 8 (Mushin)
            return Math.min(currentStage + 1, 8);
        } else {
            // Failure Transitions
            switch (currentStage) {
                case 0: return 0; // Sumi-suri: Initial -> Initial
                case 1: return 1; // Sumi-suri: Step 1 -> Step 1 (Reset to path start)
                case 2: return 1; // Sumi-suri: Step 2 -> Step 1
                case 3: return 1; // Sumi-suri: Step 3 -> Step 1
                case 4: return 2; // Kaisho I -> Sumi-suri III (Stage 2) - "Two failures in Kaisho resets back to SRS 2"? 
                // Wait, clarification said: "Let's make it drop to SRS Stage 4". 
                // BUT also "Two failures in Kaisho resets back to SRS 2".
                // Let's re-read the approved logic table carefully.
                // Table says: 4 -> Fail -> 2.
                // Table says: 5 -> Fail -> 4.
                // This assumes "Two failures in Kaisho" means dropping from 5->4 (1 fail), then 4->2 (2 fails).
                // So 4->2 is correct per table.
                case 5: return 4; // Kaisho II -> Kaisho I
                case 6: return 4; // Gyosho -> Kaisho I
                case 7: return 6; // Sosho -> Gyosho
                case 8: return 6; // Mushin -> Gyosho
                default: return Math.max(0, currentStage - 1); // Fallback safe
            }
        }
    }

    async updateFacetQuestion(uid: string, facetId: string, questionId: string) {
        await this.facetsColRef(uid).doc(facetId).update({ currentQuestionId: questionId });
        this.logger.log(`Updated facet ${facetId} with new question ${questionId}`);
    }

    async evaluateAnswer(
        uid: string,
        userAnswer: string,
        expectedAnswers: string[],
        question: string,
        topic: string,
        questionId: string,
        kuId: string,
    ) {
        // 1. Local Check — strip trailing Japanese/ASCII punctuation before comparing
        const normalize = (s: string) => s.toLowerCase().replace(/[。、！？,.!?\s]+$/u, '').trim();
        const isLocalMatch = expectedAnswers.some(
            (ans) => normalize(ans) === normalize(userAnswer),
        );

        if (isLocalMatch) {
            this.logger.log(`Local match passed for topic: ${topic}`);
            if (questionId) {
                await this.questionsService.recordAnswer(uid, questionId, kuId, 'pass');
            }
            return { result: 'pass', explanation: 'Correct!' };
        }

        // 2. AI Fallback
        this.logger.log(`Local match failed for topic: ${topic}. Calling Gemini.`);

        const systemPrompt = buildAnswerEvaluatorPrompt(question, topic, expectedAnswers, userAnswer);

        const evalResult = await this.geminiService.evaluateAnswer(
            systemPrompt,
            userAnswer,
            expectedAnswers,
            { userAnswer, expectedAnswers, question, topic },
        ) as { result: 'pass' | 'fail'; explanation: string };

        if (questionId) {
            await this.questionsService.recordAnswer(uid, questionId, kuId, evalResult.result);
        }

        return evalResult;
    } // END evaluateAnswer

    async generateReviewFacets(
        uid: string,
        kuId: string,
        facetsToCreate: { key: string; data?: any }[],
        selfCertifiedFacets: string[] = [],
    ) {
        // Pre-fetch existing facets for the parent KU to prevent duplicates on re-submission
        const existingParentFacets = await this.getFacetsByKuId(uid, kuId);
        const existingParentTypes = new Set<string>(existingParentFacets.map(f => f.facetType));

        const batch = this.db.batch();
        let count = 0;                        // review facets created for the parent KU
        let kanjiLinked = 0;                  // Kanji component stubs linked
        const kanjiLinkedKuIds: { kuId: string; newFacetCount: number }[] = [];
        const now = Timestamp.now();
        const selfCertifiedNextReview = Timestamp.fromMillis(
            Date.now() + this.INTERVALS[SELF_CERTIFIED_STAGE] * 60 * 60 * 1000,
        );

        for (const facet of facetsToCreate) {
            const { key, data } = facet;
            this.logger.log(`Processing facet ${key} for KU ${kuId}`);
            const targetKuId = kuId;

            // --- Handle Kanji Components ---
            if (key.startsWith('Kanji-Component-') && key !== 'Kanji-Component-Meaning' && key !== 'Kanji-Component-Reading') {
                const parts = key.split('-');
                if (parts.length === 3) {
                    const kanjiChar = parts[2];
                    const kanjiKuId = await this.knowledgeUnitsService.ensureKanjiStub(kanjiChar, data);
                    await this.userKnowledgeUnitsService.create(uid, kanjiKuId, { type: 'lesson', id: kuId });

                    // Dedup: only create facets that don't already exist on the Kanji KU
                    const existingKanjiFacets = await this.getFacetsByKuId(uid, kanjiKuId);
                    const existingKanjiTypes = new Set(existingKanjiFacets.map(f => f.facetType));
                    let newFacetCount = 0;

                    if (!existingKanjiTypes.has('Kanji-Component-Meaning')) {
                        batch.set(this.facetsColRef(uid).doc(), {
                            kuId: kanjiKuId,
                            facetType: 'Kanji-Component-Meaning',
                            srsStage: 0,
                            nextReviewAt: now,
                            createdAt: now,
                            history: [],
                            source: { type: 'lesson', id: kuId },
                            ...(uid === ADMIN_USER_ID ? { userId: uid } : {}),
                            data: { content: kanjiChar, meaning: data?.meaning },
                        });
                        newFacetCount++;
                    }

                    if (!existingKanjiTypes.has('Kanji-Component-Reading')) {
                        batch.set(this.facetsColRef(uid).doc(), {
                            kuId: kanjiKuId,
                            facetType: 'Kanji-Component-Reading',
                            srsStage: 0,
                            nextReviewAt: now,
                            createdAt: now,
                            history: [],
                            source: { type: 'lesson', id: kuId },
                            ...(uid === ADMIN_USER_ID ? { userId: uid } : {}),
                            data: { content: kanjiChar, onyomi: data?.onyomi, kunyomi: data?.kunyomi },
                        });
                        newFacetCount++;
                    }

                    kanjiLinkedKuIds.push({ kuId: kanjiKuId, newFacetCount });
                    kanjiLinked++;
                }
                continue;
            }

            // Dedup: skip standard facets that already exist for the parent KU
            if (existingParentTypes.has(key)) {
                this.logger.log(`Skipping duplicate facet ${key} for KU ${kuId}`);
                continue;
            }

            let modifiedData = data ? { ...data } : undefined;

            if (key === 'audio' && modifiedData?.contextExample && modifiedData?.content) {
                try {
                    const clozeSentence = await this.geminiService.generateClozeSentence(modifiedData.content, modifiedData.contextExample.sentence);
                    modifiedData.clozeSentence = clozeSentence;
                } catch (err) {
                    this.logger.error(`Failed to generate cloze for audio facet ${kuId}`, err);
                }
            }

            // --- Create the Facet (Batch) ---
            const isSelfCertified = selfCertifiedFacets.includes(key);
            const startStage = isSelfCertified ? SELF_CERTIFIED_STAGE : 0;
            const nextReviewAt = isSelfCertified ? selfCertifiedNextReview : now;

            const newFacetRef = this.facetsColRef(uid).doc();
            batch.set(newFacetRef, {
                kuId: targetKuId,
                facetType: key,
                srsStage: startStage,
                nextReviewAt,
                createdAt: now,
                history: [],
                source: { type: 'lesson', id: kuId },
                ...(isSelfCertified ? { selfCertified: true } : {}),
                ...(uid === ADMIN_USER_ID ? { userId: uid } : {}),
                ...(modifiedData ? { data: modifiedData } : {}),
            });

            count++;
        }

        await batch.commit();

        // Update facet_count on parent UKU and recompute derived status
        if (count > 0 || kanjiLinked > 0) {
            try {
                if (count > 0) {
                    await this.userKnowledgeUnitsService.update(uid, kuId, {
                        facet_count: FieldValue.increment(count),
                    });
                }
                await this.learningProgressService.recomputeAndCache(uid, kuId);
            } catch (e) {
                this.logger.error(`Failed to update UKU for uid=${uid} kuId=${kuId}`, e);
            }
        }

        // Update each Kanji UKU in parallel
        await Promise.all(kanjiLinkedKuIds.map(async ({ kuId: kanjiKuId, newFacetCount }) => {
            try {
                if (newFacetCount > 0) {
                    await this.userKnowledgeUnitsService.update(uid, kanjiKuId, {
                        facet_count: FieldValue.increment(newFacetCount),
                    });
                }
                await this.learningProgressService.recomputeAndCache(uid, kanjiKuId);
            } catch (e) {
                this.logger.error(`Failed to update Kanji UKU for uid=${uid} kuId=${kanjiKuId}`, e);
            }
        }));

        return { success: true, count };
    } // END generateReviewFacets

    async getDueReviews(uid: string) {
        const now = Timestamp.now();

        const snapshot = await this.facetsBaseQuery(uid)
            .where('nextReviewAt', '<=', now)
            .orderBy('nextReviewAt', 'asc')
            .get();

        if (snapshot.empty) {
            this.logger.log(`No due reviews found for user ${uid}`);
            return [];
        }

        const reviewItems = snapshot.docs
            .map(doc => {
                const facet = { id: doc.id, ...doc.data() } as ReviewFacet;
                if (!facet.kuId) {
                    this.logger.warn(`Skipping corrupted facet ${facet.id}: missing kuId`);
                    return null;
                }
                return { facet };
            })
            .filter(item => item !== null);

        this.logger.log(`Found ${reviewItems.length} due reviews for user ${uid}`);
        return reviewItems;
    } // END getDueReviews

    async getAllFacets(uid: string) {
        const snapshot = await this.facetsBaseQuery(uid).get();

        if (snapshot.empty) {
            return [];
        }

        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                nextReviewAt: data.nextReviewAt instanceof Timestamp ? data.nextReviewAt.toDate().toISOString() : data.nextReviewAt,
                lastReviewAt: data.lastReviewAt instanceof Timestamp ? data.lastReviewAt.toDate().toISOString() : data.lastReviewAt,
                createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : data.createdAt,
            };
        });
    }

    async getFacetsByKuId(uid: string, kuId: string): Promise<ReviewFacet[]> {
        const snapshot = await this.facetsBaseQuery(uid)
            .where('kuId', '==', kuId)
            .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ReviewFacet));
    }

    async createFacetBatch(
        uid: string,
        facets: Array<{ kuId: string; facetType: ReviewFacet['facetType']; data?: any }>,
        source?: ReviewFacet['source'],
    ): Promise<number> {
        const batch = this.db.batch();
        const now = Timestamp.now();

        for (const facet of facets) {
            const ref = this.facetsColRef(uid).doc();
            batch.set(ref, {
                kuId: facet.kuId,
                facetType: facet.facetType,
                srsStage: 0,
                nextReviewAt: now,
                createdAt: now,
                history: [],
                ...(source ? { source } : {}),
                ...(uid === ADMIN_USER_ID ? { userId: uid } : {}),
                ...(facet.data ? { data: facet.data } : {}),
            });
        }

        await batch.commit();
        return facets.length;
    }

}
