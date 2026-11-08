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
    LESSONS_COLLECTION,
    QUESTIONS_COLLECTION,
    REVIEW_FACETS_COLLECTION,
    USER_STATS_COLLECTION,
} from '../firebase/firebase.module';
import { ADMIN_USER_ID, MASTERED_STAGE, SELF_CERTIFIED_STAGE, SRS_INTERVALS } from '../lib/constants';
import { GeminiService } from '../gemini/gemini.service';
import { QuestionsService } from '../questions/questions.service';
import { FacetType, Lesson, ReviewFacet, VocabLesson, VocabUsage } from '@/types';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { StatsService } from '../stats/stats.service';
import { ScenariosService, VOCAB_READY_MIN_STAGE } from '../scenarios/scenarios.service';
import { LearningProgressService } from '../learning-progress/learning-progress.service';
import { ReviewProgressService } from '../review-progress/review-progress.service';
import { KanjiService } from '../kanji/kanji.service';
import { ScenarioFlashService } from '../scenario-flash/scenario-flash.service';
import { buildAnswerEvaluatorPrompt, buildMeaningEvaluatorPrompt } from '../prompts/evaluation.prompts';
import { DEFAULT_USAGE_ID, usagesOf } from '../lessons/vocab-usages';
import { chooseMeaningForm, matchUsageLocally, meaningOutcome, MeaningOutcome, normaliseAnswer, stripTrailingPunctuation } from './meaning-card';
import { getSrsLevelIndex, getSrsLevelName } from '../lib/srs-levels';

/** A Grammar KU whose facet reaches this SRS stage gets its scenario chain (the user's rule, 2026-11-04; tunable). */
const SCENARIO_FLASH_STAGE = 3;

/**
 * Resolves which Firestore collection a ReviewFacet's kuId points to.
 * New facets carry sourceCollection explicitly; old documents fall back to
 * inferring from source.type, defaulting to 'knowledge-units'.
 */
export function resolveKuCollection(facet: Pick<ReviewFacet, 'sourceCollection' | 'source'>): 'knowledge-units' | 'concepts' | 'scenarios' {
    if (facet.sourceCollection) return facet.sourceCollection;
    if (facet.source?.type === 'concept') return 'concepts';
    return 'knowledge-units';
}

@Injectable()
export class ReviewsService {
    private readonly logger = new Logger(ReviewsService.name);

    // SRS intervals in hours (maps to srsStage).
    private readonly INTERVALS = SRS_INTERVALS;

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
        private readonly reviewProgressService: ReviewProgressService,
        private readonly kanjiService: KanjiService,
        private readonly scenarioFlashService: ScenarioFlashService,
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

