/**
 * Quality rules for sentence-assembly exercises.
 *
 * A two- or three-piece assembly is a guess, not an exercise — especially when
 * one piece carries the sentence-final 。 and so obviously goes last. Enforced in
 * code at facet creation rather than trusted to the generating prompt.
 */

/** Minimum number of real (non-punctuation) fragments for an assembly to be worth reviewing. */
export const MIN_ASSEMBLY_FRAGMENTS = 4;

const PUNCTUATION_ONLY = /^[\s　。、！？!?.,「」『』…]+$/u;

export function countMeaningfulFragments(fragments: unknown): number {
  if (!Array.isArray(fragments)) return 0;
  return fragments.filter(f => typeof f === 'string' && f.trim() !== '' && !PUNCTUATION_ONLY.test(f)).length;
}

export function isUsefulAssembly(fragments: unknown): boolean {
  return countMeaningfulFragments(fragments) >= MIN_ASSEMBLY_FRAGMENTS;
}
