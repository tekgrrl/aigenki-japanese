/** CJK ideographs: Extension A, Unified, Compatibility. Excludes 々, kana and latin. */
const KANJI = /[㐀-䶿一-鿿豈-﫿]/g;

/**
 * The distinct kanji in a word's content, in order of appearance (食べ物 → ['食','物']).
 * Stored on Vocab KUs as data.kanji so "words using 食" is one array-contains query.
 */
export function kanjiIn(content: string): string[] {
  return [...new Set(content.match(KANJI) ?? [])];
}
