import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CollectionReference, Firestore, Query, Timestamp } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION, REVIEW_FACETS_COLLECTION } from '../firebase/firebase.module';
import { ADMIN_USER_ID, SRS_INTERVALS } from '../lib/constants';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { ScenariosService } from '../scenarios/scenarios.service';
import { DailyPlanService } from '../daily-plan/daily-plan.service';
import { TutorService } from '../tutor/tutor.service';
import { Scenario } from '../types';

/** The scenario chain a Grammar KU gets at SRS stage 3, one Flash card at a time. */
export type ScenarioFlashStep = 'drill' | 'graduate' | 'simulate' | 'complete';

export interface ScenarioFlashData {
  kind: 'scenario';
  step: ScenarioFlashStep;
  scenarioId: string;
  scenarioTitle: string;
  grammarKuId: string;
  grammarContent: string;
}

/**
 * A card the user has seen (opened the scenario, or "Not now") leaves the queue for the
 * first SRS interval (stage 0 → 1: 8h), then comes back if its step still isn't done.
 * Seeing a card is all it asks: the scenario itself is never a must-do.
 */
const SEEN_SNOOZE_HOURS = SRS_INTERVALS[1];

/**
 * Flash cards: one-and-done review facets (facetType 'flash') that never go through SRS.
 * The scenario chain is Get to Drill → Graduate the Vocab and Grammar → Get to Simulate →
 * Complete. Cards read the scenario's own state (sync, run when reviews are fetched), so
 * ScenariosService needs no hooks. A card's kuId is the scenario id and it has no source,
 * so it never counts toward any user-knowledge-unit.
 */
