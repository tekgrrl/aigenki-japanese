import type { VocabUsage } from '../types';

/**
 * The Vocab meaning card (specs/learning-goal-model.md): one SRS stage for the word, and a
 * record of which usages have been proven at the current stage. The card moves up only once
 * every usage is proven.
 */

/** An answer without surrounding space or trailing Japanese/ASCII punctuation (case kept). */
export function stripTrailingPunctuation(s: string): string {
  return s.trim().replace(/[。、！？,.!?\s]+$/u, '').trim();
}

/** The answer normalisation evaluateAnswer uses: case, surrounding space, trailing punctuation. */
export function normaliseAnswer(s: string): string {
  return stripTrailingPunctuation(s.toLowerCase());
}

/** The usage whose meaning or accepted answers match the answer exactly (after normalising). */
export function matchUsageLocally(answer: string, usages: VocabUsage[]): VocabUsage | null {
  const a = normaliseAnswer(answer);
  if (!a) return null;
  return usages.find(u => [u.meaning, ...u.acceptedAnswers].some(x => normaliseAnswer(x) === a)) ?? null;
}

export type MeaningOutcome =
  /** Every usage is now proven: the card moves up and the record clears. */
  | 'promote'
  /** Correct, but the set isn't complete (or no usage was identified): same stage, normal interval. */
  | 'hold'
  /** Wrong, with nothing proven yet at this stage: a normal SRS fail. */
  | 'fail'
  /** Wrong while searching for another usage: no SRS effect at all. */
  | 'free-fail';

/**
 * Decides what a meaning-card answer does. `proven` is the card's record; ids of usages that
 * no longer exist are ignored. Returns the outcome and the record to store.
 */
export function meaningOutcome(
  result: 'pass' | 'fail',
  usageId: string | undefined,
  proven: string[] | undefined,
  usageIds: string[],
): { outcome: MeaningOutcome; proven: string[] } {
  const current = (proven ?? []).filter(id => usageIds.includes(id));
  if (result === 'fail') {
    return current.length === 0 ? { outcome: 'fail', proven: [] } : { outcome: 'free-fail', proven: current };
  }
  const next = usageId && usageIds.includes(usageId) && !current.includes(usageId) ? [...current, usageId] : current;
  const complete = usageIds.length > 0 && usageIds.every(id => next.includes(id));
  return complete ? { outcome: 'promote', proven: [] } : { outcome: 'hold', proven: next };
}

/**
 * Placeholder rule (the real one is deferred to the SRS tuning pass): from this SRS stage, a
 * due meaning card is shown as an AI question about a usage not yet proven at this stage.
 */
export const AI_QUESTION_MIN_STAGE = 4;

/**
 * How a due meaning card is shown: an AI question for one unproven usage (picked at random),
 * or null for the bare word.
 */
export function chooseMeaningForm(
  srsStage: number,
  proven: string[] | undefined,
  usageIds: string[],
  random: () => number = Math.random,
): { presentAs: 'AI-Generated-Question'; usageId: string } | null {
  if (srsStage < AI_QUESTION_MIN_STAGE) return null;
  const unproven = usageIds.filter(id => !(proven ?? []).includes(id));
  if (unproven.length === 0) return null;
  return { presentAs: 'AI-Generated-Question', usageId: unproven[Math.floor(random() * unproven.length)] };
}
