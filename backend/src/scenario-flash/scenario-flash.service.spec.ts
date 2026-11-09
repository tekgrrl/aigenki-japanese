import { ScenarioFlashService } from './scenario-flash.service';
import { ScenariosService } from '../scenarios/scenarios.service';
import { FakeFirestore } from '../testing/fake-firestore';
import { FacetStore } from '../facets/facet-store';

const UID = 'u1';
const G = 'g1';

function setup(opts: { existingScenario?: boolean } = {}) {
  const db = new FakeFirestore();
  const scenarios = new Map<string, any>();
  const scenariosService = {
    getScenariosBySourceKuId: jest.fn(async () => (opts.existingScenario ? [{ id: 's-old' }] : [])),
    getScenario: jest.fn(async (_uid: string, id: string) => scenarios.get(id) ?? null),
    checkAndSetVocabReady: jest.fn(),
    scenarioReadiness: jest.fn(async () => ({ items: {}, ready: false })),
  };
  const tutorService = { generateScenario: jest.fn(async () => { scenarios.set('s-new', { id: 's-new', title: 'At the gate', state: 'encounter' }); return 's-new'; }) };
  const dailyPlanService = { dismissOpportunity: jest.fn() };
  const kuService = { findOneById: jest.fn(async (id: string) => (id === G ? { id: G, type: 'Grammar', content: '{V-te}はいけません', data: { title: 'Must not', scenarioReady: true } } : id === 'g-no' ? { id, type: 'Grammar', content: 'よ', data: {} } : { id, type: 'Vocab', content: 'x' })) };
  const service = new ScenarioFlashService(new FacetStore(db as any), kuService as any, scenariosService as any, dailyPlanService as any, tutorService as any);
  if (opts.existingScenario) scenarios.set('s-old', { id: 's-old', title: 'Old one', state: 'drill' });
  const cards = () => [...db.store(`users/${UID}/review-facets`).values()].filter(f => f.facetType === 'flash');
  return { db, service, scenarios, scenariosService, tutorService, dailyPlanService, cards };
}

describe('ScenarioFlashService.start', () => {
  it('generates a scenario from the grammar point and creates a "drill" card due now', async () => {
    const { service, tutorService, dailyPlanService, cards } = setup();
    await service.start(UID, G);
    expect(tutorService.generateScenario).toHaveBeenCalledWith(UID, expect.objectContaining({ sourceType: 'grammar-pattern', pattern: '{V-te}はいけません', sourceKuId: G, strict: true }));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toMatchObject({ kuId: 's-new', sourceCollection: 'scenarios', data: { step: 'drill', scenarioId: 's-new', grammarKuId: G } });
    expect(cards()[0].source).toBeUndefined(); // never counts toward a UKU
    expect(dailyPlanService.dismissOpportunity).toHaveBeenCalledWith(UID, G);
  });

  it('reuses an existing scenario for the grammar point and starts at its current step', async () => {
    const { service, tutorService, cards } = setup({ existingScenario: true });
    await service.start(UID, G);
    expect(tutorService.generateScenario).not.toHaveBeenCalled();
    expect(cards()[0].data).toMatchObject({ scenarioId: 's-old', step: 'graduate' });
  });

  it('does nothing for a grammar point that is not scenarioReady', async () => {
    const { service, tutorService, cards } = setup();
    await service.start(UID, 'g-no');
    expect(tutorService.generateScenario).not.toHaveBeenCalled();
    expect(cards()).toHaveLength(0);
  });

  it('does nothing when a chain already exists, or for non-Grammar KUs', async () => {
    const { service, tutorService, cards } = setup();
    await service.start(UID, G);
    await service.start(UID, G);
    await service.start(UID, 'v1');
    expect(tutorService.generateScenario).toHaveBeenCalledTimes(1);
    expect(cards()).toHaveLength(1);
  });
});

