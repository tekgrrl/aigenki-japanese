/**
 * When a due Grammar AI-question card is shown as a verb-form drill, and which skill and verb it
 * tests. The verb-form counterpart of chooseMeaningForm (meaning-card.ts).
 */
import type { PoolVerb, SkillProgress } from '../learner-progress/learner-progress.service';
import type { VerbForm } from '../lib/verb-forms';
import type { VerbFormTarget } from '../types';

/**
 * Placeholder rule (to be tuned by experiment, like the "learned" rule): while any of the point's
 * verb-form skills isn't learned, this share of its due AI-question cards are drills; the rest stay
 * translation / error correction.
 */
export const VERB_FORM_DRILL_SHARE = 0.5;

/**
 * Picks the skill with the least evidence among those not yet learned that have a verb to use
 * (ties at random), then a verb from it: one the learner studies if there is one. Null means the
 * card stays an ordinary Grammar question.
 */
export function chooseVerbFormTarget(
  skills: SkillProgress[],
  pools: Map<VerbForm, Map<string, PoolVerb[]>>,
  random: () => number = Math.random,
): VerbFormTarget | null {
  const verbsFor = (s: SkillProgress) => pools.get(s.form)?.get(s.group) ?? [];
  const open = skills.filter(s => s.state !== 'learned' && verbsFor(s).length > 0);
  if (open.length === 0 || random() >= VERB_FORM_DRILL_SHARE) return null;

  const fewest = Math.min(...open.map(s => s.attempts));
  const least = open.filter(s => s.attempts === fewest);
  const skill = least[Math.floor(random() * least.length)];

  const verbs = verbsFor(skill);
  const studied = verbs.filter(v => v.studied);
  const from = studied.length > 0 ? studied : verbs;
  const verb = from[Math.floor(random() * from.length)];
  return { skillId: skill.skillId, verbKuId: verb.kuId, verb: verb.content };
}
