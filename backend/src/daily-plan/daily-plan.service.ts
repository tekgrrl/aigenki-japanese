import { Injectable, Inject, Logger } from '@nestjs/common';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION, KNOWLEDGE_UNITS_COLLECTION } from '../firebase/firebase.module';
import { PromotedEntry, ReviewFacet, ScenarioOpportunity, UserRoot } from '../types';
import { FacetStore } from '../facets/facet-store';

const HOUR_MS = 60 * 60 * 1000;

/**
 * `existing` without entries older than `windowMs` or for the same kuId, plus `entry`. An entry with
 * no usable timestamp (a hand edit, a legacy value) is dropped rather than failing the whole write.
 */
function withRecent<T extends { kuId: string }>(existing: T[] | undefined, entry: T, tsKey: keyof T, windowMs: number): T[] {
  const cutoffMs = Date.now() - windowMs;
  const millis = (e: T) => (e[tsKey] as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
  return [
    ...(existing ?? []).filter(e => millis(e) > cutoffMs && e.kuId !== entry.kuId),
    entry,
  ];
}

export interface LeechEntry {
  kuId: string;
  content: string;
  type: string;
  consecutiveFailures: number;
}

export interface DailyPlan {
  date: string;
  reviewsDue: number;
  suggestNewContent: boolean;
  threshold: number;
  recentPromotions: PromotedEntry[];
  topLeeches: LeechEntry[];
  practiceOpportunities: ScenarioOpportunity[];
  createdAt: Timestamp;
}

@Injectable()
export class DailyPlanService {
  private readonly logger = new Logger(DailyPlanService.name);

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly facetStore: FacetStore,
  ) {}

  /**
   * After a review promoted a KU: records it in `stats.recentlyPromoted` (kept 48h) and, when given,
   * a dismissible "practice this in a Scenario" opportunity in `stats.scenarioOpportunities` (kept
   * 7 days, since it's acted on at leisure). Both lists are de-duped by kuId, in one transaction.
   * Purely daily-plan suggestions: never read by SRS/facet logic.
   */
  async recordPromotion(
    uid: string,
    entry: Omit<PromotedEntry, 'promotedAt'>,
    opportunity?: Omit<ScenarioOpportunity, 'createdAt'>,
  ): Promise<void> {
    const userRef = this.db.collection('users').doc(uid);
    await this.db.runTransaction(async (transaction) => {
      const stats = (await transaction.get(userRef)).data()?.stats ?? {};
      const now = Timestamp.now();
      transaction.update(userRef, {
        'stats.recentlyPromoted': withRecent<PromotedEntry>(stats.recentlyPromoted, { ...entry, promotedAt: now }, 'promotedAt', 48 * HOUR_MS),
        ...(opportunity ? {
          'stats.scenarioOpportunities': withRecent<ScenarioOpportunity>(stats.scenarioOpportunities, { ...opportunity, createdAt: now }, 'createdAt', 7 * 24 * HOUR_MS),
        } : {}),
      });
    });
  }

  /** Removes a single scenario opportunity by kuId from stats. Only via dismissOpportunity, which also patches today's cached plan. */
  private async removeScenarioOpportunity(uid: string, kuId: string): Promise<void> {
    const userRef = this.db.collection('users').doc(uid);
    await this.db.runTransaction(async (transaction) => {
      const doc = await transaction.get(userRef);
      const existing: ScenarioOpportunity[] = doc.data()?.stats?.scenarioOpportunities ?? [];
      const remaining = existing.filter(e => e.kuId !== kuId);
      transaction.update(userRef, { 'stats.scenarioOpportunities': remaining });
    });
  }

  /**
   * Dismisses a single scenario-practice opportunity. Removes it from stats (so future
   * daily plans won't include it) and patches today's already-cached plan doc directly,
   * since check() serves that cached doc for the rest of the day otherwise.
   */
  async dismissOpportunity(uid: string, kuId: string): Promise<void> {
    await this.removeScenarioOpportunity(uid, kuId);
    const planRef = this.db.collection('daily-plans').doc(uid);
    const planDoc = await planRef.get();
    if (planDoc.exists) {
      const plan = planDoc.data() as DailyPlan;
      const updated = (plan.practiceOpportunities ?? []).filter(o => o.kuId !== kuId);
      await planRef.update({ practiceOpportunities: updated });
    }
  }

  async check(uid: string): Promise<{ isNewDay: boolean; plan: DailyPlan }> {
    const today = new Date().toISOString().slice(0, 10);
    const userRef = this.db.collection('users').doc(uid);
    const planRef = this.db.collection('daily-plans').doc(uid);

    const [userDoc, planDoc] = await Promise.all([userRef.get(), planRef.get()]);
    const userData = userDoc.data() as UserRoot | undefined;

    if (userData?.lastDailyPlanDate === today && planDoc.exists) {
      this.logger.log(`Daily plan already generated for uid=${uid} date=${today}`);
      // The rest of the plan is a once-a-day snapshot, but the due count must be live:
      // lessons finished (or reviews done) since the plan was made change it.
      const cached = planDoc.data() as DailyPlan;
      const reviewsDue = await this.countDue(uid);
      return { isNewDay: false, plan: { ...cached, reviewsDue, suggestNewContent: reviewsDue < cached.threshold } };
    }

    this.logger.log(`Generating new daily plan for uid=${uid} date=${today}`);
    const plan = await this.generatePlan(uid, userData, today);

    await Promise.all([
      planRef.set(plan),
      userRef.update({ lastDailyPlanDate: today }),
    ]);

    return { isNewDay: true, plan };
  }

  private async countDue(uid: string): Promise<number> {
    const snap = await this.facetStore.query(uid).where('nextReviewAt', '<=', Timestamp.now()).count().get();
    return snap.data().count;
  }

  private async generatePlan(uid: string, userData: UserRoot | undefined, today: string): Promise<DailyPlan> {
    const threshold: number = userData?.tutorContext?.preferences?.dailyMaxTotal ?? 20;

    const reviewsDue = await this.countDue(uid);

    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const recentPromotions: PromotedEntry[] = ((userData?.stats?.recentlyPromoted ?? []) as PromotedEntry[])
      .filter(e => (e.promotedAt as Timestamp).toMillis() > cutoffMs)
      .sort((a, b) => b.srsStage - a.srsStage);

    // No additional time-window filter — already pruned to 7 days at storage time
    // (recordPromotion), and dismissal (not display-window expiry) is the
    // intended removal mechanism so these stay visible until acted on.
    const practiceOpportunities: ScenarioOpportunity[] = (userData?.stats?.scenarioOpportunities ?? []) as ScenarioOpportunity[];

    const leechSnap = await this.facetStore.query(uid)
      .where('consecutiveFailures', '>=', 1)
      .orderBy('consecutiveFailures', 'desc')
      .limit(5)
      .get();

    const leechFacets = leechSnap.docs.map(d => ({ id: d.id, ...d.data() } as ReviewFacet));
    const kuIds = [...new Set(leechFacets.map(f => f.kuId).filter(Boolean))];

    const kuDocs = await Promise.all(
      kuIds.map(id => this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(id).get()),
    );
    const kuMap = new Map(kuDocs.filter(d => d.exists).map(d => [d.id, d.data()!]));

    const topLeeches: LeechEntry[] = leechFacets
      .map(f => {
        const ku = kuMap.get(f.kuId);
        if (!ku) return null;
        return {
          kuId: f.kuId,
          content: ku.content as string,
          type: ku.type as string,
          consecutiveFailures: f.consecutiveFailures ?? 0,
        };
      })
      .filter((x): x is LeechEntry => x !== null);

    return {
      date: today,
      reviewsDue,
      suggestNewContent: reviewsDue < threshold,
      threshold,
      recentPromotions,
      topLeeches,
      practiceOpportunities,
      createdAt: Timestamp.now(),
    };
  }
}
