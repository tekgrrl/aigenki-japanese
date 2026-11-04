import { BadRequestException, Injectable, Inject, Logger } from '@nestjs/common';
import { FieldValue, Firestore, Timestamp, Transaction } from 'firebase-admin/firestore';
import { FacetType, TutorVocabEntry } from '../types';
import {
    FIRESTORE_CONNECTION,
    REVIEW_FACETS_COLLECTION,
    USER_KUS_SUBCOLLECTION,
    SCENARIOS_COLLECTION,
} from '../firebase/firebase.module';
import { ADMIN_USER_ID } from '../lib/constants';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { isAboveLevel } from '../lib/jlpt';

@Injectable()
export class StatsService {
    private readonly logger = new Logger(StatsService.name);

    constructor(
        @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
        private readonly knowledgeUnitsService: KnowledgeUnitsService,
    ) { }

    async getDashboardStats(uid: string) {
        // ... existing queries ...
        const ukuLearnQuery = this.db.collection('users').doc(uid)
            .collection(USER_KUS_SUBCOLLECTION)
            .where("status", "==", "learning")
            .count()
            .get();

        const reviewQuery = this.db.collection('users').doc(uid)
            .collection(USER_KUS_SUBCOLLECTION)
            .where("status", "==", "reviewing")
            .count()
            .get();

        const masteredQuery = this.db.collection('users').doc(uid)
            .collection(USER_KUS_SUBCOLLECTION)
            .where("status", "==", "mastered")
            .count()
            .get();

        const facetsCol = uid === ADMIN_USER_ID
            ? this.db.collection(REVIEW_FACETS_COLLECTION).where('userId', '==', uid)
            : this.db.collection('users').doc(uid).collection(REVIEW_FACETS_COLLECTION);

        const reviewsDueQuery = facetsCol
            .where("nextReviewAt", "<=", Timestamp.now())
            .count()
            .get();

        // Earliest not-yet-reviewed facet, for the "Next reviews in X" dashboard indicator.
        const nextUpcomingQuery = facetsCol
            .orderBy("nextReviewAt", "asc")
            .limit(1)
            .get();

        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);
        const restOfTodayQuery = facetsCol
            .where("nextReviewAt", ">", Timestamp.now())
            .where("nextReviewAt", "<=", Timestamp.fromMillis(endOfToday.getTime()))
            .count()
            .get();

        // Days 1-4 — live per-day range count queries. Previously read from a denormalized
        // per-day cache (stats.reviewForecast) that only gets updated when an *existing*
        // facet is rescheduled after a review, never when a new facet is created — it drifts
        // silently over time. Direct queries here match the pattern already used above for
        // reviewsDueQuery/restOfTodayQuery.
        const now = new Date();
        const futureDayQueries: Promise<FirebaseFirestore.AggregateQuerySnapshot<{ count: FirebaseFirestore.AggregateField<number> }>>[] = [];
        for (let i = 1; i <= 4; i++) {
            const dayStart = new Date(now);
            dayStart.setDate(now.getDate() + i);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(dayStart);
            dayEnd.setHours(23, 59, 59, 999);
            futureDayQueries.push(
                // Lower bound is inclusive (>=) — dayStart is a fixed midnight instant, not
                // "now", so unlike reviewsDueQuery/restOfTodayQuery there's no shared boundary
                // with the previous query to dedupe against. A facet landing exactly on
                // midnight would otherwise fall through the gap between the previous day's
                // <= 23:59:59.999 and this day's > 00:00:00.000.
                facetsCol
                    .where("nextReviewAt", ">=", Timestamp.fromMillis(dayStart.getTime()))
                    .where("nextReviewAt", "<=", Timestamp.fromMillis(dayEnd.getTime()))
                    .count()
                    .get(),
            );
        }

        const userStatsQuery = this.db.collection('users').doc(uid).get();

        const scenariosCol = uid === ADMIN_USER_ID
            ? this.db.collection(SCENARIOS_COLLECTION)
            : this.db.collection('users').doc(uid).collection(SCENARIOS_COLLECTION);
        // isActive (not state === 'simulate') is what actually means "still needs
        // attention" — it already goes false on archive/reset and when a scenario is
        // abandoned mid-conversation; state alone would only count scenarios currently
        // mid-roleplay, missing ones still sitting in encounter/drill.
        const simulateScenariosQuery = scenariosCol
            .where('isActive', '==', true)
            .count()
            .get();

