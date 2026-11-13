import { dropInvalidPatternMarks } from './lessons.service';

describe('dropInvalidPatternMarks', () => {
  const fragments = ['本を', '読み', 'ます。'];

  it('keeps marks that fit the fragments, and examples without marks', () => {
    const examples = [{ fragments, patternFragments: [2] }, { fragments }];
    expect(dropInvalidPatternMarks(examples)).toEqual(examples);
  });

  it('removes marks that are out of range, repeated, or cover every fragment', () => {
    for (const marks of [[3], [1, 1], [0, 1, 2]]) {
      expect(dropInvalidPatternMarks([{ fragments, patternFragments: marks }])).toEqual([{ fragments }]);
    }
  });
});