    /** `usageId`: on a Vocab meaning card, the usage a correct answer matched (from evaluateAnswer). */
    async updateFacetSrs(uid: string, facetId: string, result: 'pass' | 'fail', usageId?: string) {
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

            // Vocab meaning card: the stage moves only once every usage is proven at this stage,
            // and a wrong answer counts only while nothing is proven (see meaning-card.ts).
            let meaning: { outcome: MeaningOutcome; proven: string[]; usageIds: string[] } | null = null;
            if (facetData.facetType === 'Content-to-Definition') {
                const lesson = (await transaction.get(this.db.collection(LESSONS_COLLECTION).doc(facetData.kuId))).data() as Lesson | undefined;
                if (lesson?.type === 'Vocab') {
                    const usageIds = usagesOf(lesson).map(u => u.id);
                    // A one-usage word: any correct answer proves it, as before usages existed.
                    const proved = usageIds.length === 1 ? usageIds[0] : usageId;
                    if (usageIds.length > 0) meaning = { ...meaningOutcome(result, proved, facetData.provenUsageIds, usageIds), usageIds };
                }
            }

            const usageResult = meaning ? { provenUsageIds: meaning.proven, totalUsages: meaning.usageIds.length, outcome: meaning.outcome } : {};
            if (meaning?.outcome === 'free-fail') {
                // Wrong while searching for another usage: the stage and the proven usages are
                // unchanged, but the card waits the stage's normal interval, as a hold does, so it
                // doesn't come straight back every session.
                const freeFailNext = new Date(Date.now() + this.INTERVALS[currentSrsStage] * 60 * 60 * 1000);
                transaction.update(facetRef, { nextReviewAt: freeFailNext, lastReviewAt: new Date() });
                this.logger.log(`SRS Update [${facetId}]: FAIL not counted (usages already proven at stage ${currentSrsStage}); due again at the stage interval`);
                return {
                    success: true,
                    facetId,
                    prevStage: currentSrsStage,
                    newStage: currentSrsStage,
                    nextReview: freeFailNext,
                    kuId: facetData.source?.id ?? facetData.kuId,
                    targetKuId: facetData.kuId,
                    facetType: facetData.facetType,
                    prevConsecutiveFailures: facetData.consecutiveFailures ?? 0,
                    newConsecutiveFailures: facetData.consecutiveFailures ?? 0,
                    ...usageResult,
                };
            }

            const nextSrsStage = meaning?.outcome === 'hold' ? currentSrsStage : this.calculateNextStage(currentSrsStage, result);

            const now = new Date();
            // Stage 0 after a fail is due again at once (relearn now). A held meaning-card answer
            // (correct, set incomplete) waits the stage's normal interval instead, or a word whose
            // other usages the learner can't think of yet comes straight back (でも, 2026-11-08).
            const hoursToAdd = meaning?.outcome === 'hold' ? this.INTERVALS[nextSrsStage] : nextSrsStage === 0 ? 0 : this.INTERVALS[nextSrsStage];
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

            // Track consecutive failures on the facet for leech detection
            const prevConsecutiveFailures = facetData.consecutiveFailures ?? 0;
            const newConsecutiveFailures = result === 'pass' ? 0 : prevConsecutiveFailures + 1;

            // WRITE (Facet)
            this.logger.log(`Updating facet ${facetId} to stage ${nextSrsStage} (${result.toUpperCase()})`);

            transaction.update(facetRef, {
                srsStage: nextSrsStage,
                nextReviewAt: nextReviewDate,
                lastReviewAt: now,
                consecutiveFailures: newConsecutiveFailures,
                ...(meaning ? { provenUsageIds: meaning.proven } : {}),
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
                prevStage: currentSrsStage,
                newStage: nextSrsStage,
                nextReview: nextReviewDate,
                // source.id is the KU whose sequence this facet gates — the same
                // KU passed to initializeSequence/checkAndAdvanceStage throughout.
                // For most facet types this equals facetData.kuId (self-referencing),
                // but Kanji-Component-* facets target a different KU (the component
                // kanji's own kuId) than the sequence they belong to (the parent
                // Vocab word's), so kuId alone silently pointed advancement checks
                // at the wrong (sequence-less) KU. See issue #244.
                kuId: facetData.source?.id ?? facetData.kuId,
                // The KU the facet tests; differs from kuId for Kanji-Component-* facets.
                targetKuId: facetData.kuId,
                facetType: facetData.facetType,
                prevConsecutiveFailures,
                newConsecutiveFailures,
                ...usageResult,
            };
        });

        // Post-transaction side effects below are not needed for the caller's immediate
        // response (only success/facetId/newStage/nextReview are used by the review UI),
        // so none of them block the response — each was previously awaited in sequence,
        // turning one review answer into 4-7 serial Firestore round trips.

        // Recompute and cache UKU status from facet SRS data
        if (txResult.kuId) {
            void (async () => {
                try {
                    await this.learningProgressService.recomputeAndCache(uid, txResult.kuId);
                    // A Kanji-Component facet also counts toward the component kanji's own status.
                    if (txResult.targetKuId && txResult.targetKuId !== txResult.kuId) {
                        await this.learningProgressService.recomputeAndCache(uid, txResult.targetKuId);
                    }
                } catch (e) {
                    this.logger.error(`recomputeAndCache failed uid=${uid} kuId=${txResult.kuId}`, e);
                }
            })();
        }

        // Check if this SRS update unlocks the next facet stage
        if (txResult.kuId && txResult.newStage > txResult.prevStage) {
            void (async () => {
                try {
                    await this.reviewProgressService.checkAndAdvanceStage(uid, txResult.kuId);
                } catch (e) {
                    this.logger.error(`checkAndAdvanceStage failed uid=${uid} kuId=${txResult.kuId}`, e);
                }
            })();
        }

