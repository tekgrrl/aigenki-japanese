import { Injectable, Logger } from '@nestjs/common';
import { FacetType } from '../types';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { TutorContextService } from '../tutor-context/tutor-context.service';
import { DailyPlanService } from '../daily-plan/daily-plan.service';
import { ScenariosService, VOCAB_READY_MIN_STAGE } from '../scenarios/scenarios.service';
import { LearningProgressService } from '../learning-progress/learning-progress.service';
import { ReviewProgressService } from '../review-progress/review-progress.service';
import { ScenarioFlashService } from '../scenario-flash/scenario-flash.service';
import { getSrsLevelIndex, getSrsLevelName } from '../lib/srs-levels';

/** A Grammar KU whose facet reaches this SRS stage gets its scenario chain (the user's rule, 2026-11-04; tunable). */
const SCENARIO_FLASH_STAGE = 3;

/** A facet with this many consecutive failures makes its word a leech (and a Grammar point weak). */
const LEECH_THRESHOLD = 3;

type Ku = Awaited<ReturnType<KnowledgeUnitsService['findOne']>>;

/** What one graded review changed, as written by the SRS transaction in ReviewsService.updateFacetSrs. */
export interface GradedReview {
    result: 'pass' | 'fail';
    facetId: string;
    facetType?: FacetType;
    /** The KU the facet belongs to (a Kanji-Component facet's word). */
    kuId?: string;
    /** The KU the facet tests, when it differs from kuId (a Kanji-Component facet's kanji). */
    targetKuId?: string;
    prevStage: number;
    newStage: number;
    prevConsecutiveFailures: number;
    newConsecutiveFailures: number;
}

/**
 * Everything that reacts to a graded review, after the SRS transaction. Two chains run side by side,
 * each in a fixed order:
 *   progress: advance the facet sequence, then recompute UKU status (after the advance, so the last
 *     status write sees the advanced stage; F-001), then the component kanji's status
 *   the rest: scenario vocab readiness → leech vocab and weak grammar points → daily plan
 *     (promotion, scenario opportunity) → the scenario Flash chain
 * The rest needs nothing from progress, so a slow advance (Kanji Alive, facet creation) doesn't hold
 * it up. Every write is its own step that catches and logs its failure, so one failure doesn't skip
 * the others. Not awaited by the review answer: nothing here is in the response.
 */
@Injectable()
export class ReviewOutcomeService {
    private readonly logger = new Logger(ReviewOutcomeService.name);

    constructor(
        private readonly learningProgressService: LearningProgressService,
        private readonly reviewProgressService: ReviewProgressService,
        private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
        private readonly scenariosService: ScenariosService,
        private readonly knowledgeUnitsService: KnowledgeUnitsService,
        private readonly tutorContext: TutorContextService,
        private readonly dailyPlanService: DailyPlanService,
        private readonly scenarioFlashService: ScenarioFlashService,
    ) { }

    async onGraded(uid: string, review: GradedReview): Promise<void> {
        const { kuId } = review;
        if (!kuId) return;
        await Promise.all([this.updateProgress(uid, kuId, review), this.reactToGrade(uid, kuId, review)]);
    }

    private async step(name: string, uid: string, review: GradedReview, run: () => Promise<unknown>): Promise<void> {
        try {
            await run();
        } catch (e) {
            this.logger.error(`onGraded ${name} failed uid=${uid} kuId=${review.kuId} facetId=${review.facetId}`, e);
        }
    }

    private async updateProgress(uid: string, kuId: string, review: GradedReview): Promise<void> {
        // An advance recomputes the status itself, after writing the new stage.
        let advanced = false;
        if (review.newStage > review.prevStage) {
            await this.step('sequence advance', uid, review, async () => {
                advanced = await this.reviewProgressService.checkAndAdvanceStage(uid, kuId);
            });
        }
        if (!advanced) await this.step('status recompute', uid, review, () => this.learningProgressService.recomputeAndCache(uid, kuId));
        // A Kanji-Component facet also counts toward the component kanji's own status.
        if (review.targetKuId && review.targetKuId !== kuId) {
            const target = review.targetKuId;
            await this.step('component kanji status', uid, review, () => this.learningProgressService.recomputeAndCache(uid, target));
        }
    }

