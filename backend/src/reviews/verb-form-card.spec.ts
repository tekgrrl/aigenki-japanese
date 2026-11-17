import { chooseVerbFormTarget } from './verb-form-card';
import type { PoolVerb, SkillProgress } from '../learner-progress/learner-progress.service';
import type { VerbForm } from '../lib/verb-forms';

const skill = (group: string, attempts: number, state: SkillProgress['state'] = 'practising'): SkillProgress => ({
  skillId: `verb-form:te:${group}`, form: 'te', group, label: group, attempts, correct: 0, distinctVerbs: 0, lastResult: null, lastAt: null, state,
});
const verb = (kuId: string, studied: boolean): PoolVerb => ({ kuId, content: kuId, reading: kuId, meaning: '', studied });
const pools = (byGroup: Record<string, PoolVerb[]>) => new Map<VerbForm, Map<string, PoolVerb[]>>([['te', new Map(Object.entries(byGroup))]]);
/** A random() that returns these values in turn: the first decides drill-or-not. */
const seq = (...values: number[]) => () => values.shift() ?? 0;

describe('chooseVerbFormTarget', () => {
  it('picks the unlearned skill with the fewest attempts, and a studied verb', () => {
    const target = chooseVerbFormTarget(
      [skill('godan-ku', 4), skill('godan-mu-bu-nu', 1), skill('ichidan', 0, 'learned')],
      pools({ 'godan-ku': [verb('書く', true)], 'godan-mu-bu-nu': [verb('飲む', false), verb('読む', true)], ichidan: [verb('食べる', true)] }),
      seq(0, 0, 0),
    );
    expect(target).toEqual({ skillId: 'verb-form:te:godan-mu-bu-nu', verbKuId: '読む', verb: '読む' });
  });

  it('skips skills with no verb, and uses an unstudied verb when that is all there is', () => {
    const target = chooseVerbFormTarget(
      [skill('godan-gu', 0), skill('iku', 2)],
      pools({ 'godan-gu': [], iku: [verb('行く', false)] }),
      seq(0, 0, 0),
    );
    expect(target).toEqual({ skillId: 'verb-form:te:iku', verbKuId: '行く', verb: '行く' });
  });

  it('stays an ordinary question when every skill is learned, or for the non-drill share', () => {
    expect(chooseVerbFormTarget([skill('ichidan', 5, 'learned')], pools({ ichidan: [verb('食べる', true)] }), seq(0))).toBeNull();
    expect(chooseVerbFormTarget([skill('ichidan', 0)], pools({ ichidan: [verb('食べる', true)] }), seq(0.9))).toBeNull();
  });
});
