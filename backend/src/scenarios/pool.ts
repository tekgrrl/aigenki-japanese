/**
 * The scenario pool: shared scenarios (content only) that learners start into their own scenario
 * doc, which holds only their progress. Readers get the two combined by mergePoolScenario, so the
 * rest of the app keeps working with one `Scenario` object.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { PoolScenario, Scenario } from '../types/scenario';

/** The fields a pool scenario shares; everything else on a learner's scenario is their own. */
export const POOL_CONTENT_FIELDS = [
  'title', 'description', 'difficultyLevel', 'setting', 'roles', 'dialogue', 'extractedKUs', 'grammarMatches', 'grammarNotes',
  'secondaryKUs', 'simulationBrief',
] as const;

/**
 * A learner's scenario as the app sees it: the pool's content, with anything the learner's doc has
 * written on top (progress, their linked extractedKUs, a scene they drew). `setting` is merged one
 * level deep so a learner's `setting.picture` doesn't hide the shared location and goal.
 */
export function mergePoolScenario(pool: PoolScenario | null | undefined, learnerDoc: Scenario): Scenario {
  if (!pool) return learnerDoc;
  const content = Object.fromEntries(POOL_CONTENT_FIELDS.filter(f => pool[f] !== undefined).map(f => [f, pool[f]]));
  return {
    ...content,
    ...learnerDoc,
    setting: { ...pool.setting, ...(learnerDoc.setting ?? {}) },
  } as Scenario;
}

/** The premise: what the admin writes. The rest of a pool scenario is generated from it plus its goals. */
export const PREMISE_FIELDS = ['title', 'description', 'difficultyLevel', 'setting', 'roles', 'simulationBrief'] as const;

/** Written on the pool scenario by the first start; cleared when the premise or goals change. */
export const GENERATED_FIELDS = ['dialogue', 'extractedKUs', 'grammarMatches', 'grammarNotes', 'secondaryKUs', 'generatedAt'] as const;

/** A scenario's premise, for publishing it to the pool (no dialogue: that's generated on first start). */
export function premiseOf(scenario: Pick<Scenario, typeof PREMISE_FIELDS[number]>): Partial<PoolScenario> {
  const premise: Record<string, unknown> = Object.fromEntries(PREMISE_FIELDS.filter(f => scenario[f] !== undefined).map(f => [f, scenario[f]]));
  // The admin's drawn scene lives in their own folder and is deleted if they redraw it: don't share it.
  if (scenario.setting) {
    const { picture: _own, ...setting } = scenario.setting;
    premise.setting = setting;
  }
  return premise as Partial<PoolScenario>;
}

/** True when two pool versions differ in anything the generated scenario depends on. */
export function premiseOrGoalsChanged(before: Partial<PoolScenario>, after: Partial<PoolScenario>): boolean {
  const pick = (p: Partial<PoolScenario>) => JSON.stringify([...PREMISE_FIELDS.filter(f => f !== 'simulationBrief').map(f => p[f] ?? null), p.goals ?? null, p.allowed ?? null]);
  return pick(before) !== pick(after);
}

/** A learner's fresh scenario doc for a pool scenario: progress only, ready for the play-through. */
export function newLearnerDoc(poolId: string, uid: string): Partial<Scenario> {
  return {
    id: poolId,
    poolId,
    userId: uid,
    state: 'encounter',
    createdAt: Timestamp.now(),
    chatHistory: [],
    isObjectiveMet: false,
    isActive: true,
  };
}
