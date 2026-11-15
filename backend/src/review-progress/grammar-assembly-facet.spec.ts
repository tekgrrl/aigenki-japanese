import { ReviewProgressService } from './review-progress.service';

/** buildFacetData for a Grammar lesson's rotating sentence-assembly facet (no other dependencies used). */
const build = (examples: object[]) =>
  (new (ReviewProgressService as any)() as any).buildFacetData(
    { type: 'sentence-assembly', source: 'examples' },
    { type: 'Grammar', pattern: '～ながら', examples },
  ) as { examples: { answer: string }[] }[];

describe('Grammar sentence-assembly facet data', () => {
  const short = { japanese: '見ながら。', english: 'While watching.', fragments: ['見', 'ながら', '。'] };

  it('skips a short example with no blank marks', () => {
    expect(build([short])).toEqual([]);
  });

  it('keeps a short example once it has valid blank marks', () => {
    expect(build([{ ...short, patternFragments: [1] }])[0].examples.map(e => e.answer)).toEqual(['見ながら。']);
  });
});
