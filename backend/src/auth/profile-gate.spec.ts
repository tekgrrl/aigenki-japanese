import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as admin from 'firebase-admin';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { AllowIncompleteProfile } from './allow-incomplete-profile.decorator';
import { UserService, isProfileComplete } from '../users/user.service';
import { FakeFirestore } from '../testing/fake-firestore';

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

  it('skips the gate for the local dev bypass (no token)', async () => {
    const { context, request } = ctx('gated', {});
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user.uid).toBe('user_default');
  });

  it('isProfileComplete: only a valid stored level counts', () => {
    expect(isProfileComplete(undefined)).toBe(false);
    expect(isProfileComplete({ preferences: {} })).toBe(false);
    expect(isProfileComplete({ preferences: { jlptLevel: 'n4' as any } })).toBe(false);
    expect(isProfileComplete({ preferences: { jlptLevel: 'N3' } })).toBe(true);
  });
});
