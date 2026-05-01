export function applyFurigana(enabled: boolean) {
  if (typeof document === 'undefined') return;
  if (enabled) {
    document.documentElement.setAttribute('data-furigana', 'true');
  } else {
    document.documentElement.removeAttribute('data-furigana');
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('furiganaVisible', String(enabled));
  }
}

export function loadFurigana(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem('furiganaVisible') === 'true';
}

/**
 * Builds a FuriganaText-compatible markup string from a Japanese word and its
 * per-kanji component data.
 *
 * e.g. content="食べる", componentKanji=[{kanji:"食", reading:"た"}]
 *      → "食[た]べる"
 *
 * Pure-kana words or words with no component_kanji return unchanged — FuriganaText
 * renders them as plain text, which is correct (kana needs no furigana).
 */
export function buildFuriganaMarkup(
  content: string,
  componentKanji: { kanji: string; reading: string }[],
): string {
  if (!componentKanji.length) return content;

  const kanjiMap = new Map(componentKanji.map(k => [k.kanji, k.reading]));

  let result = "";
  for (const char of content) {
    const reading = kanjiMap.get(char);
    result += reading ? `${char}[${reading}]` : char;
  }
  return result;
}
