import { buildPoolScenarioPrompt, PoolScenarioPromptInput } from './scenario.prompts';

const base: PoolScenarioPromptInput = {
  title: 'At the station', description: 'Buy a ticket', difficultyLevel: 'N5',
  setting: { location: 'Station', goal: 'Buy a ticket' }, roles: { user: 'Traveller', ai: 'Clerk' },
  goalSummary: 'Ask for a ticket', vocab: ['切符'], grammar: [{ kuId: 'g1', pattern: 'をください' }], setPhrases: [],
};

describe('buildPoolScenarioPrompt', () => {
  it('lists items taught earlier as usable but never Key items', () => {
    const prompt = buildPoolScenarioPrompt({ ...base, allowed: { vocab: ['駅', '電車'], grammar: ['です'] } });
    expect(prompt).toContain('**Already learned**');
    expect(prompt).toContain('駅、電車');
    expect(prompt).toContain('- Grammar: です');
  });

  it('leaves the section out when nothing was taught earlier', () => {
    expect(buildPoolScenarioPrompt(base)).not.toContain('Already learned');
    expect(buildPoolScenarioPrompt({ ...base, allowed: { vocab: [], grammar: [] } })).not.toContain('Already learned');
  });
});
