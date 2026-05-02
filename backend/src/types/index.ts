import { Timestamp } from "firebase-admin/firestore";

export interface ApiLog {
  id?: string; // Firestore document ID
  timestamp: any; // Firestore Timestamp
  route: string; // e.g., '/api/generate-lesson'
  status: "pending" | "success" | "error";
  durationMs?: number; // Time taken for the API call
  modelUsed: string;
  requestData: {
    systemPrompt?: string; // Optional, might be long
    userMessage: string; // Or the main input data
    input_userAnswer?: string;
    input_expectedAnswer?: string | null; // Allow null too
    input_question?: string | null;
    input_topic?: string | null;
    content?: string | null;
    kuId?: string | null;
    topic?: string | null;
    source?: string | null;
    [key: string]: any;
  };
  responseData?: {
    rawText?: string; // The raw text from the AI
    parsedJson?: any; // The parsed JSON object (if applicable)
  };
  errorData?: {
    message?: string;
    stack?: string;
    rawError?: string; // For non-Error objects
  };
}

/** A KU entry in a tutor context array, with per-facet-type granularity. */
export interface TutorVocabEntry {
  content: string;
  facetTypes: FacetType[];
}

/**
 * Represents the root document for a user in the strict multi-tenant architecture.
 * Document path: users/{uid}
 * This document serves as the unified source of truth for the user's high-level state.
 */
export interface UserRoot {
  id: string; // The Firestore document ID (which corresponds to the user's auth UID)
  email?: string;

  /**
   * Statistical data related to the user's reviews, engagement, and progression.
   * Consolidates legacy UserStats fields.
   */
  stats: {
    // Forecasts (Bucket Counts)
    reviewForecast: Record<string, number>; // "YYYY-MM-DD": count
    hourlyForecast: Record<string, number>; // "YYYY-MM-DD-HH": count

    // Engagement
    currentStreak: number;
    lastReviewDate?: Timestamp;

    // Performance
    totalReviews: number;
    passedReviews: number;

    // Progression (by Level)
    levelProgress: {
      n5: { total: number; mastered: number };
      n4: { total: number; mastered: number };
      n3?: { total: number; mastered: number };
      n2?: { total: number; mastered: number };
      n1?: { total: number; mastered: number };
    };
  };

  /**
   * Data specifically used by the AI Architect (Gemini) to personalize the learning experience.
   * This context acts as the "Personal Tutor" memory mapping logic context onto interaction styling.
   */
  tutorContext: {
    /** Words learned recently that the AI should actively try to reinforce in scenarios/examples. */
    frontierVocab: TutorVocabEntry[];

    /** Words the user has failed often that need repair/re-evaluation through the AI tutor. */
    leechVocab: TutorVocabEntry[];

    /** The current topic or structural node the user is tackling in their overall curriculum. */
    currentCurriculumNode: string;

    /** The set of grammar constructs the AI is permitted to use when generating content for this user. */
    allowedGrammar: string[];

    /** Specific grammar points the user struggles with; AI should emphasize diagnosing and practicing these. */
    weakGrammarPoints: TutorVocabEntry[];

    /** The user's identified conversational tendency, signaling how the AI should prompt for polite vs. casual context. */
    communicationStyle: 'too_formal' | 'too_casual' | 'balanced' | 'hesitant';

    /** Nuance or meaning-related weaknesses (e.g., struggling to differentiate similar-meaning words). */
    semanticWeaknesses: string[];

    /** Topics or themes the user brings up frequently or has shown interest in. */
    suggestedThemes: string[];

    /** User-configurable feed/learning preferences. Defaults applied by the feed engine if undefined. */
    preferences?: {
      /** Maximum total items (reviews + learns + leeches) in a single feed generation. Default: 20. */
      dailyMaxTotal?: number;
      /** Maximum new learn items introduced per feed generation. Default: 5. */
      dailyMaxNew?: number;
    };
  };

  /** Top-level user-facing preferences stored directly on the UserRoot document. */
  preferences?: {
    showFurigana?: boolean;
    /** User's current JLPT study level — used as default difficulty for generated scenarios. */
    jlptLevel?: 'N5' | 'N4' | 'N3' | 'N2' | 'N1';
    /** Default user persona in roleplay scenarios (e.g. "Traveler", "Student"). */
    preferredUserRole?: string;
  };
}

export interface VocabLesson {
  kuId?: string;
  type: "Vocab";
  vocab: string;
  reading: string; // The canonical kana reading
  definitions: string[];
  definition?: string; // Deprecated, kept for backward compatibility
  partOfSpeech: PartOfSpeech;
  conjugationType?: 'godan' | 'ichidan' | 'irregular';
  meaning_explanation: string;
  reading_explanation: string;
  context_examples?: { sentence: string; translation: string }[];
  component_kanji?: {
    kanji: string;
    reading: string;
    meaning: string;
    onyomi?: string[];
    kunyomi?: string[];
  }[];
}

