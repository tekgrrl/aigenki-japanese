// The admin/default user who manages the global KU corpus and uses top-level Firestore collections.
// TODO: This value ('user_default') is also hardcoded directly in:
//   - backend/src/auth/firebase-auth.guard.ts (dev-mode fallback)
// Those references should eventually be replaced with this constant.
export const ADMIN_USER_ID = 'user_default';

// SRS stage at which a facet is considered mastered.
export const MASTERED_STAGE = 7;

// Starting SRS stage when a user marks a lesson item "I already know this" (Start Learning,
// the daily plan, the lesson page). A first impression, not a mastery claim, so it re-enters
// active review soon (~3 days).
export const ALREADY_KNOWN_STAGE = 3;

// SRS review intervals in hours, indexed by srsStage.
// Set SRS_TEST_MODE=true in backend/.env to use the compressed testing schedule.
export const SRS_INTERVALS: Record<number, number> = process.env.SRS_TEST_MODE === 'true'
  ? {
      0: 10 / 60,   // 10 min
      1: 10 / 60,   // 10 min
      2: 10 / 60,   // 10 min
      3: 10 / 60,   // 10 min
      4: 10 / 60,   // 10 min
      5: 10 / 60,   // 10 min
      6: 730,
      7: 2920,
      8: 8760,
    }
  : {
      0: 10 / 60,   // 10 min
      1: 8,         // 8 h
      2: 24,        // 1 day
      3: 72,        // 3 days
      4: 168,       // 1 week
      5: 336,       // 2 weeks
      6: 730,       // ~1 month
      7: 2920,      // 4 months
      8: 8760,      // 1 year
    };
