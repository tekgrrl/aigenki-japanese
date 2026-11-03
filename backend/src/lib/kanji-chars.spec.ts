import { kanjiIn } from './kanji-chars';

describe('kanjiIn', () => {
  it('lists kanji in order, skipping kana', () => {
    expect(kanjiIn('食べ物')).toEqual(['食', '物']);
  });
  it('dedupes and ignores 々', () => {
    expect(kanjiIn('人々')).toEqual(['人']);
    expect(kanjiIn('一人一人')).toEqual(['一', '人']);
  });
  it('returns nothing for kana-only or latin', () => {
    expect(kanjiIn('どのぐらい')).toEqual([]);
    expect(kanjiIn('メニュー')).toEqual([]);
    expect(kanjiIn('Tシャツ')).toEqual([]);
  });
  it('handles mixed latin and kanji', () => {
    expect(kanjiIn('CD屋')).toEqual(['屋']);
  });
});
