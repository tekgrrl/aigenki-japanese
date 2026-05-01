// The admin/default user who manages the global KU corpus and uses top-level Firestore collections.
// TODO: This value ('user_default') is also hardcoded directly in:
//   - backend/src/auth/firebase-auth.guard.ts (dev-mode fallback)
// Those references should eventually be replaced with this constant.
export const ADMIN_USER_ID = 'user_default';

// SRS stage at which a facet is considered mastered.
export const MASTERED_STAGE = 7;

// Starting SRS stage for self-certified facets (one below mastered).
// A self-certified facet is due for review in ~1 month; one failure drops it back into active review.
export const SELF_CERTIFIED_STAGE = 6;
