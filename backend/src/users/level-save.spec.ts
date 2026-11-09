import { UserController } from './user.controller';
import { UserService } from './user.service';
import { FakeFirestore } from '../testing/fake-firestore';

describe('PATCH /users/me/preferences: level save', () => {
  function setup(recompute = jest.fn().mockResolvedValue(0)) {
    const db = new FakeFirestore();
    const users = new UserService(db as any);
    const ukus = { recomputeAboveLevel: recompute };
    const stats = { rebuildAllowedGrammarKuIds: jest.fn().mockResolvedValue([]) };
    const controller = new UserController(users, ukus as any, stats as any);
    return { db, users, ukus, stats, controller };
  }

  it('recomputes on the first save and on a change, not when the level is unchanged', async () => {
    const { controller, ukus, stats } = setup();
    await controller.updatePreferences('u1', { jlptLevel: 'N5' });
    await controller.updatePreferences('u1', { jlptLevel: 'N5' });
    await controller.updatePreferences('u1', { showFurigana: true });
    expect(ukus.recomputeAboveLevel).toHaveBeenCalledTimes(1);
    await controller.updatePreferences('u1', { jlptLevel: 'N4' });
    expect(ukus.recomputeAboveLevel).toHaveBeenCalledTimes(2);
    expect(stats.rebuildAllowedGrammarKuIds).toHaveBeenCalledTimes(2);
  });

  it('answers OK (level saved, profile complete) even if the recompute fails', async () => {
    const { controller, users } = setup(jest.fn().mockRejectedValue(new Error('batch failed')));
    await expect(controller.updatePreferences('u1', { jlptLevel: 'N4' })).resolves.toEqual({ ok: true });
    expect(await users.getJlptLevel('u1')).toBe('N4');
    expect(await users.hasCompleteProfile('u1')).toBe(true);
  });
});
