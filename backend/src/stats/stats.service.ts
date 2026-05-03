import { Injectable, Inject, Logger } from '@nestjs/common';
import { FieldValue, Firestore, Timestamp, Transaction } from 'firebase-admin/firestore';
import { FacetType, TutorVocabEntry } from '../types';
import {
    FIRESTORE_CONNECTION,
    REVIEW_FACETS_COLLECTION,
    USER_KUS_SUBCOLLECTION,
    SCENARIOS_COLLECTION,
} from '../firebase/firebase.module';
import { ADMIN_USER_ID } from '../lib/constants';

@Injectable()
export class StatsService {
    private readonly logger = new Logger(StatsService.name);

    constructor(@Inject(FIRESTORE_CONNECTION) private readonly db: Firestore) { }

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

        const userStatsQuery = this.db.collection('users').doc(uid).get();

        const scenariosCol = uid === ADMIN_USER_ID
            ? this.db.collection(SCENARIOS_COLLECTION)
            : this.db.collection('users').doc(uid).collection(SCENARIOS_COLLECTION);
        const simulateScenariosQuery = scenariosCol
            .where('state', '==', 'simulate')
            .count()
            .get();

        const [ukuLearnSnapshot, reviewingSnapshot, masteredSnapshot, reviewsSnapshot, userStatsDoc, simulateScenariosSnapshot] = await Promise.all([
            ukuLearnQuery,
            reviewQuery,
            masteredQuery,
            reviewsDueQuery,
            userStatsQuery,
            simulateScenariosQuery,
        ]);

        const reviewsDueCount = reviewsSnapshot.data().count;
        this.logger.log(`Reviews due for user ${uid}: ${reviewsDueCount}`);

        const userStats = userStatsDoc.data()?.stats ?? {};

        const rawReviewForecast = userStats.reviewForecast || {};
        const rawHourlyForecast = userStats.hourlyForecast || {};

        const now = new Date();
        const currentStreak = userStats.currentStreak || 0;
        const totalActive = reviewingSnapshot.data().count + reviewsDueCount;

        // --- CALCULATION LOGIC ---

        // 1. Next 24 Hours
        // Sum hourly buckets from (now + 1h) to (now + 24h)
        let next24HoursCount = 0;
        for (let i = 1; i <= 24; i++) {
            const futureHour = new Date(now.getTime() + i * 60 * 60 * 1000);
            const key = this.getDateBuckets(futureHour).hourKey;
            next24HoursCount += (rawHourlyForecast[key] || 0);
        }

        // 2. 5-Day Schedule
        // Day 0: Rest of Today (remaining hours)
        // Day 1-4: Full days (from daily forecast)

        const schedule: { date: string; isToday: boolean; count: number; runningTotal: number; label: string; }[] = [];
        let runningTotal = reviewsDueCount;

        // Day 0 (Today)
        let todayRemainingCount = 0;
        const startHour = now.getHours() + 1; // start from next hour
        if (startHour < 24) {
            const todayBuckets = this.getDateBuckets(now);
            // Reconstruct the hour keys for the rest of today
            // Note: simple string manipulation is safe here as yyyy-mm-dd is stable for the loop
            const prefix = todayBuckets.dayKey;
            for (let h = startHour; h < 24; h++) {
                const hh = String(h).padStart(2, '0');
                const key = `${prefix}-${hh}`;
                todayRemainingCount += (rawHourlyForecast[key] || 0);
            }
        }

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

            const dayCount = (rawReviewForecast[key] || 0);
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
            next24HoursCount: next24HoursCount,
            schedule: schedule,

            // Legacy/Other support
            srsCounts: userStats.levelProgress || {},
            streak: currentStreak
        };
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

    async addToLeechVocab(uid: string, content: string, facetType: FacetType): Promise<void> {
        await this.mergeTutorVocabEntry(uid, 'leechVocab', content, [facetType]);
    }

    async removeFromLeechVocab(uid: string, content: string, facetType: FacetType): Promise<void> {
        await this.removeTutorVocabFacetType(uid, 'leechVocab', content, facetType);
    }

    async addToAllowedGrammar(uid: string, pattern: string): Promise<void> {
        await this.db.collection('users').doc(uid).update({
            'tutorContext.allowedGrammar': FieldValue.arrayUnion(pattern),
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
            const pruned = existing.filter(e => (e.promotedAt as Timestamp).toMillis() > cutoffMs);
            pruned.push({ ...entry, promotedAt: Timestamp.now() });
            transaction.update(userRef, { 'stats.recentlyPromoted': pruned });
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