import { checkBuiltUsages, DEFAULT_USAGE_ID, glossesOf, usagesOf, withUsageIds } from './vocab-usages';

describe('glossesOf', () => {
  it('splits multi-gloss definitions and drops parenthetical detail', () => {
    expect(glossesOf(['dark', 'dark, gloomy, dim', 'to spend (time, money)'])).toEqual(['dark', 'gloomy', 'dim', 'to spend']);
  });
});

describe('usagesOf', () => {
  it('returns built usages as they are', () => {
    const usages = [{ id: 'a1', label: 'dark', meaning: 'dark', acceptedAnswers: [] }];
    expect(usagesOf({ usages, definitions: ['x'] })).toBe(usages);
  });

  it('falls back to one usage accepting every definition', () => {
    expect(usagesOf({ definitions: ['dark', 'gloomy, dim'] })).toEqual([
      { id: DEFAULT_USAGE_ID, label: '', meaning: 'dark', acceptedAnswers: ['gloomy', 'dim'] },
    ]);
  });

  it('has no usages when there are no definitions', () => {
    expect(usagesOf({ definitions: [] })).toEqual([]);
  });
});

describe('checkBuiltUsages', () => {
  const kurai = {
    usages: [
      { label: 'dark (lacking light)', meaning: 'dark', acceptedAnswers: ['dim', 'Dark', 'dim'] },
      { label: 'unfamiliar with / ignorant of', meaning: 'unfamiliar with', acceptedAnswers: ['ignorant of'] },
    ],
    exampleUsages: [0, 1],
    setAside: [],
  };
  const fixed = ['dark (lacking light)', 'unfamiliar with / ignorant of'];

  it('accepts valid output and removes duplicate or meaning-repeating answers', () => {
    const r = checkBuiltUsages(kurai, 2, fixed);
    expect(r.usages[0].acceptedAnswers).toEqual(['dim']);
    expect(r.exampleUsages).toEqual([0, 1]);
  });

  it('gives a gloss to one usage only', () => {
    const hairu = {
      usages: [
        { label: 'entering', meaning: 'to enter', acceptedAnswers: ['to go in'] },
        { label: 'joining', meaning: 'to join', acceptedAnswers: ['to enter', 'to go in', 'to become a member'] },
      ],
      exampleUsages: [0, 1],
      setAside: [],
    };
    const r = checkBuiltUsages(hairu, 2, [null, null]);
    expect(r.usages[1].acceptedAnswers).toEqual(['to become a member']);
  });

  it('rejects two usages with the same meaning', () => {
    const same = { ...kurai, usages: [kurai.usages[0], { ...kurai.usages[1], meaning: 'dark' }] };
    expect(() => checkBuiltUsages(same, 2, fixed)).toThrow(/share a meaning/);
  });

  it('rejects a renamed fixed label', () => {
    const renamed = { ...kurai, usages: [{ ...kurai.usages[0], label: 'dark' }, kurai.usages[1]] };
    expect(() => checkBuiltUsages(renamed, 2, fixed)).toThrow(/fixed label/);
  });

  it('rejects the wrong number of examples', () => {
    expect(() => checkBuiltUsages(kurai, 3, [...fixed, null])).toThrow(/Expected 3/);
  });

  it('rejects a usage no example shows', () => {
    const extra = { ...kurai, usages: [...kurai.usages, { label: 'spare', meaning: 'spare', acceptedAnswers: [] }] };
    expect(() => checkBuiltUsages(extra, 2, fixed)).toThrow(/shown by no example/);
  });

  it('rejects a bad index', () => {
    expect(() => checkBuiltUsages({ ...kurai, exampleUsages: [0, 5] }, 2, fixed)).toThrow(/bad usage index/);
  });
});

describe('withUsageIds', () => {
  it('keeps the id of a usage whose label survives, and gives new usages new ids', () => {
    const previous = [{ id: 'keep01', label: 'Dark (lacking light)', meaning: 'dark', acceptedAnswers: [] }];
    const result = withUsageIds(
      [
        { label: 'dark (lacking light)', meaning: 'dark', acceptedAnswers: [] },
        { label: 'gloomy', meaning: 'gloomy', acceptedAnswers: [] },
      ],
      previous,
    );
    expect(result[0].id).toBe('keep01');
    expect(result[1].id).toMatch(/^[0-9a-f]{8}$/);
  });
});
