import { AI_QUESTION_MIN_STAGE, chooseMeaningForm, matchUsageLocally, meaningOutcome } from './meaning-card';

const usages = [
  { id: 'dark', label: 'dark (lacking light)', meaning: 'dark', acceptedAnswers: ['dim'] },
  { id: 'gloom', label: 'gloomy / depressed', meaning: 'gloomy', acceptedAnswers: ['depressed'] },
  { id: 'unfam', label: 'unfamiliar with', meaning: 'unfamiliar with', acceptedAnswers: ['ignorant of'] },
];
const ids = usages.map(u => u.id);

describe('matchUsageLocally', () => {
  it('matches a meaning or an accepted answer, ignoring case and trailing punctuation', () => {
    expect(matchUsageLocally('Dark.', usages)?.id).toBe('dark');
    expect(matchUsageLocally(' depressed ', usages)?.id).toBe('gloom');
  });

  it('returns null for anything else', () => {
    expect(matchUsageLocally('bright', usages)).toBeNull();
    expect(matchUsageLocally('', usages)).toBeNull();
  });
});

describe('meaningOutcome', () => {
  it('a single-usage word behaves as before: a pass promotes', () => {
    expect(meaningOutcome('pass', 'only', [], ['only'])).toEqual({ outcome: 'promote', proven: [] });
  });

  it('a 3-usage word needs all three usages before it promotes', () => {
    let r = meaningOutcome('pass', 'dark', [], ids);
    expect(r).toEqual({ outcome: 'hold', proven: ['dark'] });
    r = meaningOutcome('pass', 'gloom', r.proven, ids);
    expect(r).toEqual({ outcome: 'hold', proven: ['dark', 'gloom'] });
    r = meaningOutcome('pass', 'unfam', r.proven, ids);
    expect(r).toEqual({ outcome: 'promote', proven: [] });
  });

  it('repeating a proven usage holds without adding to the record', () => {
    expect(meaningOutcome('pass', 'dark', ['dark'], ids)).toEqual({ outcome: 'hold', proven: ['dark'] });
  });

  it('a pass with no identified usage holds', () => {
    expect(meaningOutcome('pass', undefined, ['dark'], ids)).toEqual({ outcome: 'hold', proven: ['dark'] });
  });

  it('a wrong answer counts only when nothing is proven yet at this stage', () => {
    expect(meaningOutcome('fail', undefined, [], ids)).toEqual({ outcome: 'fail', proven: [] });
    expect(meaningOutcome('fail', undefined, ['dark'], ids)).toEqual({ outcome: 'free-fail', proven: ['dark'] });
  });

  it('ignores proven ids of usages that no longer exist', () => {
    expect(meaningOutcome('fail', undefined, ['gone'], ids)).toEqual({ outcome: 'fail', proven: [] });
  });
});

describe('chooseMeaningForm', () => {
  it('shows the bare word below the threshold stage', () => {
    expect(chooseMeaningForm(AI_QUESTION_MIN_STAGE - 1, [], ids)).toBeNull();
  });

  it('from the threshold, asks an AI question about an unproven usage', () => {
    expect(chooseMeaningForm(AI_QUESTION_MIN_STAGE, ['dark', 'gloom'], ids)).toEqual({ presentAs: 'AI-Generated-Question', usageId: 'unfam' });
    expect(chooseMeaningForm(5, ['dark'], ids, () => 0.99)?.usageId).toBe('unfam');
    expect(chooseMeaningForm(5, ['dark'], ids, () => 0)?.usageId).toBe('gloom');
  });

  it('shows the bare word when every usage is proven', () => {
    expect(chooseMeaningForm(6, ids, ids)).toBeNull();
  });
});
