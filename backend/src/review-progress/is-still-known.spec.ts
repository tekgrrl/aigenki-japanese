import { isStillKnown } from './review-progress.service';

const h = (...entries: [number, 'pass' | 'fail'][]) => ({
  history: entries.map(([stage, result]) => ({ stage, result, timestamp: '' })),
});

describe('isStillKnown', () => {
  it('a skipped word answered right every time is known', () => {
    expect(isStillKnown([h([4, 'pass']), h([4, 'pass'], [5, 'pass'])])).toBe(true);
  });

  it('a newly unlocked facet (no answers yet) does not count either way', () => {
    expect(isStillKnown([h([4, 'pass']), { history: [] }, {}])).toBe(true);
  });

  it('one miss anywhere puts the word on the full SRS', () => {
    expect(isStillKnown([h([4, 'pass']), h([1, 'fail'])])).toBe(false);
    expect(isStillKnown([h([4, 'pass'], [1, 'fail'], [2, 'pass'])])).toBe(false);
  });

  it('a word learned normally is not known', () => {
    expect(isStillKnown([h([1, 'pass'], [2, 'pass'], [3, 'pass'], [4, 'pass'])])).toBe(false);
  });

  it('nothing answered yet is not known', () => {
    expect(isStillKnown([{ history: [] }])).toBe(false);
  });
});
