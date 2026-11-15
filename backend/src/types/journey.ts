/**
 * A Journey: a step of the course, made of ordered phases, built in the admin Journey planner.
 * The plan is the data: each phase's taught items, set phrases and simulation brief are written
 * down onto its pool scenarios (the scenario outlines), which are generated from them. Passing a
 * phase takes scenario passes plus taught items at an SRS stage. Stored in `journeys`; a learner's
 * progress is worked out from their scenario docs and review cards, except that a completed
 * Journey is recorded once (`users/{uid}/journey-progress/{journeyId}`) so a lapse never re-locks.
 */
export interface Journey {
  id: string;
  title: string;
  /** Admin-written summary of the learning goals, e.g. "Introduce yourself and ask simple questions". */
  summary: string;
  difficultyLevel: string;
  /** Position in the course. Allowed items build up in this order. */
  order: number;
  /** The planner's own notes: why the Journey is shaped this way. Never shown to learners. */
  notes?: string;
  /** Journeys that must be done first (only earlier ones). Absent: the previous Journey by order. */
  unlockAfter?: string[];
  /** Optional rule over all the Journey's taught items, on top of every phase being passed. */
  passing?: ItemRule;
  phases: JourneyPhase[];
}

/** A share of items with every card at `minStage` or above. */
export interface ItemRule {
  minStage: number;
  /** 0–1: 1 means every item. */
  share: number;
}

/** Resolved Vocab and Grammar items. */
export interface PhaseItems {
  vocab: { content: string; kuId: string }[];
  grammarKuIds: string[];
}

export interface JourneyPhase {
  /** Stable id, so reports and the planner can refer to a phase across reorders. */
  id: string;
  title: string;
  notes?: string;
  goalSummary: string;
  /** New items this phase teaches: its scenarios' Key items, and what its passing rule counts. */
  taught: PhaseItems;
  /** Items the scenarios may use beyond everything taught before this phase. */
  extraAllowed: PhaseItems;
  /** Phrases the dialogue should use as they are. */
  setPhrases: string[];
  simulationBrief: string;
  /** Interstitial sections to teach in this phase (placeholders until interstitials exist). */
  interstitials: { title: string; conceptKuId?: string; notes?: string }[];
  passing: { scenarioPasses: number } & ItemRule;
  /** after-previous: opens once the previous phase is done. open: opens with the Journey. */
  unlock: 'after-previous' | 'open';
  /** The scenario outlines (pool entries); each sits in one phase only. */
  poolIds: string[];
}

export const DEFAULT_PHASE_PASSING: JourneyPhase['passing'] = { scenarioPasses: 1, minStage: 3, share: 1 };

export type JourneyStatus = 'locked' | 'current' | 'done';

/** A Journey as one learner sees it (GET /journeys). Planner-only fields are left out. */
export interface LearnerJourney {
  id: string;
  title: string;
  summary: string;
  difficultyLevel: string;
  order: number;
  status: JourneyStatus;
  /** Titles of the Journeys that must be done first (for "complete X to unlock"). */
  unlockAfterTitles: string[];
  /** Taught items whose cards are all at stage 3+ (worked out for current Journeys only). */
  goals?: { ready: number; total: number };
  phases: {
    id: string;
    title: string;
    status: JourneyStatus;
    done: boolean;
    /** Taught items meeting the phase's stage (current Journeys only). */
    goals?: { ready: number; total: number };
    passing: JourneyPhase['passing'];
    scenarios: { poolId: string; title: string; description: string; difficultyLevel: string; situationTags: string[]; started: boolean; passed: boolean }[];
  }[];
}