    private async reactToGrade(uid: string, kuId: string, review: GradedReview): Promise<void> {
        await this.step('scenario vocabReady', uid, review, () => this.updateScenarioVocabReady(uid, kuId, review));

        // Audio-first (picture-choice) words are never shown written: keep them out of the tutor
        // context (leechVocab, like frontierVocab) and the daily plan. Checked before the KU read.
        if (!review.facetType || review.facetType === 'picture-choice') return;
        const facetType = review.facetType;
        const promoted = review.result === 'pass' && review.newStage > review.prevStage;
        const leechChange = this.leechChange(review);
        if (!leechChange && !promoted) return;

        let ku: Ku;
        try {
            ku = await this.knowledgeUnitsService.findOne(kuId);
        } catch (e) {
            this.logger.error(`onGraded: KU read failed uid=${uid} kuId=${kuId} facetId=${review.facetId}`, e);
            return;
        }
        if (leechChange) {
            await this.step('tutor context leech', uid, review, () =>
                this.tutorContext.updateLeech(uid, ku.content, facetType, leechChange, ku.type === 'Grammar'));
        }
        if (!promoted) return;
        const { newStage, prevStage } = review;
        // A Grammar point promoted to SRS stage 3 or above starts its scenario chain (Flash cards:
        // Get to Drill → Graduate → Get to Simulate → Complete). Every learner is promoted through
        // stage 3, so this fires once per learner; later promotions are cheap no-ops (start() dedupes
        // on an existing chain and reuses an existing scenario). The chain replaces the "Ready to
        // practice" suggestion.
        const flashChain = ku.type === 'Grammar' && newStage >= SCENARIO_FLASH_STAGE && ku.data?.scenarioReady === true;
        // Otherwise a Grammar point crossing into a new SRS level (not just a stage bump) gets an
        // optional "practice this in a Scenario" suggestion. Grammar only: Vocab's "Already Known"
        // fast-track seeds facets one stage below the first level boundary, so a bulk-marked word's
        // very first review could cross a level before any real spaced repetition.
        const opportunity = ku.type === 'Grammar' && !flashChain && getSrsLevelIndex(newStage) > getSrsLevelIndex(prevStage)
            ? { kuId, content: ku.content, type: ku.type, newLevel: getSrsLevelName(newStage) }
            : undefined;
        await this.step('daily plan', uid, review, () =>
            this.dailyPlanService.recordPromotion(uid, { kuId, content: ku.content, type: ku.type, srsStage: newStage }, opportunity));
        if (flashChain) await this.step('scenario Flash chain', uid, review, () => this.scenarioFlashService.start(uid, kuId));
    }

    /** A word learned for a scenario: once its facet is drill-ready, check whether the scenario's vocab all is. */
    private async updateScenarioVocabReady(uid: string, kuId: string, review: GradedReview): Promise<void> {
        if (review.newStage < VOCAB_READY_MIN_STAGE) return;
        const uku = await this.userKnowledgeUnitsService.findByKuId(uid, kuId);
        if (uku?.source?.type === 'scenario') await this.scenariosService.checkAndSetVocabReady(uid, uku.source.id);
    }

    /** 'add' when the facet just became a leech (or still is one), 'remove' on a pass after failures. */
    private leechChange(review: GradedReview): 'add' | 'remove' | null {
        if (review.newConsecutiveFailures >= LEECH_THRESHOLD) return 'add';
        if (review.result === 'pass' && review.prevConsecutiveFailures > 0) return 'remove';
        return null;
    }
}
