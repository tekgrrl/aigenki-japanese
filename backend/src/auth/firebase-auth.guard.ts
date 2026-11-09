import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as admin from 'firebase-admin';
import { UserService } from '../users/user.service';
import { ALLOW_INCOMPLETE_PROFILE } from './allow-incomplete-profile.decorator';

/**
 * Verifies the Firebase ID token and sets `request.user`. A verified user who hasn't completed
 * their profile (chosen a level) is refused with 403 PROFILE_INCOMPLETE, except on routes marked
 * @AllowIncompleteProfile(). The local dev bypass (no token) skips that check.
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

    // Local dev bypass logic
    if (process.env.NODE_ENV !== 'production') {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // Allow frontend dev bypass to specify an explicit UID via header.
        // Falls back to user_default when the header is absent.
        const devUid = request.headers['x-dev-user-id'] || 'user_default';
        this.logger.warn(`Local dev mode: No Bearer token found. Injecting uid: ${devUid}`);
        request.user = { uid: devUid };
        return true;
      }

      try {
        const token = authHeader.split('Bearer ')[1];
        request.user = await admin.auth().verifyIdToken(token);
      } catch (error) {
        this.logger.warn(`Local dev mode: Token verification failed (${error.message}). Bypassing auth and injecting user_default.`);
        request.user = { uid: 'user_default' };
        return true;
      }
      return this.checkProfile(context, request.user.uid);
    }

    // Production logic
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.logger.error('No valid Bearer token provided in headers');
      throw new UnauthorizedException('Missing authentication token');
    }

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
