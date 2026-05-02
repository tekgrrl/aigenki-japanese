import { Injectable, Inject, Logger } from '@nestjs/common';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION } from '../firebase/firebase.module';
import { UserRoot } from '../types';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(@Inject(FIRESTORE_CONNECTION) private readonly db: Firestore) {}

  /**
   * Returns the default UserRoot document shape for a newly initialized user.
   * This is the canonical source of truth for what a blank user looks like.
   */
  private buildDefaultUserRoot(uid: string): UserRoot {
    return {
      id: uid,
      stats: {
        reviewForecast: {},
        hourlyForecast: {},
        currentStreak: 0,
        totalReviews: 0,
        passedReviews: 0,
        levelProgress: {
          n5: { total: 0, mastered: 0 },
          n4: { total: 0, mastered: 0 },
        },
      },
      tutorContext: {
        frontierVocab: [],
        leechVocab: [],
        currentCurriculumNode: 'N5.basics',
        allowedGrammar: [],
        weakGrammarPoints: [],
        communicationStyle: 'balanced',
        semanticWeaknesses: [],
        suggestedThemes: [],
        preferences: {
          dailyMaxTotal: 20,
          dailyMaxNew: 5,
        },
      },
    };
  }

  /**
   * Idempotent find-or-create for a user's root document.
   *
   * - If `users/{uid}` exists, returns the existing data unchanged.
   * - If it does not exist, creates it with sensible defaults and returns that.
   *
   * Safe to call on every request — no overwrites, no side-effects for existing users.
   */
  async findOrCreate(uid: string, email?: string): Promise<UserRoot> {
    const userRef = this.db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      this.logger.log(`UserRoot found for uid: ${uid}`);
      const data = userDoc.data()!;
      if (email && !data.email) {
        void userRef.update({ email });
        data.email = email;
      }
      return { id: uid, ...data } as UserRoot;
    }

    this.logger.log(`UserRoot not found for uid: ${uid}. Creating default document.`);
    const defaultUser = this.buildDefaultUserRoot(uid);
    if (email) defaultUser.email = email;

    await userRef.set(defaultUser);

    this.logger.log(`Default UserRoot created for uid: ${uid}`);
    return defaultUser;
  }

  /**
   * Simple read-only getter. Returns null if the user doesn't exist.
   * Useful for services that need to check existence without side-effects.
   */
  async findById(uid: string): Promise<UserRoot | null> {
    const userDoc = await this.db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return null;
    }
    return { id: uid, ...userDoc.data() } as UserRoot;
  }

  async updatePreferences(uid: string, prefs: { showFurigana?: boolean; jlptLevel?: string; preferredUserRole?: string }): Promise<void> {
    await this.db.collection('users').doc(uid).set({ preferences: prefs }, { merge: true });
  }
}
