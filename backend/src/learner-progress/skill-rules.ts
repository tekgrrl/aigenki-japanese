/**
 * What it takes to have learned a skill, judged from its raw evidence. THE place to experiment:
 * the evidence (users/{uid}/skill-evidence) is stored as-is, so changing these rules re-judges
 * every skill without losing anything.
 */

export type SkillState = 'unseen' | 'practising' | 'learned';

/** One answer that tested a skill. */
export interface SkillAttempt {
  /** ISO time of the answer. */
  at: string;
  result: 'pass' | 'fail';
  /** The verb the drill used. */
  verbKuId: string;
  /** The Grammar point whose card asked it. */
  grammarKuId: string;
  questionId?: string;
}

/**
 * Placeholder rule (owner, 2026-11-16: to be found by experiment): learned = enough correct answers
 * across enough different verbs, with the latest answer correct.
 */
export const LEARNED_RULE = { minCorrect: 3, minDistinctVerbs: 2 };

export function skillState(attempts: readonly SkillAttempt[]): SkillState {
  if (attempts.length === 0) return 'unseen';
  const correct = attempts.filter(a => a.result === 'pass');
  const verbs = new Set(correct.map(a => a.verbKuId));
  const latest = [...attempts].sort((a, b) => a.at.localeCompare(b.at)).at(-1)!;
  const learned = correct.length >= LEARNED_RULE.minCorrect
    && verbs.size >= LEARNED_RULE.minDistinctVerbs
    && latest.result === 'pass';
  return learned ? 'learned' : 'practising';
}
