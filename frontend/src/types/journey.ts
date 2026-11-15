/** Resolved Vocab and Grammar items. */
export interface PhaseItems {
  vocab: { content: string; kuId: string }[];
  grammarKuIds: string[];
}

/** A share of items with every card at `minStage` or above (share 0–1). */
export interface ItemRule {
  minStage: number;
  share: number;
}

export interface JourneyPhase {
  id: string;
  title: string;
  notes?: string;
  goalSummary: string;
  taught: PhaseItems;
  extraAllowed: PhaseItems;
  setPhrases: string[];
  simulationBrief: string;
  interstitials: { title: string; conceptKuId?: string; notes?: string }[];
  passing: { scenarioPasses: number } & ItemRule;
  unlock: "after-previous" | "open";
  poolIds: string[];
}

/** A Journey as stored (the admin Journey planner). */
export interface Journey {
  id: string;
  title: string;
  summary: string;
  difficultyLevel: string;
  order: number;
  notes?: string;
  unlockAfter?: string[];
  passing?: ItemRule;
  phases: JourneyPhase[];
}

/** GET /journeys/admin: the Journeys, names for stored ids, and each phase's worked-out allowed items. */
export interface PlannerData {
  journeys: Journey[];
  names: Record<string, string>;
  allowed: Record<string, PhaseItems>;
}

export type JourneyStatus = "locked" | "current" | "done";

/** A Journey as one learner sees it (GET /journeys). */
export interface LearnerJourney {
  id: string;
  title: string;
  summary: string;
  difficultyLevel: string;
  order: number;
  status: JourneyStatus;
  unlockAfterTitles: string[];
  /** Taught items at stage 3+ (current Journeys only). */
  goals?: { ready: number; total: number };
  phases: {
    id: string;
    title: string;
    status: JourneyStatus;
    done: boolean;
    goals?: { ready: number; total: number };
    passing: JourneyPhase["passing"];
    scenarios: { poolId: string; title: string; description: string; difficultyLevel: string; situationTags: string[]; started: boolean; passed: boolean }[];
  }[];
}
