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
    generateScenario: jest.fn(async () => ({
      dialogue: [{ speaker: 'staff', speakerRole: 'ai', text: '駅は三番線です。', translation: 'x' }],
      extractedKUs: [{ content: '駅', reading: 'えき', meaning: 'station', jlptLevel: 'N5' }, { content: '切符', reading: 'きっぷ', meaning: 'ticket', jlptLevel: 'N5' }],
      grammarMatches: [{ kuId: 'g1' }, { kuId: 'g-invented' }],
      setting: { visualPrompt: 'a platform' },
    })),
  };
  const linked: string[] = [];
  const knowledge = {
    linkVocabKu: jest.fn(async (_uid: string, _s: Scenario, ku: any) => { linked.push(ku.content); return { ...ku, kuId: ku.kuId ?? `k-${ku.content}`, status: 'learning' }; }),
    linkGrammarMatch: jest.fn(async () => true),
  };
  const kus = {
    ensureVocab: jest.fn(async (content: string) => `ku-${content}`),
    findByContent: jest.fn(async (content: string) => (content === '電車' ? { id: 'ku-電車' } : null)),
  };
  const none = {} as any;
  const service = new (ScenariosService as any)(db, none, gemini, kus, none, none, none, none, knowledge, none) as ScenariosService;
  return { db, service, gemini, linked, kus };
}

describe('script words (secondary Vocab)', () => {
  it('come from generation on a start, and only words that already have a KU are kept', async () => {
    const { db, service, gemini, kus } = setup([
      { content: '電車', reading: 'でんしゃ', meaning: 'train', jlptLevel: 'N5' },
      { content: '番線', reading: 'ばんせん', meaning: 'platform', jlptLevel: 'N5' },
    ]);
    await db.collection('scenario-pool').doc('p1').set({
      id: 'p1', title: 'At the station', description: 'd', difficultyLevel: 'N5', setting: scenario.setting, roles: scenario.roles,
      goals: { summary: 'Find the platform', vocab: [{ content: '駅', kuId: 'ku-eki' }], grammarKuIds: ['g1'], setPhrases: ['すみません'] },
    });
    await db.collection('knowledge-units').doc('g1').set({ type: 'Grammar', content: '{N}は{N}です' });

    await service.startPoolScenario('u1', 'p1');
    await service.startPoolScenario('u2', 'p1');
    expect(gemini.generateScenario).toHaveBeenCalledTimes(1); // shared: the second start reuses it

    const pool = (await db.collection('scenario-pool').doc('p1').get()).data()!;
    expect(pool.dialogue).toHaveLength(1);
    expect(pool.extractedKUs).toEqual([expect.objectContaining({ content: '駅', kuId: 'ku-eki' })]); // 切符 isn't a goal
    expect(pool.grammarMatches).toEqual([{ kuId: 'g1' }]); // invented id dropped
    expect(pool.secondaryKUs.map((k: any) => k.content)).toEqual(['電車']); // 番線 has no KU: not created
    expect(pool.setting.visualPrompt).toBe('a platform');
    expect(kus.ensureVocab).not.toHaveBeenCalled();
    const prompt = (gemini.generateScenario.mock.calls[0] as any[])[0] as string;
    expect(prompt).toContain('{N}は{N}です (kuId: g1)');
    expect(prompt).toContain('すみません');
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

describe('pool editor (premise + goals)', () => {
  const input = {
    title: 'At the station', description: 'd', difficultyLevel: 'N5',
    setting: { location: 'Station', goal: 'Find the platform' }, roles: { user: 'traveller', ai: 'staff' },
    goals: { summary: 'Platforms', vocab: ['駅', ' 駅 '], grammar: ['g1'], setPhrases: ['すみません'] },
  };

  it('resolves goal words (admin) and grammar, and refuses unknown grammar', async () => {
    const { db, service } = setup([]);
    await db.collection('knowledge-units').doc('g1').set({ type: 'Grammar', content: '{N}は{N}です' });
    const saved = await service.savePoolEntry(null, { ...input, simulationBrief: ' The train is delayed. ' });
    expect(saved.goals).toEqual({ summary: 'Platforms', vocab: [{ content: '駅', kuId: 'ku-駅' }], grammarKuIds: ['g1'], setPhrases: ['すみません'] });
    expect(saved.simulationBrief).toBe('The train is delayed.');
    await expect(service.savePoolEntry(null, { ...input, goals: { ...input.goals, grammar: ['nope'] } })).rejects.toThrow('No Grammar point matches: nope');
  });

  it('keeps generated content when only the brief changes, and clears it when the goals change', async () => {
    const { db, service } = setup([]);
    await db.collection('knowledge-units').doc('g1').set({ type: 'Grammar', content: '{N}は{N}です' });
    const { id } = await service.savePoolEntry(null, input);
    await db.collection('scenario-pool').doc(id).update({ dialogue: [{ text: 'x' }] });

    await service.savePoolEntry(id, { ...input, simulationBrief: 'New brief' });
    expect((await db.collection('scenario-pool').doc(id).get()).data()!.dialogue).toHaveLength(1);

    await service.savePoolEntry(id, { ...input, goals: { ...input.goals, setPhrases: ['ありがとう'] } });
    expect((await db.collection('scenario-pool').doc(id).get()).data()!.dialogue).toBeUndefined();
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
