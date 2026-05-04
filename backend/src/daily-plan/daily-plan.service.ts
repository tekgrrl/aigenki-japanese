import { Injectable, Inject, Logger } from '@nestjs/common';
import { Firestore, Query, Timestamp } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION, REVIEW_FACETS_COLLECTION, KNOWLEDGE_UNITS_COLLECTION } from '../firebase/firebase.module';
import { ADMIN_USER_ID } from '../lib/constants';
import { PromotedEntry, ReviewFacet, UserRoot } from '../types';

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
  createdAt: Timestamp;
}

@Injectable()
export class DailyPlanService {
  private readonly logger = new Logger(DailyPlanService.name);

  constructor(@Inject(FIRESTORE_CONNECTION) private readonly db: Firestore) {}

  private facetsBaseQuery(uid: string): Query {
    const col = uid === ADMIN_USER_ID
      ? this.db.collection(REVIEW_FACETS_COLLECTION).where('userId', '==', uid)
      : this.db.collection('users').doc(uid).collection(REVIEW_FACETS_COLLECTION);
    return col;
  }

  async check(uid: string): Promise<{ isNewDay: boolean; plan: DailyPlan }> {
    const today = new Date().toISOString().slice(0, 10);
    const userRef = this.db.collection('users').doc(uid);
    const planRef = this.db.collection('daily-plans').doc(uid);

    const [userDoc, planDoc] = await Promise.all([userRef.get(), planRef.get()]);
    const userData = userDoc.data() as UserRoot | undefined;

    if (userData?.lastDailyPlanDate === today && planDoc.exists) {
      this.logger.log(`Daily plan already generated for uid=${uid} date=${today}`);
      return { isNewDay: false, plan: planDoc.data() as DailyPlan };
    }

    this.logger.log(`Generating new daily plan for uid=${uid} date=${today}`);
    const plan = await this.generatePlan(uid, userData, today);

    await Promise.all([
      planRef.set(plan),
      userRef.update({ lastDailyPlanDate: today }),
    ]);

    return { isNewDay: true, plan };
  }

  private async generatePlan(uid: string, userData: UserRoot | undefined, today: string): Promise<DailyPlan> {
    const threshold: number = userData?.tutorContext?.preferences?.dailyMaxTotal ?? 20;

    const reviewsDueSnap = await this.facetsBaseQuery(uid)
      .where('nextReviewAt', '<=', Timestamp.now())
      .count()
      .get();
    const reviewsDue: number = reviewsDueSnap.data().count;

    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const recentPromotions: PromotedEntry[] = ((userData?.stats?.recentlyPromoted ?? []) as PromotedEntry[])
      .filter(e => (e.promotedAt as Timestamp).toMillis() > cutoffMs)
      .sort((a, b) => b.srsStage - a.srsStage);

    const leechSnap = await this.facetsBaseQuery(uid)
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
      createdAt: Timestamp.now(),
    };
  }
}
