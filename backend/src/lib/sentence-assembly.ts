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
  /** Decoy pieces that aren't part of the sentence; the learner has to leave them out. */
  distractors?: string[];
  /** Spare blank chips (0–MAX_BLANK_DECOYS): the learner has to work out how many blanks the sentence needs. */
  blankDecoys?: number;
  /** Free-text tags shown with the English (e.g. "polite"), to say which form is wanted. Display only. */
  hints?: string[];
  /** `japanese` with readings (食[た]べます); used to accept kana answers for kanji blanks. */
  furigana?: string;
}

/** One piece to place, in the sentence's own order. `text: null` is a blank. */
export interface AssemblyPiece {
  text: string | null;
  /** For a blank: its index in `blanks`. */
  blank?: number;
  /** A decoy: not part of the answer (the answer is built without it). A decoy blank has `text: null` and no `blank`. */
  distractor?: true;
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
  /** The example's hints, trimmed, empty ones and repeats dropped. */
  hints: string[];
  alternatives: string[];
}

/** The example can't be turned into a card (the message says why). */
export class AssemblyError extends Error {}

/** Most spare blank chips one example can have. */
export const MAX_BLANK_DECOYS = 3;

const FINAL_PUNCTUATION = /[。！？!?.]+$/u;
const KANJI_RUN = /[\u4e00-\u9faf\u3005]+/u;

/** Katakana → hiragana; everything else unchanged. ヵ/ヶ are left alone (in 3ヶ月 they read か/が). */
export function toHiragana(text: string): string {
  return text.replace(/[\u30a1-\u30f4]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * The fragments as the card shows them: sentence-final punctuation stripped from the last one
 * (it would give away which piece goes last), and `kept` = indices of pieces left to place
 * (a lone 。 piece disappears).
 */
function displayPieces(fragments: string[]): { texts: string[]; kept: number[] } {
  const texts = [...fragments];
  texts[texts.length - 1] = texts[texts.length - 1].replace(FINAL_PUNCTUATION, '');
  return { texts, kept: texts.map((_, i) => i).filter(i => texts[i].trim() !== '') };
}

/**
 * Pattern marks can build a card: at least one, none repeated or out of range, none on a lone
 * final 。, and at least one piece left unmarked. The card builder and the save-time backstop
 * (dropInvalidPatternMarks) both use this, so saved marks always build.
 */
export function validPatternMarks(fragments: unknown, marks: unknown): boolean {
  if (!Array.isArray(fragments) || fragments.length === 0 || fragments.some(f => typeof f !== 'string')) return false;
  if (!Array.isArray(marks) || marks.length === 0) return false;
  const { kept } = displayPieces(fragments);
  const seen = new Set<number>();
  for (const m of marks) {
    if (!Number.isInteger(m) || !kept.includes(m) || seen.has(m)) return false;
    seen.add(m);
  }
  return seen.size < kept.length;
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

  const offsets = fragments.map((_, i) => fragments.slice(0, i).join('').length);
  const { texts, kept } = displayPieces(fragments);
  const marked = new Set(example.patternFragments!);

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

  // Decoys go after the real pieces (the card shuffles anyway). One that matches a real piece
  // would be indistinguishable from it, so it's refused.
  const real = new Set(texts.map(t => t.trim()));
  for (const d of [...new Set((example.distractors ?? []).map(x => String(x).trim()).filter(Boolean))]) {
    if (real.has(d)) throw new AssemblyError(`The decoy "${d}" is also a real piece of the sentence`);
    pieces.push({ text: d, distractor: true });
  }
  const spareBlanks = example.blankDecoys ?? 0;
  if (!Number.isInteger(spareBlanks) || spareBlanks < 0 || spareBlanks > MAX_BLANK_DECOYS) {
    throw new AssemblyError(`Spare blanks must be a whole number from 0 to ${MAX_BLANK_DECOYS}`);
  }
  for (let n = 0; n < spareBlanks; n++) pieces.push({ text: null, distractor: true });

  return {
    pieces,
    blanks,
    answer: japanese,
    english: example.english ?? '',
    hints: [...new Set((example.hints ?? []).map(h => String(h).trim()).filter(Boolean))],
    alternatives: example.accepted_alternatives ?? [],
  };
}

/** A Grammar example as stored, with what a review card needs besides the assembly itself. */
export type ReviewAssemblyExample = AssemblyExampleInput & { learnableTerms?: unknown[] };

/**
 * A review card from a lesson's examples: one chosen at random from those with marks that build
 * (unmarked examples are never used once any example is marked), with that example's learnable
 * terms for the "don't know this" flag. Null when no example is marked.
 */
export function pickReviewAssembly(
  examples: ReviewAssemblyExample[] | undefined,
  random: () => number = Math.random,
): { card: AssemblyCard; learnableTerms: unknown[] } | null {
  const usable: { card: AssemblyCard; learnableTerms: unknown[] }[] = [];
  for (const ex of examples ?? []) {
    if (!validPatternMarks(ex.fragments, ex.patternFragments)) continue;
    try {
      usable.push({ card: buildAssemblyCard(ex), learnableTerms: ex.learnableTerms ?? [] });
    } catch (e) {
      if (!(e instanceof AssemblyError)) throw e; // e.g. a decoy equal to a real piece: skip it
    }
  }
  return usable.length ? usable[Math.floor(random() * usable.length)] : null;
}