        const [
            ukuLearnSnapshot, reviewingSnapshot, masteredSnapshot, reviewsSnapshot,
            nextUpcomingSnapshot, restOfTodaySnapshot, userStatsDoc, simulateScenariosSnapshot,
            ...futureDaySnapshots
        ] = await Promise.all([
            ukuLearnQuery,
            reviewQuery,
            masteredQuery,
            reviewsDueQuery,
            nextUpcomingQuery,
            restOfTodayQuery,
            userStatsQuery,
            simulateScenariosQuery,
            ...futureDayQueries,
        ]);

        const reviewsDueCount = reviewsSnapshot.data().count;
        this.logger.log(`Reviews due for user ${uid}: ${reviewsDueCount}`);

        const userStats = userStatsDoc.data()?.stats ?? {};

        const currentStreak = userStats.currentStreak || 0;
        const totalActive = reviewingSnapshot.data().count + reviewsDueCount;

        // --- CALCULATION LOGIC ---

        // 1. Next reviews — the earliest upcoming facet's nextReviewAt, so the dashboard can
        // show a "Next reviews in X" countdown instead of a rolling-window count.
        const nextUpcomingDoc = nextUpcomingSnapshot.docs[0];
        const nextReviewAt: string | null = nextUpcomingDoc
            ? (nextUpcomingDoc.data().nextReviewAt as Timestamp).toDate().toISOString()
            : null;

        // 2. 5-Day Schedule
        // Day 0: Rest of Today (remaining hours)
        // Day 1-4: Full days (live per-day counts)

        const schedule: { date: string; isToday: boolean; count: number; runningTotal: number; label: string; }[] = [];
        let runningTotal = reviewsDueCount;

        // Day 0 (Today) — direct range query avoids hourly-bucket blind spots (e.g. same-hour reschedules)
        const todayRemainingCount = restOfTodaySnapshot.data().count;

        runningTotal += todayRemainingCount;
        schedule.push({
            date: this.getDateBuckets(now).dayKey,
            isToday: true,
            count: todayRemainingCount,
            runningTotal: runningTotal,
            label: 'Today'
        });

        // Days 1-4
        for (let i = 1; i <= 4; i++) {
            const futureDate = new Date(now);
            futureDate.setDate(now.getDate() + i);
            const key = this.getDateBuckets(futureDate).dayKey;

            const dayCount = futureDaySnapshots[i - 1].data().count;
            runningTotal += dayCount;

            schedule.push({
                date: key,
                isToday: false,
                count: dayCount,
                runningTotal: runningTotal,
                label: futureDate.toLocaleDateString('en-US', { weekday: 'short' }) // e.g. Mon, Tue
            });
        }

