import { skillState, SkillAttempt } from './skill-rules';

const a = (at: string, result: 'pass' | 'fail', verbKuId: string): SkillAttempt => ({ at, result, verbKuId, grammarKuId: 'g' });

describe('skillState', () => {
  it('is unseen with no evidence', () => {
    expect(skillState([])).toBe('unseen');
  });

  it('is learned with 3 correct across 2 verbs and the latest correct', () => {
    expect(skillState([a('2026-11-01', 'pass', 'v1'), a('2026-11-02', 'pass', 'v2'), a('2026-11-03', 'pass', 'v1')])).toBe('learned');
  });

  it('stays practising when every correct answer used the same verb', () => {
    expect(skillState([a('2026-11-01', 'pass', 'v1'), a('2026-11-02', 'pass', 'v1'), a('2026-11-03', 'pass', 'v1')])).toBe('practising');
  });

  it('drops back to practising when the latest answer is wrong, whatever the order stored', () => {
    expect(skillState([
      a('2026-11-04', 'fail', 'v3'),
      a('2026-11-01', 'pass', 'v1'), a('2026-11-02', 'pass', 'v2'), a('2026-11-03', 'pass', 'v1'),
    ])).toBe('practising');
  });
});
