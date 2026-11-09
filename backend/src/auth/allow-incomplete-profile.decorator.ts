import { SetMetadata } from '@nestjs/common';

export const ALLOW_INCOMPLETE_PROFILE = 'allowIncompleteProfile';

/**
 * Lets a route through for a signed-in user who hasn't completed their profile (chosen a level).
 * Only the routes the /profile page needs carry it; everything else behind FirebaseAuthGuard
 * answers 403 PROFILE_INCOMPLETE until the profile is complete.
 */
export const AllowIncompleteProfile = () => SetMetadata(ALLOW_INCOMPLETE_PROFILE, true);