        return {
            learnCount: ukuLearnSnapshot.data().count,
            reviewingCount: reviewingSnapshot.data().count,
            masteredCount: masteredSnapshot.data().count,
            reviewCount: totalActive,
            reviewsDue: reviewsDueCount,
            simulateCount: simulateScenariosSnapshot.data().count,

            // New Widget Data
            nextReviewAt: nextReviewAt,
            schedule: schedule,

            // Legacy/Other support
            srsCounts: userStats.levelProgress || {},
            streak: currentStreak
        };
    }

    /**
     * Live per-hour breakdown of reviews due on a given day, for the dashboard's
     * lazily-loaded per-day drill-down. `dateKey` is "YYYY-MM-DD". For today, the lower
     * bound is "now" rather than midnight, matching how the day-level count in
     * getDashboardStats already excludes hours that have already passed.
     */
    async getHourlyBreakdown(uid: string, dateKey: string): Promise<{ hour: string; count: number }[]> {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
            throw new BadRequestException('date must be in YYYY-MM-DD format');
        }

        const facetsCol = uid === ADMIN_USER_ID
            ? this.db.collection(REVIEW_FACETS_COLLECTION).where('userId', '==', uid)
            : this.db.collection('users').doc(uid).collection(REVIEW_FACETS_COLLECTION);

        const now = new Date();
        const isToday = this.getDateBuckets(now).dayKey === dateKey;

        const [yyyy, mm, dd] = dateKey.split('-').map(Number);
        const dayEnd = new Date(yyyy, mm - 1, dd, 23, 59, 59, 999);
        const dayStart = isToday ? now : new Date(yyyy, mm - 1, dd, 0, 0, 0, 0);
        if (isNaN(dayEnd.getTime())) {
            throw new BadRequestException('date is not a valid calendar date');
        }

        // Lower bound: exclusive "now" for today (matches restOfTodayQuery's convention
        // elsewhere in this file), inclusive midnight for other days (a fixed instant, not
        // shared with an adjacent query's boundary, so it must include the boundary itself
        // to avoid dropping a facet landing exactly on midnight).
        const baseQuery = isToday
            ? facetsCol.where('nextReviewAt', '>', Timestamp.fromDate(dayStart))
            : facetsCol.where('nextReviewAt', '>=', Timestamp.fromDate(dayStart));

        const snapshot = await baseQuery
            .where('nextReviewAt', '<=', Timestamp.fromDate(dayEnd))
            .select('nextReviewAt')
            .get();

        const countsByHour = new Map<string, number>();
        for (const doc of snapshot.docs) {
            const nextReviewAt = (doc.data().nextReviewAt as Timestamp).toDate();
            const { hourKey } = this.getDateBuckets(nextReviewAt);
            countsByHour.set(hourKey, (countsByHour.get(hourKey) || 0) + 1);
        }

        return Array.from(countsByHour.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([hourKey, count]) => ({ hour: hourKey.slice(-2) + ':00', count }));
    }

    async updateReviewScheduleStats(
        userId: string,
        oldNextReviewAt: Date,
        newNextReviewAt: Date,
        result: 'pass' | 'fail',
        transaction: Transaction
    ) {
        const userRef = this.db.collection('users').doc(userId);
        const statsDoc = await transaction.get(userRef);
        const statsData = statsDoc.data()?.stats || {};

        const currentStats = {
            reviewForecast: statsData.reviewForecast || {},
            hourlyForecast: statsData.hourlyForecast || {},
            currentStreak: statsData.currentStreak || 0,
            lastReviewDate: statsData.lastReviewDate ? statsData.lastReviewDate.toDate() : null,
            totalReviews: statsData.totalReviews || 0,
            passedReviews: statsData.passedReviews || 0,
        };

        const now = new Date();

        // 1. Update Forecasts
        const oldBuckets = this.getDateBuckets(oldNextReviewAt);
        const newBuckets = this.getDateBuckets(newNextReviewAt);

        // Always decrement old bucket (cleaning up)
        if (currentStats.reviewForecast[oldBuckets.dayKey]) {
            currentStats.reviewForecast[oldBuckets.dayKey] = Math.max(0, currentStats.reviewForecast[oldBuckets.dayKey] - 1);
        }
        if (currentStats.hourlyForecast[oldBuckets.hourKey]) {
            currentStats.hourlyForecast[oldBuckets.hourKey] = Math.max(0, currentStats.hourlyForecast[oldBuckets.hourKey] - 1);
        }

        // Increment new bucket
        currentStats.reviewForecast[newBuckets.dayKey] = (currentStats.reviewForecast[newBuckets.dayKey] || 0) + 1;
        currentStats.hourlyForecast[newBuckets.hourKey] = (currentStats.hourlyForecast[newBuckets.hourKey] || 0) + 1;

        // 2. Update Streak
        const todayKey = this.getDateBuckets(now).dayKey;
        let newStreak = currentStats.currentStreak;

        if (currentStats.lastReviewDate) {
            const lastKey = this.getDateBuckets(currentStats.lastReviewDate).dayKey;

            if (lastKey !== todayKey) {
                // Check if it was yesterday
                const yesterday = new Date(now);
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayKey = this.getDateBuckets(yesterday).dayKey;

                if (lastKey === yesterdayKey) {
                    newStreak += 1;
                } else {
                    newStreak = 1; // Reset
                }
            }
        } else {
            newStreak = 1; // First review
        }

        // 3. Update Accuracy
        const newTotal = currentStats.totalReviews + 1;
        const newPassed = currentStats.passedReviews + (result === 'pass' ? 1 : 0);

        // 4. Write to users/{uid} using dot-notation to avoid clobbering other UserRoot fields
        transaction.update(userRef, {
            'stats.reviewForecast': currentStats.reviewForecast,
            'stats.hourlyForecast': currentStats.hourlyForecast,
            'stats.currentStreak': newStreak,
            'stats.lastReviewDate': now,
            'stats.totalReviews': newTotal,
            'stats.passedReviews': newPassed,
        });
    }

    /** Normalize "N5" / "JLPT-N5" / "JLPT N5" → "n5" for levelProgress map key. */
    private jlptKey(level: string): string | null {
        const m = level.match(/n(\d)/i);
        return m ? `n${m[1]}` : null;
    }

    async recordKuEnrolled(uid: string, jlptLevel: string): Promise<void> {
        const key = this.jlptKey(jlptLevel);
        if (!key) return;
        await this.db.collection('users').doc(uid).update({
            [`stats.levelProgress.${key}.total`]: FieldValue.increment(1),
        });
    }

    async recordKuMastered(uid: string, jlptLevel: string): Promise<void> {
        const key = this.jlptKey(jlptLevel);
        if (!key) return;
        await this.db.collection('users').doc(uid).update({
            [`stats.levelProgress.${key}.mastered`]: FieldValue.increment(1),
        });
    }

    /** Merge facetTypes into an existing entry (by content) or add a new entry. */
    private async mergeTutorVocabEntry(
        uid: string,
        field: 'frontierVocab' | 'leechVocab' | 'weakGrammarPoints',
        content: string,
        facetTypes: FacetType[],
    ): Promise<void> {
        const userRef = this.db.collection('users').doc(uid);
        await this.db.runTransaction(async (transaction) => {
            const doc = await transaction.get(userRef);
            const entries: TutorVocabEntry[] = doc.data()?.tutorContext?.[field] ?? [];
            const idx = entries.findIndex(e => e.content === content);
            if (idx >= 0) {
                const merged = Array.from(new Set([...entries[idx].facetTypes, ...facetTypes]));
                entries[idx] = { content, facetTypes: merged };
            } else {
                entries.push({ content, facetTypes });
            }
            transaction.update(userRef, { [`tutorContext.${field}`]: entries });
        });
    }

    /** Remove a specific facetType from an entry; drop the entry entirely if no facetTypes remain.
     *  Pass facetType=undefined to remove the whole entry regardless. */
    private async removeTutorVocabFacetType(
        uid: string,
        field: 'frontierVocab' | 'leechVocab' | 'weakGrammarPoints',
        content: string,
        facetType?: FacetType,
    ): Promise<void> {
        const userRef = this.db.collection('users').doc(uid);
        await this.db.runTransaction(async (transaction) => {
            const doc = await transaction.get(userRef);
            let entries: TutorVocabEntry[] = doc.data()?.tutorContext?.[field] ?? [];
            if (facetType === undefined) {
                entries = entries.filter(e => e.content !== content);
            } else {
                const idx = entries.findIndex(e => e.content === content);
                if (idx >= 0) {
                    const remaining = entries[idx].facetTypes.filter(t => t !== facetType);
                    if (remaining.length === 0) {
                        entries.splice(idx, 1);
                    } else {
                        entries[idx] = { content, facetTypes: remaining };
                    }
                }
            }
            transaction.update(userRef, { [`tutorContext.${field}`]: entries });
        });
    }

    async addToFrontierVocab(uid: string, content: string, facetTypes: FacetType[]): Promise<void> {
        await this.mergeTutorVocabEntry(uid, 'frontierVocab', content, facetTypes);
    }

    async removeFromFrontierVocab(uid: string, content: string): Promise<void> {
        await this.removeTutorVocabFacetType(uid, 'frontierVocab', content);
    }

    /** Drops a word from both frontierVocab and leechVocab (every facet type). */
    async removeFromTutorVocab(uid: string, content: string): Promise<void> {
        const userRef = this.db.collection('users').doc(uid);
        await this.db.runTransaction(async (transaction) => {
            const ctx = (await transaction.get(userRef)).data()?.tutorContext ?? {};
            const without = (entries: TutorVocabEntry[] = []) => entries.filter(e => e.content !== content);
            transaction.update(userRef, {
                'tutorContext.frontierVocab': without(ctx.frontierVocab),
                'tutorContext.leechVocab': without(ctx.leechVocab),
            });
        });
    }

    async addToLeechVocab(uid: string, content: string, facetType: FacetType): Promise<void> {
        await this.mergeTutorVocabEntry(uid, 'leechVocab', content, [facetType]);
    }

    async removeFromLeechVocab(uid: string, content: string, facetType: FacetType): Promise<void> {
        await this.removeTutorVocabFacetType(uid, 'leechVocab', content, facetType);
    }

    /**
     * Records an enrolled (at-or-below-level) Grammar KU as allowed for AI generation.
     * The KU id is the source of truth (`allowedGrammarKuIds`); text is resolved from the
     * current KU at read time by getAllowedGrammar(), so renames never go stale. The legacy
     * text snapshot (`allowedGrammar`) is still appended for now but no longer read.
     */
    async addToAllowedGrammar(uid: string, pattern: string, kuId: string): Promise<void> {
        // Make sure the id list exists (backfilled from user-kus) before appending to it,
        // otherwise the first arrayUnion would create a one-item list and skip the backfill.
        await this.getAllowedGrammarKuIds(uid);
        await this.db.collection('users').doc(uid).update({
            'tutorContext.allowedGrammarKuIds': FieldValue.arrayUnion(kuId),
            'tutorContext.allowedGrammar': FieldValue.arrayUnion(pattern),
        });
    }

    /**
     * The user's allowed grammar for AI generation, as current "content — title" strings
     * resolved from the in-memory KU cache. Deleted KUs simply drop out.
     */
    async getAllowedGrammar(uid: string, userData?: Record<string, any>): Promise<string[]> {
        const ids = await this.getAllowedGrammarKuIds(uid, userData);
        const kus = await this.knowledgeUnitsService.getManyCached(ids);
        return kus
            .filter(k => k.type === 'Grammar')
            .map(k => {
                const content = String(k.content ?? '').trim();
                const title = String((k.data as Record<string, any>)?.title ?? '').trim();
                return title && title !== content ? `${content} — ${title}` : content;
            });
    }

    private async getAllowedGrammarKuIds(uid: string, userData?: Record<string, any>): Promise<string[]> {
        const data = userData ?? (await this.db.collection('users').doc(uid).get()).data();
        const ids = data?.tutorContext?.allowedGrammarKuIds;
        if (Array.isArray(ids)) return ids as string[];
        return this.backfillAllowedGrammarKuIds(uid);
    }

    /**
     * One-off per user: rebuild the id list from the Grammar KUs they've actually enrolled
     * (not above level) — the legacy text list can't be mapped back reliably after renames.
     */
    private async backfillAllowedGrammarKuIds(uid: string): Promise<string[]> {
        const userRef = this.db.collection('users').doc(uid);
        const [userDoc, ukus] = await Promise.all([userRef.get(), userRef.collection(USER_KUS_SUBCOLLECTION).get()]);
        const userLevel = userDoc.data()?.preferences?.jlptLevel;
        const candidateIds = ukus.docs
            .filter(d => d.data().aboveLevel !== true)
            .map(d => (d.data().kuId as string | undefined) ?? d.id);
        // Re-check the level against the KU itself: legacy UKUs have no aboveLevel flag, and a
        // fresh enrolment's flag is written after the UKU, so the flag alone can let N3+ through.
        const grammarIds = (await this.knowledgeUnitsService.getManyCached(candidateIds))
            .filter(k => k.type === 'Grammar' && !isAboveLevel((k.data as Record<string, any>)?.jlptLevel, userLevel))
            .map(k => k.id);
        // arrayUnion, not a plain set: an enrolment's addToAllowedGrammar can land mid-backfill.
        // arrayUnion() with no elements throws, so with nothing to add just create the empty
        // list (only if still absent) so the backfill doesn't rerun on every call.
        if (grammarIds.length > 0) {
            await userRef.update({ 'tutorContext.allowedGrammarKuIds': FieldValue.arrayUnion(...grammarIds) });
        } else {
            await this.db.runTransaction(async tx => {
                const fresh = await tx.get(userRef);
                if (!Array.isArray(fresh.data()?.tutorContext?.allowedGrammarKuIds)) {
                    tx.update(userRef, { 'tutorContext.allowedGrammarKuIds': [] });
                }
            });
        }
        this.logger.log(`Backfilled allowedGrammarKuIds for ${uid}: ${grammarIds.length} grammar KUs`);
        return grammarIds;
    }

    async addToExcludedVocab(uid: string, content: string): Promise<void> {
        await this.db.collection('users').doc(uid).update({
            'tutorContext.excludedVocab': FieldValue.arrayUnion(content),
        });
    }

    async addToExcludedGrammar(uid: string, pattern: string): Promise<void> {
        await this.db.collection('users').doc(uid).update({
            'tutorContext.excludedGrammar': FieldValue.arrayUnion(pattern),
        });
    }

    async addToWeakGrammarPoints(uid: string, pattern: string, facetType: FacetType): Promise<void> {
        await this.mergeTutorVocabEntry(uid, 'weakGrammarPoints', pattern, [facetType]);
    }

    async removeFromWeakGrammarPoints(uid: string, pattern: string, facetType: FacetType): Promise<void> {
        await this.removeTutorVocabFacetType(uid, 'weakGrammarPoints', pattern, facetType);
    }

    async recordPromotion(uid: string, entry: Omit<import('../types').PromotedEntry, 'promotedAt'>): Promise<void> {
        const userRef = this.db.collection('users').doc(uid);
        await this.db.runTransaction(async (transaction) => {
            const doc = await transaction.get(userRef);
            const existing: import('../types').PromotedEntry[] = doc.data()?.stats?.recentlyPromoted ?? [];
            const cutoffMs = Date.now() - 48 * 60 * 60 * 1000;
            // Prune stale entries and remove any existing entry for this kuId (we'll re-add with latest data)
            const pruned = existing.filter(
                e => (e.promotedAt as Timestamp).toMillis() > cutoffMs && e.kuId !== entry.kuId,
            );
            pruned.push({ ...entry, promotedAt: Timestamp.now() });
            transaction.update(userRef, { 'stats.recentlyPromoted': pruned });
        });
    }

    /**
     * Records a dismissible "practice this in a Scenario" opportunity, surfaced in the
     * daily plan. Purely a suggestion — never read by SRS/facet logic. Pruned after 7
     * days (longer than recordPromotion's 48h window since this is meant to be acted on
     * at leisure, not urgently) and de-duped by kuId.
     */
    async recordScenarioOpportunity(uid: string, entry: Omit<import('../types').ScenarioOpportunity, 'createdAt'>): Promise<void> {
        const userRef = this.db.collection('users').doc(uid);
        await this.db.runTransaction(async (transaction) => {
            const doc = await transaction.get(userRef);
            const existing: import('../types').ScenarioOpportunity[] = doc.data()?.stats?.scenarioOpportunities ?? [];
            const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
            const pruned = existing.filter(
                e => (e.createdAt as Timestamp).toMillis() > cutoffMs && e.kuId !== entry.kuId,
            );
            pruned.push({ ...entry, createdAt: Timestamp.now() });
            transaction.update(userRef, { 'stats.scenarioOpportunities': pruned });
        });
    }

    /** Removes a single scenario opportunity by kuId — called when the user dismisses it. */
    async removeScenarioOpportunity(uid: string, kuId: string): Promise<void> {
        const userRef = this.db.collection('users').doc(uid);
        await this.db.runTransaction(async (transaction) => {
            const doc = await transaction.get(userRef);
            const existing: import('../types').ScenarioOpportunity[] = doc.data()?.stats?.scenarioOpportunities ?? [];
            const remaining = existing.filter(e => e.kuId !== kuId);
            transaction.update(userRef, { 'stats.scenarioOpportunities': remaining });
        });
    }

    async updateCurriculumNode(uid: string, jlptLevel: string): Promise<void> {
        await this.db.collection('users').doc(uid).update({
            'tutorContext.currentCurriculumNode': jlptLevel,
        });
    }

    // Helper to generate bucket keys
    private getDateBuckets(date: Date) {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');

        return {
            dayKey: `${yyyy}-${mm}-${dd}`,
            hourKey: `${yyyy}-${mm}-${dd}-${hh}`
        };
    }
}