export interface KanjiLesson {
  kuId?: string;
  type: "Kanji";
  kanji: string;
  meaning: string; // "eat, food"

  // Readings (Flattened from API)
  onyomi: string[];
  kunyomi: string[];

  // Visuals (From API)
  strokeCount: number;
  strokeImages: string[]; // Array of SVGs from 'kanji.strokes.images'

  // The Classifier (From API)
  radical?: {
    character: string;
    meaning: string;
    image: string; // SVG url
    animation?: string[]; // Optional: radical animation frames
  };

  references?: {
    grade: number;
    kodansha: number;
    classic_nelson: number;
  }

  // User Data (From Firestore/DB)
  /** @deprecated - migrating to User state models */
  personalMnemonic?: string;

  // Mnemonics from AI
  mnemonic_meaning: string;
  mnemonic_reading: string;

  // Context (From your DB)
  // This replaces the static "examples" string
  relatedVocab: {
    id: string;
    content: string;
    reading: string;
  }[];
}

export interface UserLessonData {
  lessonId: string; // The ID of the generic lesson it adapts
  userId: string;
  kuId: string;
  personalMnemonic?: string;
}

export interface GrammarLesson {
  kuId?: string;
  type: 'Grammar';
  pattern: string;       // e.g. "～をお願いします"
  title: string;         // e.g. "Making Requests with ～をお願いします"
  jlptLevel: string;
  meaning: string;       // one-line summary
  formation: string;     // "noun + をお願いします"
  notes: string;         // nuance, pitfalls
  examples: {
    japanese: string;
    english: string;
    context?: string;    // e.g. "convenience store" — for future facet targeting
    fragments: string[];
    accepted_alternatives: string[];
  }[];
}

export interface UserGrammarLesson {
  id: string;
  userId: string;
  kuId: string;
  lessonId: string;      // = kuId (Grammar lessons stored at lessons/{kuId})
  sourceType: 'scenario' | 'concept';
  sourceId: string;
  sourceTitle: string;
  contextExample: {
    japanese: string;
    english: string;
    fragments: string[];
    accepted_alternatives: string[];
  };
  createdAt: Timestamp;
}

export type Lesson = VocabLesson | KanjiLesson | GrammarLesson;

export type KnowledgeUnitType =
  | "Vocab"
  | "Kanji"
  | "Grammar"
  | "Concept"
  | "ExampleSentence";

// ─── KnowledgeUnit discriminated union ───────────────────────────────────────

/**
 * Fields shared by every KU sub-type.
 * Deprecated fields remain here until the User state migration is complete.
 */
export interface KnowledgeUnitBase {
  id: string;
  content: string; // The main "thing" (e.g., "食べる", "家族")
  relatedUnits: string[]; // Array of other KnowledgeUnit IDs
  /** @deprecated migrating to User state models */
  userId: string;
  /** @deprecated migrating to User state models */
  personalNotes: string;
  /** @deprecated migrating to User state models */
  userNotes?: string;
  /** @deprecated migrating to User state models */
  createdAt: Timestamp;
  /** @deprecated migrating to User state models */
  facet_count: number;
  /** @deprecated migrating to User state models */
  history?: any[];
}

export interface VocabKnowledgeUnit extends KnowledgeUnitBase {
  type: "Vocab";
  data: {
    reading?: string;
    definition?: string;
    conjugationType?: 'godan' | 'ichidan' | 'irregular';
    jlptLevel?: string | null;
    wanikaniLevel?: number | null;
    [key: string]: any;
  };
}

export interface KanjiKnowledgeUnit extends KnowledgeUnitBase {
  type: "Kanji";
  data: {
    meaning?: string;
    jlptLevel?: string | null;
    wanikaniLevel?: number | null;
    [key: string]: any;
  };
}

export interface GrammarKnowledgeUnit extends KnowledgeUnitBase {
  type: "Grammar";
  data: {
    title: string;
    explanation: string;
    exampleInContext: {
      japanese: string;
      english: string;
      fragments: string[];
      accepted_alternatives: string[];
    };
  };
}

export interface ConceptKnowledgeUnit extends KnowledgeUnitBase {
  type: "Concept";
  data: {
    title: string;
    reading?: string;
    overview: string;
    mechanics: Array<{
      goalTitle: string;
      englishIntent: string;
      rule: string;
      simpleExample: {
        japanese: string;
        english: string;
        highlight: string;
      };
      naturalExample: {
        japanese: string;
        english: string;
        highlight: string;
        fragments: string[];
        accepted_alternatives: string[];
      };
    }>;
    examples: Array<{
      japanese: string;
      reading?: string;
      english: string;
      targetGrammar: string;
    }>;
  };
}

export interface ExampleSentenceKnowledgeUnit extends KnowledgeUnitBase {
  type: "ExampleSentence";
  data: { [key: string]: any };
}

export type KnowledgeUnit =
  | VocabKnowledgeUnit
  | KanjiKnowledgeUnit
  | GrammarKnowledgeUnit
  | ConceptKnowledgeUnit
  | ExampleSentenceKnowledgeUnit;

