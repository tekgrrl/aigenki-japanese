import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as admin from 'firebase-admin';
import { UserService } from '../users/user.service';
import { ALLOW_INCOMPLETE_PROFILE } from './allow-incomplete-profile.decorator';

/**
 * The local dev bypass: requests without a token are let in. Opt-in with DEV_AUTH_BYPASS=true in
 * backend/.env, and never in production whatever the flag says.
 */
export const devAuthBypass = () => process.env.DEV_AUTH_BYPASS === 'true' && process.env.NODE_ENV !== 'production';

/**
 * Verifies the Firebase ID token and sets `request.user`. A verified user who hasn't completed
 * their profile (chosen a level) is refused with 403 PROFILE_INCOMPLETE, except on routes marked
 * @AllowIncompleteProfile(). The local dev bypass (no token, see devAuthBypass) skips that check.
 */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(FirebaseAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly userService: UserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (devAuthBypass() && (!authHeader || !authHeader.startsWith('Bearer '))) {
      // Local dev bypass (NEXT_PUBLIC_DEV_SKIP_AUTH on the frontend): act as the uid in
      // X-Dev-User-Id, or the admin account when the header is absent. Skips the profile gate.
      const devUid = request.headers['x-dev-user-id'] || 'user_default';
      this.logger.warn(`Dev auth bypass: no Bearer token, acting as ${devUid}`);
      request.user = { uid: devUid };
      return true;
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.logger.error('No valid Bearer token provided in headers');
      throw new UnauthorizedException('Missing authentication token');
    }

    // A token that fails verification is refused even with the dev bypass on.
    const token = authHeader.split('Bearer ')[1];
    try {
      request.user = await admin.auth().verifyIdToken(token);
    } catch (error) {
      this.logger.error(`Token verification failed: ${error.message}`);
      throw new UnauthorizedException('Invalid or expired authentication token');
    }
    return this.checkProfile(context, request.user.uid);
  }

  /** The profile gate: complete profiles and exempt routes pass, everything else gets 403 PROFILE_INCOMPLETE. */
  private async checkProfile(context: ExecutionContext, uid: string): Promise<boolean> {
    const exempt = this.reflector.getAllAndOverride<boolean>(ALLOW_INCOMPLETE_PROFILE, [context.getHandler(), context.getClass()]);
    if (exempt || (await this.userService.hasCompleteProfile(uid))) return true;
    throw new ForbiddenException({ code: 'PROFILE_INCOMPLETE', message: 'Choose your JLPT level on your profile first' });
  }
}
