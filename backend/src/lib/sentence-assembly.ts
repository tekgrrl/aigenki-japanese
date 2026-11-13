/**
 * Sentence assembly with blanks: turns one example sentence (its fragments plus the fragments
 * hand-marked as the grammar pattern) into what an assembly card needs. The marked pieces become
 * blanks the learner fills in. Pure code: no database, no AI.
 */
import { stripFurigana } from './furigana-text';

export interface AssemblyExampleInput {
  japanese: string;
  english?: string;
  fragments: string[];
  accepted_alternatives?: string[];
  /** Indices into `fragments` that are the grammar pattern. */
  patternFragments?: number[];
  /** `japanese` with readings (食[た]べます); used to accept kana answers for kanji blanks. */
  furigana?: string;
}

/** One piece to place, in the sentence's own order. `text: null` is a blank. */
export interface AssemblyPiece {
  text: string | null;
  /** For a blank: its index in `blanks`. */
  blank?: number;
}

export interface AssemblyBlank {
  /** The fragment's text (sentence-final punctuation removed). */
  answer: string;
  /** Answers that count as right: the text, and its hiragana reading when it can be worked out. */
  accept: string[];
}

export interface AssemblyCard {
  pieces: AssemblyPiece[];
  blanks: AssemblyBlank[];
  answer: string;
  english: string;
  alternatives: string[];
}

/** The example can't be turned into a card (the message says why). */
export class AssemblyError extends Error {}

const FINAL_PUNCTUATION = /[。！？!?.]+$/u;
const KANJI_RUN = /[\u4e00-\u9faf\u3005]+/u;

/** Katakana → hiragana; everything else unchanged. */
export function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/** Pattern marks are usable: at least one, none repeated or out of range, and not every fragment. */
export function validPatternMarks(fragments: unknown, marks: unknown): boolean {
  if (!Array.isArray(fragments) || !Array.isArray(marks) || marks.length === 0) return false;
  if (marks.length >= fragments.length) return false;
  const seen = new Set<number>();
  for (const m of marks) {
    if (!Number.isInteger(m) || m < 0 || m >= fragments.length || seen.has(m)) return false;
    seen.add(m);
  }
  return true;
}

/**
 * Splits `furigana` into units over the plain sentence: a kanji run with its reading is one unit
 * (it can't be cut), each other character is its own unit reading as itself. Null when the
 * annotation doesn't match the sentence.
 */
function readingUnits(japanese: string, furigana: string | undefined): { text: string; reading: string }[] | null {
  if (typeof furigana !== 'string' || stripFurigana(furigana) !== japanese) return null;
  const units: { text: string; reading: string }[] = [];
  const re = /([\u4e00-\u9faf\u3005]+)\[([^\]]*)\]|([^\[\]])/gu;
  for (const m of furigana.matchAll(re)) {
    if (m[1]) units.push({ text: m[1], reading: m[2] });
    else if (m[3]) units.push({ text: m[3], reading: m[3] });
  }
  return units.map(u => u.text).join('') === japanese ? units : null;
}

/** Reading of japanese[start, end), or null if it can't be worked out without guessing. */
function readingOf(text: string, start: number, units: { text: string; reading: string }[] | null): string | null {
  if (!KANJI_RUN.test(text)) return toHiragana(text);
  if (!units) return null;
  const end = start + text.length;
  let pos = 0;
  let reading = '';
  for (const u of units) {
    const uStart = pos;
    const uEnd = pos + u.text.length;
    pos = uEnd;
    if (uEnd <= start || uStart >= end) continue;
    if (uStart < start || uEnd > end) return null; // the piece cuts through a kanji run
    reading += u.reading;
  }
  return toHiragana(reading);
}

export function buildAssemblyCard(example: AssemblyExampleInput): AssemblyCard {
  const { japanese, fragments } = example;
  if (!Array.isArray(fragments) || fragments.length === 0 || fragments.some(f => typeof f !== 'string')) {
    throw new AssemblyError('The example has no fragments');
  }
  if (fragments.join('') !== japanese) {
    throw new AssemblyError('The fragments don\'t join back into the sentence');
  }
  if (!validPatternMarks(fragments, example.patternFragments)) {
    throw new AssemblyError('Mark at least one fragment as the pattern, and leave at least one unmarked');
  }

  // Sentence-final punctuation would give away which piece goes last; a lone 。 piece is dropped.
  const offsets = fragments.map((_, i) => fragments.slice(0, i).join('').length);
  const texts = [...fragments];
  texts[texts.length - 1] = texts[texts.length - 1].replace(FINAL_PUNCTUATION, '');
  const kept = texts.map((t, i) => i).filter(i => texts[i].trim() !== '');
  const marked = new Set(example.patternFragments!.filter(i => kept.includes(i)));
  if (marked.size === 0 || marked.size === kept.length) {
    throw new AssemblyError('Mark at least one fragment as the pattern, and leave at least one unmarked');
  }

  const units = readingUnits(japanese, example.furigana);
  const pieces: AssemblyPiece[] = [];
  const blanks: AssemblyBlank[] = [];
  for (const i of kept) {
    if (!marked.has(i)) {
      pieces.push({ text: texts[i] });
      continue;
    }
    const reading = readingOf(texts[i], offsets[i], units);
    const accept = [...new Set([texts[i], ...(reading ? [reading] : [])])];
    pieces.push({ text: null, blank: blanks.length });
    blanks.push({ answer: texts[i], accept });
  }

  return {
    pieces,
    blanks,
    answer: japanese,
    english: example.english ?? '',
    alternatives: example.accepted_alternatives ?? [],
  };
}
