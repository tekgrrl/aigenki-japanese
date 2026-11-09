import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION } from '../firebase/firebase.module';
import { UserRoot } from '../types';
import { DEFAULT_JLPT_LEVEL, JLPT_LEVEL_ORDER, JlptLevel } from '../prompts/curriculum';

/** A user's preferences, with the study level always filled in. */
export type UserPreferences = NonNullable<UserRoot['preferences']> & { jlptLevel: JlptLevel };

/**
 * The study level is required: the learner chooses it on their profile. Until they do (nothing
 * stored, or a stored value that isn't a level) they count as DEFAULT_JLPT_LEVEL (N5) everywhere:
 * generation, queues, enrolment's aboveLevel, scenarios. This is the one place that rule lives.
 */
export const jlptLevelOf = (user: Pick<UserRoot, 'preferences'> | undefined): JlptLevel => {
  const stored = user?.preferences?.jlptLevel;
  return stored && JLPT_LEVEL_ORDER.includes(stored) ? stored : DEFAULT_JLPT_LEVEL;
};

/**
 * A profile is complete once a valid level is stored. Until then the learner is sent to
 * /profile and the API refuses everything but the profile itself (FirebaseAuthGuard).
 */
export const isProfileComplete = (user: Pick<UserRoot, 'preferences'> | undefined): boolean => {
  const stored = user?.preferences?.jlptLevel;
  return !!stored && JLPT_LEVEL_ORDER.includes(stored);
};

/**
 * The dev switch that makes every user an admin (`.env`, never set in production). Applied when
 * admin status is read, never stored on a user doc.
 */
export const adminForAllUsers = () => process.env.ADMIN_ALL === 'true';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  /**
   * Uids already seen with a complete profile. A level can't be cleared (updatePreferences refuses),
   * so a uid never leaves this set and the cache can't go stale; only incomplete profiles cost a read.
   */
  private readonly knownComplete = new Set<string>();

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
      return {
        id: uid,
        ...data,
        isAdmin: data.isAdmin === true || adminForAllUsers(),
        effectiveJlptLevel: jlptLevelOf(data),
        profileComplete: isProfileComplete(data),
      } as UserRoot;
    }

    this.logger.log(`UserRoot not found for uid: ${uid}. Creating default document.`);
    const defaultUser = this.buildDefaultUserRoot(uid);
    if (email) defaultUser.email = email;

    await userRef.set(defaultUser);

    this.logger.log(`Default UserRoot created for uid: ${uid}`);
    return { ...defaultUser, isAdmin: adminForAllUsers(), effectiveJlptLevel: DEFAULT_JLPT_LEVEL, profileComplete: false };
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

  /**
   * The user's preferences, with `jlptLevel` filled in (DEFAULT_JLPT_LEVEL if never set). Services
   * read preferences here rather than digging them out of the user doc.
   */
  async getPreferences(uid: string): Promise<UserPreferences> {
    const user = (await this.db.collection('users').doc(uid).get()).data() as UserRoot | undefined;
    return { ...user?.preferences, jlptLevel: jlptLevelOf(user) };
  }

  /** The level the user studies at (DEFAULT_JLPT_LEVEL if never set). */
  async getJlptLevel(uid: string): Promise<JlptLevel> {
    return (await this.getPreferences(uid)).jlptLevel;
  }

  /** Whether the user has chosen their level (see isProfileComplete). Cached once true. */
  async hasCompleteProfile(uid: string): Promise<boolean> {
    if (this.knownComplete.has(uid)) return true;
    const complete = isProfileComplete((await this.db.collection('users').doc(uid).get()).data() as UserRoot | undefined);
    if (complete) this.knownComplete.add(uid);
    return complete;
  }

  /** Whether the user may use admin tools: everyone when ADMIN_ALL is on, else `isAdmin: true` on their doc. */
  async isAdmin(uid: string): Promise<boolean> {
    if (adminForAllUsers()) return true;
    return (await this.db.collection('users').doc(uid).get()).data()?.isAdmin === true;
  }

  /** Saves the preferences given (merged). The study level is required, so it can be changed but not cleared. */
  async updatePreferences(uid: string, prefs: { showFurigana?: boolean; jlptLevel?: string; preferredUserRole?: string; audioFirstExperiment?: boolean }): Promise<void> {
    if ('jlptLevel' in prefs && !JLPT_LEVEL_ORDER.includes(prefs.jlptLevel as JlptLevel)) {
      throw new BadRequestException(`jlptLevel must be one of ${JLPT_LEVEL_ORDER.join(', ')}`);
    }
    await this.db.collection('users').doc(uid).set({ preferences: prefs }, { merge: true });
    if (prefs.jlptLevel) this.knownComplete.add(uid);
  }
}
