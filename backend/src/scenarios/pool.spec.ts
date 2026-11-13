import { FakeFirestore } from '../testing/fake-firestore';
import { PoolScenario, Scenario } from '../types/scenario';
import { mergePoolScenario } from './pool';
import { ScenariosService } from './scenarios.service';

const pool = {
  id: 'p1',
  title: 'At the station',
  description: 'Ask for the right platform.',
  difficultyLevel: 'N5',
  setting: { location: 'Station', participants: ['you', 'staff'], goal: 'Find the platform', timeOfDay: 'morning', visualPrompt: 'a station' },
  roles: { user: 'traveller', ai: 'staff' },
  dialogue: [{ speaker: 'staff', text: 'いらっしゃいませ', translation: 'Welcome' }],
  extractedKUs: [{ content: '駅', reading: 'えき', meaning: 'station', type: 'vocab', status: 'new' }],
  grammarMatches: [],
  publishedFrom: { uid: 'admin', scenarioId: 's0' },
} as unknown as PoolScenario;

describe('mergePoolScenario', () => {
  it('gives a learner doc the shared content, with their progress on top', () => {
    const learner = { id: 'p1', poolId: 'p1', userId: 'u1', state: 'drill', chatHistory: [] } as unknown as Scenario;
    const merged = mergePoolScenario(pool, learner);
    expect(merged).toMatchObject({ id: 'p1', title: 'At the station', state: 'drill', dialogue: pool.dialogue, extractedKUs: pool.extractedKUs });
    expect((merged as any).publishedFrom).toBeUndefined(); // pool bookkeeping isn't content
  });

  it("lets the learner's own writes win, and merges setting one level deep", () => {
    const linked = [{ ...pool.extractedKUs[0], kuId: 'k1', status: 'learning' }];
    const picture = { file: 'scene.png' };
    const learner = { id: 'p1', poolId: 'p1', extractedKUs: linked, setting: { picture } } as unknown as Scenario;
    const merged = mergePoolScenario(pool, learner);
    expect(merged.extractedKUs).toEqual(linked);
    expect(merged.setting).toEqual({ ...pool.setting, picture });
  });

  it('returns a standalone scenario (or one whose pool doc is gone) unchanged', () => {
    const standalone = { id: 's1', title: 'Mine', state: 'encounter' } as unknown as Scenario;
    expect(mergePoolScenario(null, standalone)).toBe(standalone);
  });
});

describe('ScenariosService: the pool', () => {
  function setup() {
    const db = new FakeFirestore();
    const service = new (ScenariosService as any)(db) as ScenariosService;
    return { db, service };
  }

  it('starts a pool scenario once: a progress-only doc, kept on a second start', async () => {
    const { db, service } = setup();
    await db.collection('scenario-pool').doc('p1').set(pool);
    expect(await service.startPoolScenario('u1', 'p1')).toEqual({ id: 'p1' });

    const ref = db.collection('users').doc('u1').collection('scenarios').doc('p1');
    const stored = (await ref.get()).data()!;
    expect(stored).toMatchObject({ poolId: 'p1', state: 'encounter', isActive: true, chatHistory: [] });
    expect(stored.dialogue).toBeUndefined();

    await ref.update({ state: 'drill' });
    await service.startPoolScenario('u1', 'p1');
    expect((await ref.get()).data()!.state).toBe('drill');

    const scenario = await service.getScenario('u1', 'p1');
    expect(scenario).toMatchObject({ title: 'At the station', state: 'drill' });
  });

  it('refuses to start a pool scenario that does not exist', async () => {
    const { service } = setup();
    await expect(service.startPoolScenario('u1', 'nope')).rejects.toThrow('Pool scenario not found');
  });

  it("publishes an admin's scenario as content only, with item statuses reset", async () => {
    const { db, service } = setup();
    const own = db.collection('users').doc('a1').collection('scenarios');
    await own.doc('s0').set({
      ...pool, id: 's0', state: 'completed', chatHistory: [{ speaker: 'user', text: 'x', timestamp: 1 }],
      extractedKUs: [{ ...pool.extractedKUs[0], kuId: 'k1', status: 'learning' }],
    });
    const { poolId } = await service.publishToPool('a1', 's0');
    const published = (await db.collection('scenario-pool').doc(poolId).get()).data()!;
    expect(published).toMatchObject({ id: poolId, title: 'At the station', publishedFrom: { uid: 'a1', scenarioId: 's0' } });
    expect(published.extractedKUs).toEqual([{ ...pool.extractedKUs[0], kuId: 'k1', status: 'new' }]);
    expect(published.state).toBeUndefined();
    expect(published.chatHistory).toBeUndefined();
  });

  it('refuses to publish a scenario that came from the pool', async () => {
    const { db, service } = setup();
    await db.collection('scenario-pool').doc('p1').set(pool);
    await service.startPoolScenario('a1', 'p1');
    await expect(service.publishToPool('a1', 'p1')).rejects.toThrow('already from the pool');
  });
});