        // Check if a linked scenario's vocab is now all drill-ready
        if (txResult.newStage >= VOCAB_READY_MIN_STAGE && txResult.kuId) {
            void (async () => {
                try {
                    const uku = await this.userKnowledgeUnitsService.findByKuId(uid, txResult.kuId);
                    if (uku?.source?.type === 'scenario') {
                        await this.scenariosService.checkAndSetVocabReady(uid, uku.source.id);
                    }
                } catch (e) {
                    this.logger.error(`Failed to check vocabReady for uid=${uid} kuId=${txResult.kuId}`, e);
                }
            })();
        }

        // Post-transaction: update tutorContext leech/weak-grammar tracking + record promotions
        if (txResult.kuId && txResult.facetType) {
            const { kuId, facetType, prevConsecutiveFailures, newConsecutiveFailures, prevStage, newStage } = txResult;
            const LEECH_THRESHOLD = 3;
            void (async () => {
                try {
                    const ku = await this.knowledgeUnitsService.findOne(kuId);
                    const isGrammar = ku.type === 'Grammar';
                    // Audio-first (picture-choice) words are never shown written: keep them out of the
                    // tutor context (leechVocab, like frontierVocab) and the daily plan's promotions.
                    if (facetType === 'picture-choice') return;
                    if (newConsecutiveFailures >= LEECH_THRESHOLD) {
                        await this.statsService.addToLeechVocab(uid, ku.content, facetType);
                        if (isGrammar) await this.statsService.addToWeakGrammarPoints(uid, ku.content, facetType);
                    } else if (result === 'pass' && prevConsecutiveFailures > 0) {
                        await this.statsService.removeFromLeechVocab(uid, ku.content, facetType);
                        if (isGrammar) await this.statsService.removeFromWeakGrammarPoints(uid, ku.content, facetType);
                    }
                    if (result === 'pass' && newStage > prevStage) {
                        await this.statsService.recordPromotion(uid, {
                            kuId,
                            content: ku.content,
                            type: ku.type,
                            srsStage: newStage,
                        });
                        // Crossing into a new SRS level (not just a stage bump) — surface an
                        // optional "practice this in a Scenario" opportunity in the daily plan.
                        // Never touches SRS/facet state; purely a suggestion. Grammar only:
                        // Vocab's "Already Known" fast-track seeds facets at ALREADY_KNOWN_STAGE
                        // (one stage below the first level boundary), so a bulk-marked Vocab
                        // item's very first-ever review can cross a level immediately — surfacing
                        // "go practice this!" before any real spaced-repetition has happened.
                        // A Grammar point promoted to SRS stage 3 or above starts its scenario chain
                        // (Flash cards: Get to Drill → Graduate → Get to Simulate → Complete). Every
                        // learner is promoted through stage 3, so this fires once per learner; later
                        // promotions are cheap no-ops (start() dedupes on an existing chain and reuses
                        // an existing scenario). The chain replaces the "Ready to practice" suggestion.
                        const flashChain = ku.type === 'Grammar' && newStage >= SCENARIO_FLASH_STAGE && ku.data?.scenarioReady === true;
                        if (flashChain) {
                            void this.scenarioFlashService.start(uid, kuId).catch(e =>
                                this.logger.error(`Failed to start scenario Flash chain uid=${uid} kuId=${kuId}`, e),
                            );
                        }
                        if (ku.type === 'Grammar' && !flashChain && getSrsLevelIndex(newStage) > getSrsLevelIndex(prevStage)) {
                            await this.statsService.recordScenarioOpportunity(uid, {
                                kuId,
                                content: ku.content,
                                type: ku.type,
                                newLevel: getSrsLevelName(newStage),
                            });
                        }
                    }
                } catch (e) {
                    this.logger.error(`Failed to update tutorContext leech for uid=${uid} facetId=${facetId}`, e);
                }
            })();
        }