// ─────────────────────────────────────────────────────────────────────────────

export type PartOfSpeech =
  | "transitive-verb"
  | "intransitive-verb"
  | "i-adjective"
  | "na-adjective"
  | "noun"
  | "noun-prenominal"
  | "proper-noun"
  | "noun-suru"
  | "counter"
  | "adverb"
  | "auxiliary-verb"
  | "prefix"
  | "suffix"
  | "conjunction";

export interface UserKnowledgeUnit {
  id: string;
  userId: string;
  kuId: string; // Bridges to KnowledgeUnit.id
  personalNotes: string;
  userNotes?: string;
  createdAt: Timestamp;
  status: "learning" | "reviewing" | "mastered";
  facet_count: number;
  history?: any[];
  source?: {
    type: 'scenario' | 'lesson';
    id: string;
  };
}

export interface UserConcept {
  id: string;
  userId: string;
  conceptId: string;
  startedAt: Timestamp;
  lastSeenAt?: Timestamp;
}

/** Distributes Omit across union members, preserving the discriminated union. */
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

export type KnowledgeUnitClient = DistributiveOmit<KnowledgeUnit, "createdAt"> & {
  createdAt: string;
};

export type FacetType =
  | "Content-to-Definition"
  | "Definition-to-Content"
  | "Content-to-Reading"
  | "AI-Generated-Question"
  | "Reading-to-Content"
  | "Kanji-Component-Meaning" // e.g., "食" -> "eat"
  | "Kanji-Component-Reading" // e.g., "食" -> "ショク"
  | "audio"
  | "sentence-assembly"
  | "sentence-cloze";

export interface ReviewFacet {
  id: string;
  userId: string;
  kuId: string; // ID of the parent KnowledgeUnit
  facetType: FacetType;
  srsStage: number; // 0 (new) to 8 (mastered)
  nextReviewAt: Timestamp; // ISO string
  lastReviewAt?: Timestamp; // ISO string
  history?: Array<{
    timestamp: string;
    result: "pass" | "fail";
    stage: number;
  }>;
  currentQuestionId?: string;
  /** Consecutive failures on this facet (resets on pass). Used for leech detection. */
  consecutiveFailures?: number;
  /** @deprecated - failure tracking moved to UserQuestionState.consecutiveFailures */
  questionAttempts?: number;
  data?: any;
  source?: {
    type: 'lesson' | 'concept';
    id: string;
  };
}

export interface ReviewItem {
  facet: ReviewFacet;
}

// This represents the structure of our old db.json
// We're keeping it for reference but not using it for Firestore.
export interface Database {
  kus: KnowledgeUnit[];
  reviewFacets: ReviewFacet[];
}

export type LessonDifficulty =
  | "JLPT-N5"
  | "JLPT-N4"
  | "JLPT-N3"
  | "JLPT-N2"
  | "JLPT-N1";

export interface QuestionItem {
  id: string;
  kuId: string;
  data: {
    context?: string;
    question: string;
    answer: string;
    acceptedAlternatives?: string[];
    difficulty: LessonDifficulty;
  };
  rank: number;        // 0–100, starts at 50; suitable threshold is 30
  rejectionCount: number; // tracked for observability; not used for ranking
  createdAt: string | Timestamp;
  /** @deprecated */
  userId?: string;
  /** @deprecated */
  status?: "active" | "flagged" | "inactive";
  /** @deprecated */
  lastUsed?: string | Timestamp;
  /** @deprecated */
  previousAnswers?: {
    answer: string;
    result: "pass" | "fail";
    timestamp: Timestamp;
  }[];
}

export interface UserQuestionState {
  questionId: string;
  kuId: string;
  rejected: boolean;       // user will never see this question again
  consecutiveFailures: number; // resets on correct answer; 3+ triggers rotation
}

// ─── Feed Engine Types ────────────────────────────────────────────────

export type FeedItemType = 'review' | 'learn' | 'leech-repair';

/**
 * A single item in the user's daily feed queue.
 * Stored in `users/{uid}/feed` subcollection.
 */
export interface FeedItem {
  id: string;
  type: FeedItemType;
  /** The review-facet ID (for reviews) or global KU ID (for learn/leech items). */
  targetId: string;
  /** The KU ID — always present for cross-referencing. */
  kuId: string;
  /** Denormalized content string for display (e.g., "食べる"). */
  kuContent: string;
  /** The KU type (Vocab, Kanji, etc.). */
  kuType: KnowledgeUnitType;
  /** Lower = higher priority. 1 = review, 2 = leech-repair, 3 = learn. */
  priority: number;
  status: 'pending' | 'completed' | 'skipped';
  addedAt: Timestamp;
  completedAt?: Timestamp;
}

/**
 * Summary returned by the feed generation endpoint.
 */
export interface FeedQueueSummary {
  success: boolean;
  uid: string;
  added: {
    reviews: number;
    leeches: number;
    learns: number;
  };
  totalPending: number;
  message: string;
}

export * from './scenario';
