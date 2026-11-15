/**
 * Judging a blanks sentence-assembly card (built by the backend's lib/sentence-assembly.ts).
 * Shared by the Grammar review card and the admin Assembly Lab so both judge answers the same way.
 */
import * as wanakana from "wanakana";
import { normalizeAssemblyAnswer as normalize } from "./assembly-answer";

export interface AssemblyCard {
  /** In sentence order, then decoys. `text: null` is a blank chip; a decoy has `distractor`. */
  pieces: { text: string | null; blank?: number; distractor?: true }[];
  blanks: { answer: string; accept: string[] }[];
  answer: string;
  english: string;
  hints: string[];
  alternatives: string[];
}

/**
 * Blank chips look alike, so the k-th blank chip placed stands for the k-th blank of the sentence.
 * Returns chip index → k. A k past the sentence's blanks means a spare blank was placed.
 */
export function blankSlots(card: AssemblyCard, placed: number[]): Map<number, number> {
  const at = new Map<number, number>();
  placed.filter(p => card.pieces[p].text === null).forEach((p, k) => at.set(p, k));
  return at;
}

/** The sentence matches the answer or an accepted alternative (trailing punctuation and spaces ignored). */
export function sentenceMatches(card: AssemblyCard, sentence: string): boolean {
  return [card.answer, ...card.alternatives].some(a => normalize(a) === normalize(sentence));
}

/**
 * Whether the placed pieces are in a right order: exactly as many blank chips as the sentence
 * has blanks, and the pieces (blanks read as their answers) join into the sentence.
 */
export function checkOrder(card: AssemblyCard, placed: number[]): { ok: boolean; joined: string; blanksPlaced: number } {
  const slots = blankSlots(card, placed);
  const joined = placed.map(p => card.pieces[p].text ?? card.blanks[slots.get(p)!]?.answer ?? "＿").join("");
  const ok = slots.size === card.blanks.length && sentenceMatches(card, joined);
  return { ok, joined, blanksPlaced: slots.size };
}

/** For each blank of the sentence, whether what was typed in its chip is accepted (compared as hiragana). */
export function checkBlanks(card: AssemblyCard, placed: number[], typed: Record<number, string>): boolean[] {
  const chipFor: number[] = [];
  blankSlots(card, placed).forEach((k, p) => { chipFor[k] = p; });
  const kana = (s: string) => wanakana.toHiragana(normalize(s));
  return card.blanks.map((b, k) => {
    const value = chipFor[k] === undefined ? "" : typed[chipFor[k]] ?? "";
    return b.accept.some(a => kana(a) === kana(value));
  });
}

/** What was typed in each blank of the sentence, in order (for feedback). */
export function typedPerBlank(card: AssemblyCard, placed: number[], typed: Record<number, string>): string[] {
  const chipFor: number[] = [];
  blankSlots(card, placed).forEach((k, p) => { chipFor[k] = p; });
  return card.blanks.map((_, k) => (chipFor[k] === undefined ? "" : typed[chipFor[k]] ?? ""));
}
