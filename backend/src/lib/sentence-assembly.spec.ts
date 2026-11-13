import { AssemblyError, buildAssemblyCard, toHiragana, validPatternMarks } from './sentence-assembly';

const superlative = {
  japanese: 'クラスの中で田中さんが一番背が高いです。',
  english: 'Tanaka is the tallest in the class.',
  fragments: ['クラスの中で', '田中さんが', '一番', '背が高いです。'],
  accepted_alternatives: [],
  furigana: 'クラスの中[なか]で田中[たなか]さんが一番[いちばん]背[せ]が高[たか]いです。',
};

describe('buildAssemblyCard', () => {
  it('turns one marked fragment into a blank, in sentence order', () => {
    const card = buildAssemblyCard({
      japanese: '毎朝コーヒーを飲んでいます。',
      fragments: ['毎朝', 'コーヒーを', '飲んで', 'います。'],
      patternFragments: [3],
    });
    expect(card.pieces).toEqual([{ text: '毎朝' }, { text: 'コーヒーを' }, { text: '飲んで' }, { text: null, blank: 0 }]);
    // The final 。 is stripped, so it isn't part of what the learner types.
    expect(card.blanks).toEqual([{ answer: 'います', accept: ['います'] }]);
    expect(card.answer).toBe('毎朝コーヒーを飲んでいます。');
  });

  it('gives a frame one blank per marked fragment, with kana readings from furigana', () => {
    const card = buildAssemblyCard({ ...superlative, fragments: ['クラスの', '中で', '田中さんが', '一番', '背が高いです。'], patternFragments: [1, 3] });
    expect(card.pieces.map(p => p.text ?? `[${p.blank}]`)).toEqual(['クラスの', '[0]', '田中さんが', '[1]', '背が高いです']);
    expect(card.blanks).toEqual([
      { answer: '中で', accept: ['中で', 'なかで'] },
      { answer: '一番', accept: ['一番', 'いちばん'] },
    ]);
  });

  it('accepts only the exact text for a kanji blank when there is no furigana', () => {
    const { furigana: _none, ...plain } = superlative;
    const card = buildAssemblyCard({ ...plain, patternFragments: [2] });
    expect(card.blanks).toEqual([{ answer: '一番', accept: ['一番'] }]);
  });

  it('gives no reading when the piece cuts through a kanji run', () => {
    const card = buildAssemblyCard({
      japanese: '田中です。',
      fragments: ['田', '中', 'です。'],
      furigana: '田中[たなか]です。',
      patternFragments: [1],
    });
    expect(card.blanks[0].accept).toEqual(['中']);
  });

  it('accepts katakana blanks typed in hiragana', () => {
    const card = buildAssemblyCard({ japanese: 'あれはテレビです。', fragments: ['あれは', 'テレビ', 'です。'], patternFragments: [1] });
    expect(card.blanks[0].accept).toEqual(['テレビ', 'てれび']);
  });

  it('drops a lone 。 piece', () => {
    const card = buildAssemblyCard({ japanese: '本を読みます。', fragments: ['本を', '読み', 'ます', '。'], patternFragments: [2] });
    expect(card.pieces).toEqual([{ text: '本を' }, { text: '読み' }, { text: null, blank: 0 }]);
  });

  it.each([
    ['no marks', { patternFragments: [] }],
    ['every piece marked', { patternFragments: [0, 1, 2, 3] }],
    ['an index out of range', { patternFragments: [9] }],
    ['fragments that do not join back', { fragments: ['クラスの中で', '一番'], patternFragments: [1] }],
  ])('refuses %s', (_label, change) => {
    expect(() => buildAssemblyCard({ ...superlative, ...change })).toThrow(AssemblyError);
  });

  it('refuses when the only unmarked piece is a lone 。', () => {
    expect(() => buildAssemblyCard({ japanese: '行きます。', fragments: ['行き', 'ます', '。'], patternFragments: [0, 1] })).toThrow(AssemblyError);
  });
});

describe('validPatternMarks', () => {
  it('agrees with the card builder about a lone final 。', () => {
    expect(validPatternMarks(['行き', 'ます', '。'], [0, 1])).toBe(false); // nothing left to place
    expect(validPatternMarks(['行き', 'ます', '。'], [2])).toBe(false);    // marks the 。 itself
    expect(validPatternMarks(['行き', 'ます', '。'], [1])).toBe(true);
  });

  it('rejects repeats and non-integers', () => {
    expect(validPatternMarks(['a', 'b', 'c'], [1, 1])).toBe(false);
    expect(validPatternMarks(['a', 'b', 'c'], [0.5])).toBe(false);
    expect(validPatternMarks(['a', 'b', 'c'], [0, 2])).toBe(true);
  });
});

describe('toHiragana', () => {
  it('converts katakana and leaves the rest', () => {
    expect(toHiragana('テレビを見ます')).toBe('てれびを見ます');
    expect(toHiragana('ヴ3ヶ月')).toBe('ゔ3ヶ月');
  });
});