        return {
            success: txResult.success,
            facetId: txResult.facetId,
            newStage: txResult.newStage,
            nextReview: txResult.nextReview,
            // Vocab meaning card: the usage record after this answer, for the review screen.
            ...('outcome' in txResult ? { provenUsageIds: txResult.provenUsageIds, totalUsages: txResult.totalUsages, outcome: txResult.outcome } : {}),
        };
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
        facetType?: FacetType,
        facetId?: string,
    ) {
        const out = await this.evaluateAnswerCore(uid, userAnswer, expectedAnswers, question, topic, questionId, kuId, facetType, facetId);
        // Only meaning cards (bare word, or shown as an AI question) have a usage record to preview.
        if (facetType !== 'Content-to-Definition' && facetType !== 'AI-Generated-Question') return out;
        // A meaning card shown as an AI question proves the question's usage. Returned, so the
        // SRS update credits the same usage the preview used.
        const questionUsageId = facetType === 'AI-Generated-Question' && questionId
            ? ((await this.db.collection(QUESTIONS_COLLECTION).doc(questionId).get()).data()?.usageId as string | undefined)
            : undefined;
        const usageId = 'usageId' in out && out.usageId ? out.usageId : questionUsageId;
        const usagePreview = await this.meaningPreview(uid, facetId, out.result === 'pass' ? 'pass' : 'fail', usageId);
        return { ...out, ...(questionUsageId ? { usageId: questionUsageId } : {}), ...(usagePreview ? { usagePreview } : {}) };
    }

    /**
     * Vocab meaning card: what this answer will do to the card's usage record, without writing
     * anything. A new AI question applies its SRS result only after "Rate this question", so the
     * review screen shows the progress line from this. Null for any other card, or a one-usage word.
     */
    private async meaningPreview(uid: string, facetId: string | undefined, result: 'pass' | 'fail', usageId: string | undefined) {
        if (!facetId) return null;
        const facet = (await this.facetsColRef(uid).doc(facetId).get()).data() as ReviewFacet | undefined;
        if (facet?.facetType !== 'Content-to-Definition') return null;
        const lesson = (await this.db.collection(LESSONS_COLLECTION).doc(facet.kuId).get()).data() as Lesson | undefined;
        if (lesson?.type !== 'Vocab') return null;
        const usageIds = usagesOf(lesson).map(u => u.id);
        if (usageIds.length < 2) return null;
        const { outcome, proven } = meaningOutcome(result, usageId, facet.provenUsageIds, usageIds);
        return { outcome, provenCount: outcome === 'promote' ? usageIds.length : proven.length, totalUsages: usageIds.length };
    }

    private async evaluateAnswerCore(
        uid: string,
        userAnswer: string,
        expectedAnswers: string[],
        question: string,
        topic: string,
        questionId: string,
        kuId: string,
        facetType?: FacetType,
        facetId?: string,
    ) {
        // Vocab meaning card with built usages: match the answer to a usage.
        if (facetType === 'Content-to-Definition' && kuId) {
            const lesson = (await this.db.collection(LESSONS_COLLECTION).doc(kuId).get()).data() as Lesson | undefined;
            if (lesson?.type === 'Vocab' && (lesson.usages?.length ?? 0) > 0) {
                return this.evaluateMeaning(userAnswer, lesson, kuId, question, topic);
            }
        }

        // 1. Local Check — strip trailing Japanese/ASCII punctuation before comparing
        const stripTrailing = (s: string) => s.replace(/[。、！？,.!?\s]+$/u, '').trim();
        const normalize = (s: string) => stripTrailing(s.toLowerCase());
        const matchesLocally = (answers: string[]) =>
            answers.some((ans) => normalize(ans) === normalize(userAnswer));
        let isLocalMatch = matchesLocally(expectedAnswers);

        // The facet's meanings are the gloss of the word that introduced the kanji; the Kanji
        // lesson shows Kanji Alive's. Accept either — but only look Kanji Alive up when the
        // facet's own answers didn't match, so a correct answer never waits on the network.
        if (!isLocalMatch && facetType === 'Kanji-Component-Meaning' && topic) {
            const kanjiAlive = await this.kanjiService.getKanjiAliveMeanings(topic);
            expectedAnswers = Array.from(new Set([...expectedAnswers, ...kanjiAlive]));
            isLocalMatch = matchesLocally(expectedAnswers);
        }

        if (isLocalMatch) {
            this.logger.log(`Local match passed for topic: ${topic}`);
            if (questionId) {
                await this.questionsService.recordAnswer(uid, questionId, kuId, 'pass', facetType);
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
            await this.questionsService.recordAnswer(uid, questionId, kuId, evalResult.result, facetType);
        }

        // 3. Remember AI-accepted answers so the next attempt matches locally (no AI call).
        let addedAlternative: string | undefined;
        const accepted = stripTrailing(userAnswer.trim());
        if (evalResult.result === 'pass' && accepted) {
            addedAlternative = await this.addAcceptedAlternative(uid, accepted, facetType, questionId, facetId);
        }

        return { ...evalResult, ...(addedAlternative ? { addedAlternative } : {}) };
    } // END evaluateAnswer

    /**
     * The Vocab meaning card: the answer may give any usage's meaning. Checked locally against
     * every usage's meaning and accepted answers, otherwise by the AI with the usage list. A
     * correct answer returns the usage it matched; one the AI accepted is added to that usage's
     * accepted answers so the next attempt matches locally.
     */
    private async evaluateMeaning(userAnswer: string, lesson: VocabLesson, kuId: string, question: string, topic: string) {
        const usages = usagesOf(lesson);
        const matched = (u: VocabUsage | undefined) => (u ? { usageId: u.id, usageLabel: u.label || u.meaning } : {});

        // What the review screen shows as the correct answer: the usages' meanings, not the old definitions list.
        const usageMeanings = usages.map(u => u.meaning);

        const local = matchUsageLocally(userAnswer, usages);
        if (local) {
            this.logger.log(`Local usage match for ${lesson.vocab}: "${userAnswer}" → ${local.label}`);
            return { result: 'pass' as const, explanation: 'Correct!', usageMeanings, ...matched(local) };
        }

        const prompt = buildMeaningEvaluatorPrompt(lesson.vocab, usages, userAnswer);
        const evalResult = await this.geminiService.evaluateAnswer(
            prompt,
            userAnswer,
            usages.map(u => u.meaning),
            { userAnswer, expectedAnswers: usages.map(u => u.meaning), question, topic },
            usages.map(u => u.id),
        ) as { result: 'pass' | 'fail'; explanation: string; usageId?: string; misspelled?: boolean };

        const usage = evalResult.result === 'pass' ? usages.find(u => u.id === evalResult.usageId) : undefined;
        let addedAlternative: string | undefined;
        const answer = stripTrailingPunctuation(userAnswer); // stored as typed, case kept
        // A forgiven misspelling passes, but is never stored: it would then pass locally for everyone.
        if (usage && answer && usage.id !== DEFAULT_USAGE_ID && !evalResult.misspelled) {
            addedAlternative = await this.addUsageAnswer(kuId, usage.id, answer);
        }
        return { result: evalResult.result, explanation: evalResult.explanation, usageMeanings, ...matched(usage), ...(addedAlternative ? { addedAlternative } : {}) };
    }

    /** Adds an AI-accepted answer to one usage's acceptedAnswers on the global lesson. Never fails the review. */
    private async addUsageAnswer(kuId: string, usageId: string, answer: string): Promise<string | undefined> {
        const ref = this.db.collection(LESSONS_COLLECTION).doc(kuId);
        try {
            const added = await this.db.runTransaction(async tx => {
                const lesson = (await tx.get(ref)).data() as VocabLesson | undefined;
                const usages = lesson?.usages ?? [];
                const target = usages.find(u => u.id === usageId);
                const known = (u: VocabUsage) => [u.meaning, ...u.acceptedAnswers].some(a => normaliseAnswer(a) === normaliseAnswer(answer));
                // Already accepted somewhere: adding it again (or to a second usage) would make it ambiguous.
                if (!target || usages.some(known)) return false;
                tx.update(ref, { usages: usages.map(u => (u.id === usageId ? { ...u, acceptedAnswers: [...u.acceptedAnswers, answer] } : u)) });
                return true;
            });
            if (!added) return undefined;
            this.logger.log(`Added accepted answer "${answer}" to usage ${usageId} of lesson ${kuId}`);
            return answer;
        } catch (err) {
            this.logger.error(`Failed to add accepted answer to usage ${usageId} of lesson ${kuId}`, err);
            return undefined;
        }
    }

    /**
     * AI-Generated-Question answers live on the global Question doc (already app-mutated
     * via rank), so the alternative goes there. Every other facet type takes its expected
     * answers from the user's own facet data, so the alternative goes on the facet.
     * Never fails the review — returns the stored value, or undefined if nothing was written.
     */
    private async addAcceptedAlternative(
        uid: string,
        answer: string,
        facetType: FacetType | undefined,
        questionId: string | undefined,
        facetId: string | undefined,
    ): Promise<string | undefined> {
        try {
            if (facetType === 'AI-Generated-Question') {
                if (!questionId) return undefined;
                await this.questionsService.addAcceptedAlternative(questionId, answer);
                this.logger.log(`Added accepted alternative "${answer}" to question ${questionId}`);
                return answer;
            }
            if (!facetId) return undefined;
            await this.facetsColRef(uid).doc(facetId).update({
                'data.acceptedAlternatives': FieldValue.arrayUnion(answer),
            });
            this.logger.log(`Added accepted alternative "${answer}" to facet ${facetId} (${facetType})`);
            return answer;
        } catch (err) {
            this.logger.error(`Failed to store accepted alternative "${answer}" (facet=${facetId}, question=${questionId})`, err);
            return undefined;
        }
    }

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
                            sourceCollection: 'knowledge-units',
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
                            sourceCollection: 'knowledge-units',
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

            // --- Create the Facet (Batch) ---
            const isSelfCertified = selfCertifiedFacets.includes(key);
            const startStage = isSelfCertified ? SELF_CERTIFIED_STAGE : 0;
            const nextReviewAt = isSelfCertified ? selfCertifiedNextReview : now;

            const newFacetRef = this.facetsColRef(uid).doc();
            batch.set(newFacetRef, {
                kuId: targetKuId,
                sourceCollection: 'knowledge-units',
                facetType: key,
                srsStage: startStage,
                nextReviewAt,
                createdAt: now,
                history: [],
                source: { type: 'lesson', id: kuId },
                ...(isSelfCertified ? { selfCertified: true } : {}),
                ...(uid === ADMIN_USER_ID ? { userId: uid } : {}),
                ...(data ? { data } : {}),
            });

            count++;
        }

        await batch.commit();

        // Update facet_count on parent UKU and recompute derived status
        if (count > 0 || kanjiLinked > 0) {
            try {
                if (count > 0) {
                    // create is idempotent — returns existing UKU if one already exists
                    await this.userKnowledgeUnitsService.create(uid, kuId);
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
        // Flash cards follow their scenario's state; bring them up to date first. Never
        // let a sync problem block reviews.
        try {
            await this.scenarioFlashService.sync(uid);
        } catch (e) {
            this.logger.error(`Scenario Flash sync failed uid=${uid}`, e);
        }
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

        const withForms = await this.addMeaningForms(reviewItems);
        this.logger.log(`Found ${withForms.length} due reviews for user ${uid}`);
        return withForms;
    } // END getDueReviews

    /**
     * Vocab meaning cards: decide whether each is shown as the bare word or as an AI question
     * for one unproven usage (chooseMeaningForm). The card itself is unchanged; the item carries
     * `presentAs`, `usageId` and `usageLabel`.
     */
    private async addMeaningForms<T extends { facet: ReviewFacet }>(items: T[]): Promise<(T & { presentAs?: 'AI-Generated-Question'; usageId?: string; usageLabel?: string })[]> {
        const meaningKuIds = [...new Set(items.filter(i => i.facet.facetType === 'Content-to-Definition').map(i => i.facet.kuId))];
        if (meaningKuIds.length === 0) return items;
        const docs = await this.db.getAll(...meaningKuIds.map(id => this.db.collection(LESSONS_COLLECTION).doc(id)));
        const usagesByKu = new Map<string, VocabUsage[]>();
        docs.forEach(d => {
            const lesson = d.data() as Lesson | undefined;
            // Only built usages: a lesson still on its synthetic 'default' usage gets the bare word.
            if (lesson?.type === 'Vocab' && (lesson.usages?.length ?? 0) > 0) usagesByKu.set(d.id, lesson.usages!);
        });
        return items.map(item => {
            const usages = item.facet.facetType === 'Content-to-Definition' ? usagesByKu.get(item.facet.kuId) : undefined;
            const form = usages ? chooseMeaningForm(item.facet.srsStage ?? 0, item.facet.provenUsageIds, usages.map(u => u.id)) : null;
            if (!form) return item;
            const usage = usages!.find(u => u.id === form.usageId)!;
            return { ...item, ...form, usageLabel: usage.label || usage.meaning };
        });
    }

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
        const sourceCollection = resolveKuCollection({ source });

        for (const facet of facets) {
            const ref = this.facetsColRef(uid).doc();
            batch.set(ref, {
                kuId: facet.kuId,
                sourceCollection,
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
