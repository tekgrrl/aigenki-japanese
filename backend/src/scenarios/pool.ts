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

/** The pool doc published from one of the admin's own scenarios: its content fields only. */
export function poolContentOf(scenario: Scenario, publishedFrom: { uid: string; scenarioId: string }, id: string): PoolScenario {
  const content: Record<string, unknown> = Object.fromEntries(POOL_CONTENT_FIELDS.filter(f => scenario[f] !== undefined).map(f => [f, scenario[f]]));
  // The admin may have played it already: their per-item status isn't a learner's starting point.
  if (Array.isArray(scenario.extractedKUs)) content.extractedKUs = scenario.extractedKUs.map(ku => ({ ...ku, status: 'new' }));
  return { ...content, id, publishedFrom, createdAt: Timestamp.now() } as PoolScenario;
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
