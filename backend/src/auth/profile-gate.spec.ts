import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as admin from 'firebase-admin';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { AllowIncompleteProfile } from './allow-incomplete-profile.decorator';
import { UserService, isProfileComplete } from '../users/user.service';
import { FakeFirestore } from '../testing/fake-firestore';
import { setEnv } from '../testing/env';

class Routes {
  gated() {}
  @AllowIncompleteProfile()
  profile() {}
}

describe('profile gate (FirebaseAuthGuard)', () => {
  let db: FakeFirestore;
  let users: UserService;
  let guard: FirebaseAuthGuard;
  const ctx = (handler: keyof Routes, headers: Record<string, string> = { authorization: 'Bearer t' }) => {
    const request: any = { headers };
    return {
      request,
      context: {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => Routes.prototype[handler],
        getClass: () => Routes,
      } as any,
    };
  };

  beforeEach(() => {
    db = new FakeFirestore();
    users = new UserService(db as any);
    guard = new FirebaseAuthGuard(new Reflector(), users);
    jest.spyOn(admin, 'auth').mockReturnValue({ verifyIdToken: jest.fn().mockResolvedValue({ uid: 'u1' }) } as any);
  });

  it('refuses a signed-in user with no level stored, with code PROFILE_INCOMPLETE', async () => {
    const err = await guard.canActivate(ctx('gated').context).catch(e => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse().code).toBe('PROFILE_INCOMPLETE');
  });

  it('lets them through to routes marked @AllowIncompleteProfile()', async () => {
    await expect(guard.canActivate(ctx('profile').context)).resolves.toBe(true);
  });

  it('lets a complete profile through, and remembers it (no read on the next request)', async () => {
    await db.collection('users').doc('u1').set({ preferences: { jlptLevel: 'N5' } });
    await expect(guard.canActivate(ctx('gated').context)).resolves.toBe(true);
    const read = jest.spyOn(db, 'collection');
    await expect(guard.canActivate(ctx('gated').context)).resolves.toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it('opens the app as soon as the level is saved', async () => {
    await expect(guard.canActivate(ctx('gated').context)).rejects.toThrow(ForbiddenException);
    await users.updatePreferences('u1', { jlptLevel: 'N4' });
    await expect(guard.canActivate(ctx('gated').context)).resolves.toBe(true);
  });

  describe('dev auth bypass', () => {
    const saved = { bypass: process.env.DEV_AUTH_BYPASS, env: process.env.NODE_ENV };
    beforeEach(() => {
      process.env.NODE_ENV = 'development'; // the bypass only applies in development
    });
    afterEach(() => {
      setEnv('DEV_AUTH_BYPASS', saved.bypass);
      setEnv('NODE_ENV', saved.env);
    });

    it('with DEV_AUTH_BYPASS, a request with no token acts as user_default and skips the gate', async () => {
      process.env.DEV_AUTH_BYPASS = 'true';
      const { context, request } = ctx('gated', {});
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user.uid).toBe('user_default');
    });

    it('with DEV_AUTH_BYPASS, X-Dev-User-Id picks the uid', async () => {
      process.env.DEV_AUTH_BYPASS = 'true';
      const { context, request } = ctx('gated', { 'x-dev-user-id': 'u9' });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user.uid).toBe('u9');
    });

    it('without the flag, a request with no token is refused, header or not', async () => {
      delete process.env.DEV_AUTH_BYPASS;
      await expect(guard.canActivate(ctx('gated', {}).context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(ctx('gated', { 'x-dev-user-id': 'u9' }).context)).rejects.toThrow(UnauthorizedException);
    });

    it('refuses an invalid token even with the flag on (no fall-back to user_default)', async () => {
      process.env.DEV_AUTH_BYPASS = 'true';
      jest.spyOn(admin, 'auth').mockReturnValue({ verifyIdToken: jest.fn().mockRejectedValue(new Error('bad')) } as any);
      const { context, request } = ctx('gated');
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(request.user).toBeUndefined();
    });

    it.each([['production'], ['test'], [undefined]])('ignores the flag unless NODE_ENV is development (%s)', async nodeEnv => {
      process.env.DEV_AUTH_BYPASS = 'true';
      setEnv('NODE_ENV', nodeEnv);
      await expect(guard.canActivate(ctx('gated', {}).context)).rejects.toThrow(UnauthorizedException);
    });
  });

  it('isProfileComplete: only a valid stored level counts', () => {
    expect(isProfileComplete(undefined)).toBe(false);
    expect(isProfileComplete({ preferences: {} })).toBe(false);
    expect(isProfileComplete({ preferences: { jlptLevel: 'n4' as any } })).toBe(false);
    expect(isProfileComplete({ preferences: { jlptLevel: 'N3' } })).toBe(true);
  });
});