@Injectable()
export class ScenarioFlashService {
  private readonly logger = new Logger(ScenarioFlashService.name);
  /** Grammar KUs whose chain is being started right now (scenario generation is slow). */
  private readonly starting = new Set<string>();

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
    private readonly scenariosService: ScenariosService,
    private readonly dailyPlanService: DailyPlanService,
    private readonly tutorService: TutorService,
  ) {}

  private facetsCol(uid: string): CollectionReference {
    return uid === ADMIN_USER_ID
      ? this.db.collection(REVIEW_FACETS_COLLECTION)
      : this.db.collection('users').doc(uid).collection(REVIEW_FACETS_COLLECTION);
  }

  private flashQuery(uid: string): Query {
    const q = this.facetsCol(uid).where('facetType', '==', 'flash');
    return uid === ADMIN_USER_ID ? q.where('userId', '==', uid) : q;
  }

  /**
   * Starts a Grammar KU's scenario chain (called when one of its facets reaches SRS stage 3).
   * Reuses a scenario built from this grammar point if there is one, otherwise generates
   * one the way "Ready to practice" does. Does nothing if a chain already exists.
   */
  async start(uid: string, grammarKuId: string): Promise<void> {
    const key = `${uid}:${grammarKuId}`;
    if (this.starting.has(key)) return;
    this.starting.add(key);
    try {
      const existing = await this.flashQuery(uid).where('data.grammarKuId', '==', grammarKuId).limit(1).get();
      if (!existing.empty) return;

      const ku = await this.knowledgeUnitsService.findOneById(grammarKuId);
      if (ku?.type !== 'Grammar') return;
      // Only grammar points marked ready in admin get a scenario (some, like よ or ね, may never).
      if (ku.data?.scenarioReady !== true) {
        this.logger.log(`start: grammar ${ku.content} (${grammarKuId}) isn't scenarioReady, no scenario chain`);
        return;
      }

      const previous = await this.scenariosService.getScenariosBySourceKuId(uid, grammarKuId);
      const scenarioId = previous[0]?.id ?? await this.tutorService.generateScenario(uid, {
        sourceType: 'grammar-pattern',
        pattern: ku.content,
        title: ku.data?.title,
        sourceKuId: grammarKuId,
        strict: true,
      });
      const scenario = scenarioId ? await this.scenariosService.getScenario(uid, scenarioId) : null;
      if (!scenario) {
        this.logger.warn(`start: no scenario for grammar ${grammarKuId} uid=${uid} (generation failed?)`);
        return;
      }

      const step = await this.currentStep(uid, scenario);
      if (step) {
        const data: ScenarioFlashData = {
          kind: 'scenario', step, scenarioId, scenarioTitle: scenario.title ?? '',
          grammarKuId, grammarContent: ku.content,
        };
        await this.facetsCol(uid).doc().set({
          facetType: 'flash',
          kuId: scenarioId,
          sourceCollection: 'scenarios',
          srsStage: 0,
          nextReviewAt: Timestamp.now(),
          createdAt: Timestamp.now(),
          history: [],
          data,
          ...(uid === ADMIN_USER_ID ? { userId: uid } : {}),
        });
      }
      // The check-in's "Ready to practice" suggestion for this grammar point is now handled
      // (stats and today's cached daily plan).
      await this.dailyPlanService.dismissOpportunity(uid, grammarKuId);
      this.logger.log(`start: grammar ${ku.content} (${grammarKuId}) uid=${uid} → scenario ${scenarioId} (${previous[0] ? 'reused' : 'generated'}), step=${step ?? 'done'}`);
    } finally {
      this.starting.delete(key);
    }
  }

  /**
   * Moves every Flash card on to the step its scenario has actually reached (run before
   * reviews are fetched). A finished chain, or one whose scenario was deleted, is removed.
   */
  async sync(uid: string): Promise<void> {
    const cards = await this.flashQuery(uid).get();
    for (const doc of cards.docs) {
      const data = doc.data().data as ScenarioFlashData | undefined;
      if (data?.kind !== 'scenario') continue;
      const scenario = await this.scenariosService.getScenario(uid, data.scenarioId);
      if (!scenario) {
        await doc.ref.delete();
        continue;
      }
      // Readiness is otherwise only re-checked when a scenario-sourced word is reviewed.
      if (scenario.state === 'drill') await this.scenariosService.checkAndSetVocabReady(uid, data.scenarioId);
      const step = await this.currentStep(uid, scenario);
      if (step === data.step) continue;
      if (!step) {
        await doc.ref.delete();
        this.logger.log(`sync: chain done for scenario ${data.scenarioId} uid=${uid}`);
      } else {
        await doc.ref.update({ 'data.step': step, 'data.scenarioTitle': scenario.title ?? data.scenarioTitle, nextReviewAt: Timestamp.now() });
        this.logger.log(`sync: scenario ${data.scenarioId} uid=${uid} ${data.step} → ${step}`);
      }
    }
  }

  /** The user has seen the card: hide it for SEEN_SNOOZE_HOURS (sync replaces it sooner if its step gets done). */
  async acknowledge(uid: string, facetId: string): Promise<void> {
    const ref = this.facetsCol(uid).doc(facetId);
    const doc = await ref.get();
    if (!doc.exists) throw new NotFoundException('Card not found');
    if (doc.data()!.facetType !== 'flash') throw new BadRequestException('Not a Flash card');
    await ref.update({ nextReviewAt: Timestamp.fromMillis(Date.now() + SEEN_SNOOZE_HOURS * 60 * 60 * 1000) });
  }

  /** The first step of the chain the scenario hasn't completed yet, or null when it's all done. */
  private async currentStep(uid: string, scenario: Scenario): Promise<ScenarioFlashStep | null> {
    // Deactivated by the user (scenarios list), or the roleplay ended (handleChat sets
    // isObjectiveMet and deactivates, before the user presses finish): the chain is done.
    if (scenario.isActive === false || scenario.isObjectiveMet === true) return null;
    switch (scenario.state) {
      case 'encounter':
        return 'drill';
      case 'drill':
        // Live readiness only, the same check the scenario page uses to enable Role Play. A
        // stored vocabReady can be stale (set under the old stage-1 gate, or an item lapsed).
        return (await this.scenariosService.scenarioReadiness(uid, scenario)).ready
          ? 'simulate'
          : 'graduate';
      case 'simulate':
        return 'complete';
      default:
        return null;
    }
  }
}