describe('ScenarioFlashService.sync', () => {
  it('walks the chain with the scenario: drill → graduate → simulate → complete → done', async () => {
    const { service, scenarios, scenariosService, cards } = setup();
    await service.start(UID, G);
    const s = scenarios.get('s-new');

    s.state = 'drill';
    await service.sync(UID);
    expect(cards()[0].data.step).toBe('graduate');
    expect(scenariosService.checkAndSetVocabReady).toHaveBeenCalledWith(UID, 's-new');

    scenariosService.scenarioReadiness.mockResolvedValue({ items: {}, ready: true });
    await service.sync(UID);
    expect(cards()[0].data.step).toBe('simulate');

    s.state = 'simulate';
    await service.sync(UID);
    expect(cards()[0].data.step).toBe('complete');

    s.state = 'completed';
    await service.sync(UID);
    expect(cards()).toHaveLength(0);
  });

  it('a stored vocabReady does not open the roleplay step when live readiness fails', async () => {
    const { service, scenarios, cards } = setup();
    await service.start(UID, G);
    Object.assign(scenarios.get('s-new'), { state: 'drill', vocabReady: true });
    await service.sync(UID);
    expect(cards()[0].data.step).toBe('graduate');
  });

  it('ends the chain when the roleplay finished (objective met) or the scenario was deactivated', async () => {
    for (const patch of [{ isObjectiveMet: true }, { isActive: false }]) {
      const { service, scenarios, cards } = setup();
      await service.start(UID, G);
      Object.assign(scenarios.get('s-new'), { state: 'simulate', ...patch });
      await service.sync(UID);
      expect(cards()).toHaveLength(0);
    }
  });

  it('removes a card whose scenario was deleted', async () => {
    const { service, scenarios, cards } = setup();
    await service.start(UID, G);
    scenarios.delete('s-new');
    await service.sync(UID);
    expect(cards()).toHaveLength(0);
  });

  it('acknowledge hides a seen card for the first SRS interval (8h)', async () => {
    const { service, db } = setup();
    await service.start(UID, G);
    const [id] = [...db.store(`users/${UID}/review-facets`).keys()];
    await service.acknowledge(UID, id);
    const next = db.store(`users/${UID}/review-facets`).get(id)!.nextReviewAt.toMillis();
    expect(next - Date.now()).toBeGreaterThan(7.9 * 3600 * 1000);
    expect(next - Date.now()).toBeLessThanOrEqual(8 * 3600 * 1000);
  });
});

describe('ScenariosService.scenarioReadiness (the Role Play gate)', () => {
  it('includes Key Grammar (grammarMatches) as well as Key Vocabulary', async () => {
    const db = new FakeFirestore();
    const svc = new ScenariosService(db as any, new FacetStore(db as any), ...(Array(8).fill({}) as [any, any, any, any, any, any, any, any]));
    const facets = db.collection('users').doc(UID).collection('review-facets');
    await facets.doc('a').set({ kuId: 'v1', srsStage: 3 });
    await facets.doc('b').set({ kuId: G, srsStage: 2 });
    const scenario: any = { extractedKUs: [{ kuId: 'v1' }], grammarMatches: [{ kuId: G }] };
    expect((await svc.scenarioReadiness(UID, scenario)).ready).toBe(false); // grammar still Apprentice
    await facets.doc('b').update({ srsStage: 3 });
    const r = await svc.scenarioReadiness(UID, scenario);
    expect(r.ready).toBe(true);
    expect(Object.keys(r.items).sort()).toEqual([G, 'v1']);
  });

  it('a scenario with nothing linked has nothing to graduate: ready', async () => {
    const fdb = new FakeFirestore();
    const svc = new ScenariosService(fdb as any, new FacetStore(fdb as any), ...(Array(8).fill({}) as [any, any, any, any, any, any, any, any]));
    const scenario: any = { extractedKUs: [{ content: 'x' }], grammarMatches: [] };
    expect((await svc.scenarioReadiness(UID, scenario)).ready).toBe(true);
  });
});
