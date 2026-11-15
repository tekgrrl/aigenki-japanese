import { FakeFirestore } from '../testing/fake-firestore';
import { ScenariosService } from '../scenarios/scenarios.service';
import { allowedByPhase, JourneysService, normalizeJourney } from './journeys.service';
import { Journey } from '../types/journey';

const pool = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Scenario ${id}`, description: `About ${id}`, difficultyLevel: 'N5',
  setting: {}, dialogue: [], grammarMatches: [], extractedKUs: [], publishedFrom: { uid: 'a', scenarioId: 'x' }, ...extra,
});
const passed = { evaluation: { outcome: 'passed' } };
const failed = { evaluation: { outcome: 'failed' } };

async function setup() {
  const db = new FakeFirestore();
  // FacetStore.query(uid) → the learner's review facets (enough for itemStages).
  const facetStore = { query: (uid: string) => db.collection('users').doc(uid).collection('review-facets') };
  // Goal lines in these specs are already resolved ({ content, kuId } / Grammar ids), so the KU
  // service only answers "not found".
  const knowledgeUnits = { findByContent: async () => null, ensureVocab: async (c: string) => `ku-${c}` };
  const scenarios = new (ScenariosService as any)(db, facetStore, undefined, knowledgeUnits) as ScenariosService;
  await db.collection('knowledge-units').doc('g1').set({ type: 'Grammar', content: 'です' });
  await db.collection('knowledge-units').doc('g2').set({ type: 'Grammar', content: 'ます' });
  const service = new JourneysService(db as any, scenarios);

  await db.collection('scenario-pool').doc('p1').set(pool('p1', {
    goals: { summary: 'Say hello', vocab: [{ content: '駅', kuId: 'ku-eki' }, { content: '謎', kuId: 'ku-nazo' }], grammarKuIds: ['g1'], setPhrases: [] },
  }));
  // Published before goals existed: falls back to its generated Key items with KU ids.
  await db.collection('scenario-pool').doc('p2').set(pool('p2', { extractedKUs: [{ content: '電車', kuId: 'ku-densha' }] }));
  await db.collection('scenario-pool').doc('p3').set(pool('p3'));
  const j1 = await service.create({ title: 'First steps', summary: 'Say hello', difficultyLevel: 'N5', order: 1, phases: [{ title: 'Meet', poolIds: ['p1', 'p2'] }] });
  const j2 = await service.create({ title: 'Getting around', summary: 'Trains', difficultyLevel: 'N5', order: 2, phases: [{ title: 'Station', poolIds: ['p3'] }] });
  const mine = db.collection('users').doc('u1').collection('scenarios');
  const facets = db.collection('users').doc('u1').collection('review-facets');
  return { db, service, mine, facets, j1, j2 };
}

describe('JourneysService', () => {
  it('opens the first Journey and locks the next', async () => {
    const { service } = await setup();
    const [first, second] = await service.forLearner('u1');
    expect(first.status).toBe('current');
    expect(first.phases[0].scenarios.map(s => s.poolId)).toEqual(['p1', 'p2']);
    expect(second.status).toBe('locked');
  });

  it('a failed attempt does not count; a passed one (even archived) completes the phase and unlocks the next', async () => {
    const { service, mine } = await setup();
    await mine.doc('p1').set({ poolId: 'p1', ...failed });
    let [first] = await service.forLearner('u1');
    expect(first.phases[0].scenarios[0]).toMatchObject({ started: true, passed: false });
    expect(first.status).toBe('current');

    await mine.doc('p2').set({ poolId: 'p2', pastAttempts: [passed] });
    const [done, next] = await service.forLearner('u1');
    expect(done.status).toBe('done');
    expect(next.status).toBe('current');
  });

  it("counts the current Journey's goal items at stage 3+ (pool goals, or generated Key items without goals)", async () => {
    const { db, service } = await setup();
    const facets = db.collection('users').doc('u1').collection('review-facets');
    await facets.doc('f1').set({ kuId: 'ku-eki', srsStage: 3 });
    await facets.doc('f2').set({ kuId: 'g1', srsStage: 1 });
    const [first, second] = await service.forLearner('u1');
    // p1 goals: 駅 (stage 3), 謎 (no cards), g1 (stage 1); p2 fallback: 電車 (no cards)
    expect(first.goals).toEqual({ ready: 1, total: 4 });
    expect(second.goals).toBeUndefined();
  });

  it('refuses unknown pool scenarios and phases without titles', async () => {
    const { service, j1 } = await setup();
    await expect(service.update(j1.id, { ...j1, phases: [{ title: 'X', poolIds: ['nope'] }] })).rejects.toThrow('Unknown pool scenario(s): nope');
    await expect(service.update(j1.id, { ...j1, phases: [{ title: ' ', poolIds: [] }] })).rejects.toThrow('Every phase needs a title');
  });

  it('updates and deletes', async () => {
    const { service, j1, j2 } = await setup();
    await service.update(j2.id, { ...j2, order: 0 });
    expect((await service.list()).map(j => j.id)).toEqual([j2.id, j1.id]);
    await service.remove(j2.id);
    expect((await service.list()).map(j => j.id)).toEqual([j1.id]);
  });

  it('a phase needs its taught items at the stage as well as a scenario pass', async () => {
    const { service, mine, facets, j1 } = await setup();
    await service.update(j1.id, { ...j1, phases: [{ title: 'Meet', poolIds: ['p1'], taught: { vocab: [{ content: '駅', kuId: 'ku-eki' }], grammar: ['g1'] } }] });
    await mine.doc('p1').set({ poolId: 'p1', ...passed });
    await facets.doc('f1').set({ kuId: 'ku-eki', srsStage: 3 });
    await facets.doc('f2').set({ kuId: 'g1', srsStage: 2 });
    let [first] = await service.forLearner('u1');
    expect(first.phases[0]).toMatchObject({ done: false, status: 'current', goals: { ready: 1, total: 2 } });

    await facets.doc('f2').set({ kuId: 'g1', srsStage: 3 });
    [first] = await service.forLearner('u1');
    expect(first.status).toBe('done');
  });

  it('asks for N scenario passes when the phase says so', async () => {
    const { service, mine, j1 } = await setup();
    await service.update(j1.id, { ...j1, phases: [{ title: 'Meet', poolIds: ['p1', 'p2'], passing: { scenarioPasses: 2 } }] });
    await db_set(mine, 'p1');
    expect((await service.forLearner('u1'))[0].status).toBe('current');
    await db_set(mine, 'p2');
    expect((await service.forLearner('u1'))[0].status).toBe('done');
  });

  it('opens a phase after the previous one, or with the Journey when it says open', async () => {
    const { service, j1 } = await setup();
    await service.update(j1.id, { ...j1, phases: [
      { title: 'A', poolIds: ['p1'] },
      { title: 'B', poolIds: ['p2'] },
      { title: 'C', poolIds: [], unlock: 'open' },
    ] });
    const [first] = await service.forLearner('u1');
    expect(first.phases.map(p => p.status)).toEqual(['current', 'locked', 'current']); // C: no scenario yet, so not passable
  });

  it('records a completed Journey, so a later lapse does not re-lock the next one', async () => {
    const { db, service, mine, facets, j1 } = await setup();
    await service.update(j1.id, { ...j1, phases: [{ title: 'Meet', poolIds: ['p1'], taught: { vocab: [{ content: '駅', kuId: 'ku-eki' }] } }] });
    await mine.doc('p1').set({ poolId: 'p1', ...passed });
    await facets.doc('f1').set({ kuId: 'ku-eki', srsStage: 3 });
    expect((await service.forLearner('u1'))[1].status).toBe('current');
    expect((await db.collection('users').doc('u1').collection('journey-progress').doc(j1.id).get()).exists).toBe(true);

    await facets.doc('f1').set({ kuId: 'ku-eki', srsStage: 1 });
    const [first, second] = await service.forLearner('u1');
    expect(first.status).toBe('done');
    expect(second.status).toBe('current');
  });

  it('applies the overall item rule on top of the phases', async () => {
    const { service, mine, j1 } = await setup();
    await service.update(j1.id, { ...j1, passing: { minStage: 5, share: 1 }, phases: [{ title: 'Meet', poolIds: ['p1'], passing: { scenarioPasses: 1, minStage: 0, share: 0 }, taught: { vocab: [{ content: '駅', kuId: 'ku-eki' }] } }] });
    await mine.doc('p1').set({ poolId: 'p1', ...passed });
    const [first] = await service.forLearner('u1');
    expect(first.phases[0].done).toBe(true);
    expect(first.status).toBe('current');
  });

  it('unlock-after may only name earlier Journeys; a scenario sits in one phase only', async () => {
    const { service, j1, j2 } = await setup();
    await expect(service.update(j1.id, { ...j1, unlockAfter: [j2.id] })).rejects.toThrow('must come earlier');
    await expect(service.update(j2.id, { ...j2, phases: [{ title: 'S', poolIds: ['p1'] }] })).rejects.toThrow("Already in another Journey's phase: p1");
    await expect(service.update(j1.id, { ...j1, phases: [{ title: 'A', poolIds: ['p1'] }, { title: 'B', poolIds: ['p1'] }] })).rejects.toThrow('only be in one phase');
  });

  it('writes phases down onto pool scenarios, clearing a generated scene only when goals change', async () => {
    const { db, service, j1, j2 } = await setup();
    const p1 = db.collection('scenario-pool').doc('p1');
    await p1.update({ dialogue: [{ text: 'hi' }], generatedAt: 'then' });
    const meet = { title: 'Meet', poolIds: ['p1', 'p2'], taught: { vocab: [{ content: '駅', kuId: 'ku-eki' }], grammar: ['g1'] }, simulationBrief: 'Be brief' };
    const saved = await service.update(j1.id, { ...j1, phases: [meet] });
    let doc = (await p1.get()).data()!;
    expect(doc.goals).toEqual({ summary: '', vocab: [{ content: '駅', kuId: 'ku-eki' }], grammarKuIds: ['g1'], setPhrases: [] });
    expect(doc.phaseRef).toMatchObject({ journeyId: j1.id, phaseTitle: 'Meet' });
    expect(doc.simulationBrief).toBe('Be brief');
    expect(doc.dialogue).toBeUndefined(); // goals changed: regenerate

    await p1.update({ dialogue: [{ text: 'hi' }] });
    await service.update(j1.id, { ...saved, phases: [{ ...saved.phases[0], simulationBrief: 'Longer' }] });
    doc = (await p1.get()).data()!;
    expect(doc.dialogue).toEqual([{ text: 'hi' }]); // brief only: kept
    expect(doc.simulationBrief).toBe('Longer');

    // The next Journey's scenario may use what the first one taught (once its phase teaches something).
    await service.update(j2.id, { ...j2, phases: [{ title: 'Station', poolIds: ['p3'], taught: { grammar: ['g2'] } }] });
    expect((await db.collection('scenario-pool').doc('p3').get()).data()!.allowed).toEqual({ vocab: [{ content: '駅', kuId: 'ku-eki' }], grammarKuIds: ['g1'] });

    await service.update(j1.id, { ...saved, phases: [{ ...saved.phases[0], poolIds: ['p2'] }] });
    expect((await p1.get()).data()!.phaseRef).toBeUndefined();

    // A phase that teaches nothing yet (built before the planner) leaves its scenarios' own goals alone.
    await service.update(j2.id, { ...j2, phases: [{ title: 'Station', poolIds: ['p3'] }] });
    expect((await db.collection('scenario-pool').doc('p3').get()).data()!.phaseRef).toBeUndefined();
  });

  it('allowed items build up across phases and Journeys, plus extras, never repeating taught ones', () => {
    const phase = (id: string, vocab: string[], extra: string[] = []) => ({
      id, title: id, poolIds: [],
      taught: { vocab: vocab.map(v => ({ content: v, kuId: v })), grammarKuIds: [] },
      extraAllowed: { vocab: extra.map(v => ({ content: v, kuId: v })), grammarKuIds: [] },
    });
    const journeys = [
      normalizeJourney({ id: 'a', title: 'A', order: 1, phases: [phase('a1', ['x']), phase('a2', ['y'], ['z'])] } as unknown as Journey),
      normalizeJourney({ id: 'b', title: 'B', order: 2, phases: [phase('b1', ['x', 'w'])] } as unknown as Journey),
    ];
    const allowed = allowedByPhase(journeys);
    expect(allowed.get('a1')!.vocab).toEqual([]);
    expect(allowed.get('a2')!.vocab.map(v => v.kuId)).toEqual(['x', 'z']);
    expect(allowed.get('b1')!.vocab.map(v => v.kuId)).toEqual(['y']); // x is taught again here
  });
});

/** The learner passed this pool scenario's simulation. */
async function db_set(mine: { doc: (id: string) => { set: (d: object) => Promise<unknown> } }, poolId: string) {
  await mine.doc(poolId).set({ poolId, ...passed });
}
