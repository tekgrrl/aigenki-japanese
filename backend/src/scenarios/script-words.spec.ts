import { FakeFirestore } from '../testing/fake-firestore';
import { buildChatSystemPrompt } from '../prompts/scenario.prompts';
import { buildScenarioEvaluatorPrompt } from '../prompts/evaluation.prompts';
import { Scenario } from '../types/scenario';
import { ScenariosService } from './scenarios.service';

const scenario = {
  id: 's0',
  title: 'At the station',
  description: 'Ask for the platform.',
  difficultyLevel: 'N5',
  setting: { location: 'Station', participants: [], goal: 'Find the platform', timeOfDay: 'morning', visualPrompt: '' },
  roles: { user: 'traveller', ai: 'staff' },
  dialogue: [{ speaker: 'staff', text: '電車[でんしゃ]は三番線です。', translation: 'The train is on platform 3.' }],
  extractedKUs: [{ content: '駅', reading: 'えき', meaning: 'station', type: 'vocab', status: 'new' }],
  grammarMatches: [],
};

function setup(words: { content: string; reading: string; meaning: string; jlptLevel: string }[] | Error) {
  const db = new FakeFirestore();
  const gemini = {
    extractScriptVocab: jest.fn(async () => { if (words instanceof Error) throw words; return words; }),
  };
  const linked: string[] = [];
  const knowledge = {
    linkVocabKu: jest.fn(async (_uid: string, _s: Scenario, ku: any) => { linked.push(ku.content); return { ...ku, kuId: ku.kuId ?? `k-${ku.content}`, status: 'learning' }; }),
    linkGrammarMatch: jest.fn(async () => true),
  };
  const kus = { ensureVocab: jest.fn(async (content: string) => `ku-${content}`) };
  const none = {} as any;
  const service = new (ScenariosService as any)(db, none, gemini, kus, none, none, none, none, knowledge, none) as ScenariosService;
  return { db, service, gemini, linked };
}

describe('script words (secondary Vocab)', () => {
  it('are found at publish: plain script lines, Key Vocabulary and repeats left out (after trimming), each resolved to a KU', async () => {
    const { db, service, gemini } = setup([
      { content: '電車', reading: 'でんしゃ', meaning: 'train', jlptLevel: 'N5' },
      { content: ' 駅', reading: 'えき', meaning: 'station', jlptLevel: 'N5' },
      { content: '電車 ', reading: 'でんしゃ', meaning: 'train', jlptLevel: 'N5' },
    ]);
    await db.collection('users').doc('a1').collection('scenarios').doc('s0').set(scenario);
    const { poolId } = await service.publishToPool('a1', 's0');

    expect(gemini.extractScriptVocab).toHaveBeenCalledWith(['電車は三番線です。'], ['駅'], 'At the station');
    const pool = (await db.collection('scenario-pool').doc(poolId).get()).data()!;
    expect(pool.secondaryKUs).toEqual([{ content: '電車', reading: 'でんしゃ', meaning: 'train', type: 'vocab', status: 'new', jlptLevel: 'N5', kuId: 'ku-電車' }]);
  });

  it("don't stop a publish when the call fails", async () => {
    const { db, service } = setup(new Error('Gemini down'));
    await db.collection('users').doc('a1').collection('scenarios').doc('s0').set(scenario);
    const { poolId } = await service.publishToPool('a1', 's0');
    const pool = (await db.collection('scenario-pool').doc(poolId).get()).data()!;
    expect(pool.title).toBe('At the station');
    expect(pool.secondaryKUs).toBeUndefined();
  });

  it.each([
    [true, ['駅', '電車']],
    [false, ['駅']],
  ])('are queued at Start Learning only when opted in (%s)', async (includeScriptWords, expected) => {
    const { db, service, linked } = setup([]);
    await db.collection('scenario-pool').doc('p1').set({
      ...scenario, id: 'p1', publishedFrom: { uid: 'a1', scenarioId: 's0' },
      secondaryKUs: [
        { content: '電車', reading: 'でんしゃ', meaning: 'train', type: 'vocab', status: 'new', kuId: 'ku-電車' },
        { content: '番線', reading: 'ばんせん', meaning: 'platform', type: 'vocab', status: 'new' }, // not resolved yet: skipped
      ],
    });
    await service.startPoolScenario('u1', 'p1');
    await service.advanceState('u1', 'p1', { includeScriptWords });

    expect(linked).toEqual(expected);
    const learner = (await db.collection('users').doc('u1').collection('scenarios').doc('p1').get()).data()!;
    expect(learner.state).toBe('drill');
    expect(learner.secondaryKUs?.map((k: any) => k.kuId)).toEqual(includeScriptWords ? ['ku-電車'] : undefined);
  });
});

describe('simulation brief', () => {
  it('sets and clears only the brief on the pool scenario', async () => {
    const { db, service } = setup([]);
    await db.collection('scenario-pool').doc('p1').set({ ...scenario, id: 'p1' });
    await service.setSimulationBrief('p1', '  The train is delayed.  ');
    let pool = (await db.collection('scenario-pool').doc('p1').get()).data()!;
    expect(pool.simulationBrief).toBe('The train is delayed.');
    expect(pool.title).toBe('At the station');
    await service.setSimulationBrief('p1', '');
    pool = (await db.collection('scenario-pool').doc('p1').get()).data()!;
    expect(pool.simulationBrief).toBeUndefined();
  });

  it('goes into the role-play and evaluation prompts only when set', () => {
    const withBrief = { ...scenario, simulationBrief: 'The train is delayed.' } as unknown as Scenario;
    expect(buildChatSystemPrompt(withBrief, 'staff', 'traveller', '', '')).toContain('The train is delayed.');
    expect(buildChatSystemPrompt(scenario as unknown as Scenario, 'staff', 'traveller', '', '')).not.toContain('EXTENDED SITUATION');

    const ctx = { title: 't', goal: 'g', difficulty: 'N5', isObjectiveMet: true };
    expect(buildScenarioEvaluatorPrompt([], { ...ctx, simulationBrief: 'The train is delayed.' })).toContain('The train is delayed.');
    expect(buildScenarioEvaluatorPrompt([], ctx)).not.toContain('EXTENDED SITUATION');
    expect(buildScenarioEvaluatorPrompt([], { ...ctx, simulationBrief: 'x' })).toContain('If it came up');
  });
});
