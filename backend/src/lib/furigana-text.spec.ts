import { stripFurigana } from './furigana-text';

describe('stripFurigana', () => {
  it('removes every bracketed reading and leaves the rest', () => {
    expect(stripFurigana('毎日[まいにち]、日本語[にほんご]を練習[れんしゅう]します')).toBe('毎日、日本語を練習します');
  });

  it('leaves text without furigana unchanged', () => {
    expect(stripFurigana('ありがとう')).toBe('ありがとう');
  });
});
