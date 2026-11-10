import { dropStaleFurigana, isValidFurigana } from './lessons.service';

describe('isValidFurigana', () => {
  const s = '私はあまり肉を食べません。';
  it('accepts readings inserted after kanji', () => {
    expect(isValidFurigana(s, '私[わたし]はあまり肉[にく]を食[た]べません。')).toBe(true);
  });
  it('accepts a kanji-free sentence returned unchanged', () => {
    expect(isValidFurigana('ありがとう。', 'ありがとう。')).toBe(true);
  });
  it('accepts 々 in a kanji run', () => {
    expect(isValidFurigana('人々が来ます。', '人々[ひとびと]が来[き]ます。')).toBe(true);
  });
  it('rejects a changed sentence', () => {
    expect(isValidFurigana(s, '私[わたし]はあまり魚[さかな]を食[た]べません。')).toBe(false);
  });
  it('rejects okurigana inside the brackets (a reading must follow a kanji)', () => {
    expect(isValidFurigana(s, '私[わたし]はあまり肉[にく]を食べ[たべ]ません。')).toBe(false);
  });
  it('rejects a reading on kana', () => {
    expect(isValidFurigana('あまり', 'あまり[あまり]')).toBe(false);
  });
  it('rejects katakana or romaji readings', () => {
    expect(isValidFurigana('肉', '肉[ニク]')).toBe(false);
    expect(isValidFurigana('肉', '肉[niku]')).toBe(false);
  });
  it('rejects a missing annotation', () => {
    expect(isValidFurigana(s, undefined)).toBe(false);
  });
});

describe('dropStaleFurigana', () => {
  it('keeps furigana that still matches its sentence', () => {
    const ex = { japanese: '肉を食べます。', furigana: '肉[にく]を食[た]べます。' };
    expect(dropStaleFurigana([ex])).toEqual([ex]);
  });
  it('removes furigana left over from an edited sentence', () => {
    const ex = { japanese: 'バスで行きます。', english: 'I go by bus.', furigana: '肉[にく]を食[た]べます。' };
    expect(dropStaleFurigana([ex])).toEqual([{ japanese: 'バスで行きます。', english: 'I go by bus.' }]);
  });
  it('leaves examples without furigana alone', () => {
    const ex = { japanese: 'バスで行きます。' };
    expect(dropStaleFurigana([ex])).toEqual([ex]);
  });
});
