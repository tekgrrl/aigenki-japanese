// import { Timestamp } from 'firebase-admin/firestore';
// Mocking Timestamp for frontend to avoid firebase-admin dependency
export type Timestamp =
  | { seconds: number; nanoseconds: number; toDate: () => Date }
  | any;

export type ScenarioDifficulty = "N5" | "N4" | "N3" | "N2" | "N1";
export type ScenarioState = "encounter" | "drill" | "simulate" | "completed";

export interface ChatMessage {
  speaker: "user" | "ai";
  text: string;
  timestamp: number;
  correction?: string;
  sceneFinished?: boolean;
  roleName?: string;
}

export interface ScenarioDialogueLine {
  speaker: string;
  /** Unambiguous who's-speaking signal, independent of the free-text `speaker` label's language/wording. See GitHub #213. */
  speakerRole?: "user" | "ai";
  text: string;
  translation: string;
  audioUrl?: string;
}

// UPDATED: Split content into distinct fields for cleaner import
export interface ExtractedKU {
  content: string; // The Japanese writing (e.g., "本屋")
  reading: string; // The reading (e.g., "ほんや")
  meaning: string; // The English meaning (e.g., "Bookstore")
  type: "vocab" | "kanji";
  kuId?: string;
  status: "new" | "learning" | "mastered";
  jlptLevel?: string;
}

export interface GrammarNote {
  pattern?: string;
  title: string;
  explanation: string;
  exampleInContext: {
    japanese: string;
    english: string;
    fragments: string[];
    accepted_alternatives: string[];
  };
}

export interface GrammarMatch {
  kuId: string;
  exampleFromConversation: {
    japanese: string;
    english: string;
    fragments: string[];
    accepted_alternatives: string[];
  };
}

export interface ScenarioEvaluation {
  success: boolean;
  rating: number;
  feedback: string;
  corrections: {
    original: string;
    correction: string;
    explanation: string;
  }[];
  outcome?: "passed" | "failed";
  recommendedAction?: "repeat_lesson" | "replay_chat";
}

export interface Scenario {
  id: string;
  /** @deprecated - migrating to User state models */
  userId: string;
  title: string;
  description: string;
  difficultyLevel: ScenarioDifficulty;

  setting: {
    location: string;
    participants: string[];
    goal: string;
    timeOfDay: string;
    visualPrompt: string;
    /** The rendered scene, when one has been drawn (served by GET /scenarios/:id/picture). */
    picture?: { file: string; status: "approved" | "needs-review" };
  };

  dialogue: ScenarioDialogueLine[];
  extractedKUs: ExtractedKU[];
  grammarNotes: GrammarNote[];
  grammarMatches?: GrammarMatch[];

  /** Vocab mined from the user's OWN chatHistory turns at simulate->completed (not AI-scripted). */
  liveExtractedKUs?: ExtractedKU[];
  /** Grammar matches mined the same way. */
  liveGrammarMatches?: GrammarMatch[];

  /** @deprecated - migrating to User state models */
  state: ScenarioState;
  /** @deprecated - migrating to User state models */
  chatHistory?: ChatMessage[];
  /** @deprecated - migrating to User state models */
  isObjectiveMet?: boolean;
  /** @deprecated - migrating to User state models */
  evaluation?: ScenarioEvaluation;

  /** @deprecated - migrating to User state models */
  createdAt: Timestamp;
  /** @deprecated - migrating to User state models */
  completedAt?: Timestamp;
  /** @deprecated - migrating to User state models */
  pastAttempts?: ScenarioAttempt[];

  roles?: {
    user: string;
    ai: string | string[];
  };

  sourceType?: 'library' | 'custom' | 'context-example' | 'grammar-pattern';
  sourceContextSentence?: string;
  targetVocab?: string;
  sourceKuId?: string;
  sourceSectionId?: string;
  isActive?: boolean;

  progress?: Record<string, LevelProgress>;
  currentLevelStatus?: ProgressStatus;
  vocabReady?: boolean;
  /** Set on a learner's copy of a shared pool scenario (its id is the pool id). */
  poolId?: string;
}

/** A shared pool scenario as GET /scenarios/pool lists it (content only). */
export type PoolScenarioSummary = Pick<Scenario, "title" | "description" | "difficultyLevel" | "setting"> & { id: string };

export interface ScenarioTemplate {
  id: string;
  title: string;
  description: string;
  difficultyLevel: ScenarioDifficulty;
  setting: {
    location: string;
    participants: string[];
    goal: string;
    timeOfDay: string;
    visualPrompt: string;
  };
  dialogue: ScenarioDialogueLine[];
  extractedKUs: ExtractedKU[];
  grammarNotes: GrammarNote[];
  roles?: {
    user: string;
    ai: string | string[];
  };
}

export interface ScenarioSession {
  id: string;
  userId: string;
  templateId: string; // Bridges to ScenarioTemplate.id
  state: ScenarioState;
  chatHistory?: ChatMessage[];
  isObjectiveMet?: boolean;
  evaluation?: ScenarioEvaluation;
  createdAt: Timestamp;
  completedAt?: Timestamp;
  pastAttempts?: ScenarioAttempt[];
}

export interface ScenarioAttempt {
  completedAt: Timestamp;
  chatHistory: ChatMessage[];
  evaluation: ScenarioEvaluation;
}

export type ProgressStatus = 'reviewing' | 'failing' | 'passing' | 'passed';

export interface Attempt {
  attemptedAt: Timestamp;
  stars: 1 | 2 | 3 | 4 | 5;
}

export interface LevelProgress {
  status: ProgressStatus;
  bestStars: number; // 0 = no attempt yet
  lastAttemptAt: Timestamp | null;
  attempts: Attempt[];
}

export class GenerateScenarioDto {
  difficulty?: ScenarioDifficulty;
  theme?: string;
  sourceType?: 'library' | 'custom' | 'context-example' | 'grammar-pattern';
  sourceContextSentence?: string;
  targetVocab?: string;
  sourceKuId?: string;
  sourceSectionId?: string;
  userRole?: string;
  aiRole?: string;
}

export class ChatTurnDto {
  userMessage!: string;
}
