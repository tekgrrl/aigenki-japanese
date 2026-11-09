import { UserController } from './user.controller';
import { UserService } from './user.service';
import { LevelSyncService } from './level-sync.service';
import { FakeFirestore } from '../testing/fake-firestore';

describe('level save: LevelSyncService', () => {
  function setup(recompute: jest.Mock = jest.fn().mockResolvedValue(0)) {
    const db = new FakeFirestore();
    const users = new UserService(db as any);
    const ukus = { recomputeAboveLevel: recompute };
    const stats = { rebuildAllowedGrammarKuIds: jest.fn().mockResolvedValue([]) };
    const sync = new LevelSyncService(db as any, ukus as any, stats as any);
    const controller = new UserController(users, sync);
    const computedFor = () => db.store('users').get('u1')?.aboveLevelComputedFor;
    return { db, users, ukus, stats, sync, controller, computedFor };
  }

  it('recomputes for a new level and records it; the same level again is skipped', async () => {
    const { controller, ukus, stats, computedFor } = setup();
    await controller.updatePreferences('u1', { jlptLevel: 'N5' });
    expect(computedFor()).toBe('N5');
    await controller.updatePreferences('u1', { jlptLevel: 'N5' });
    await controller.updatePreferences('u1', { showFurigana: true });
    expect(ukus.recomputeAboveLevel).toHaveBeenCalledTimes(1);
    await controller.updatePreferences('u1', { jlptLevel: 'N4' });
    expect(ukus.recomputeAboveLevel).toHaveBeenLastCalledWith('u1', 'N4');
    expect(stats.rebuildAllowedGrammarKuIds).toHaveBeenLastCalledWith('u1', 'N4');
    expect(computedFor()).toBe('N4');
  });

  it('a failed recompute still answers OK, records nothing, and runs again on the next save of that level', async () => {
    const recompute = jest.fn().mockRejectedValueOnce(new Error('batch failed')).mockResolvedValue(0);
    const { controller, users, computedFor } = setup(recompute);
    await expect(controller.updatePreferences('u1', { jlptLevel: 'N4' })).resolves.toEqual({ ok: true });
    expect(await users.getJlptLevel('u1')).toBe('N4');
    expect(await users.hasCompleteProfile('u1')).toBe(true);
    expect(computedFor()).toBeUndefined();
    await controller.updatePreferences('u1', { jlptLevel: 'N4' });
    expect(recompute).toHaveBeenCalledTimes(2);
    expect(computedFor()).toBe('N4');
  });

  it('two quick saves run one after the other, and the last run matches the last saved level', async () => {
    let releaseFirst!: () => void;
    const order: string[] = [];
    const recompute = jest.fn(async (_uid: string, level: string) => {
      order.push(`start ${level}`);
      if (order.length === 1) await new Promise<void>(r => (releaseFirst = r));
      order.push(`end ${level}`);
      return 0;
    });
    const { users, sync, computedFor } = setup(recompute);
    await users.updatePreferences('u1', { jlptLevel: 'N3' });
    const first = sync.syncToStoredLevel('u1');
    await new Promise(r => setImmediate(r));
    await users.updatePreferences('u1', { jlptLevel: 'N4' });
    const second = sync.syncToStoredLevel('u1');
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['start N3', 'end N3', 'start N4', 'end N4']);
    expect(computedFor()).toBe('N4');
  });
});
