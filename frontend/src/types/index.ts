import { Timestamp } from "firebase/firestore";

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
  isAdmin?: boolean;

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
    weakGrammarPoints: string[];

    /** The user's identified conversational tendency, signaling how the AI should prompt for polite vs. casual context. */
    communicationStyle: "too_formal" | "too_casual" | "balanced" | "hesitant";

    /** Nuance or meaning-related weaknesses (e.g., struggling to differentiate similar-meaning words). */
    semanticWeaknesses: string[];

    /** Topics or themes the user brings up frequently or has shown interest in. */
    suggestedThemes: string[];
  };

  preferences?: {
    showFurigana?: boolean;
  };
}

export interface VocabLesson {
  kuId?: string;
  type: "Vocab";
  vocab: string;
  reading: string;
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
  };

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

export interface GlobalVocabLesson {
  type: "Vocab";
  vocab: string;
  reading: string;
  definitions: string[];
  definition?: string;
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

export interface GlobalKanjiLesson {
  type: "Kanji";
  kanji: string;
  meaning: string;
  onyomi: string[];
  kunyomi: string[];
  strokeCount: number;
  strokeImages: string[];
  radical?: {
    character: string;
    meaning: string;
    image: string;
    animation?: string[];
  };
  references?: {
    grade: number;
    kodansha: number;
    classic_nelson: number;
  };
  mnemonic_meaning: string;
  mnemonic_reading: string;
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
  type: "Grammar";
  pattern: string;
  title: string;
  jlptLevel: string;
  meaning: string;
  formation: string | string[];
  notes: string;
  examples: {
    japanese: string;
    english: string;
    context?: string;
    fragments: string[];
    accepted_alternatives: string[];
  }[];
}

export interface UserGrammarLesson {
  id: string;
  kuId: string;
  lessonId: string;
  sourceType: "scenario" | "concept";
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

export type Lesson =
  | VocabLesson
  | KanjiLesson
  | GrammarLesson
  | GlobalVocabLesson
  | GlobalKanjiLesson;

export type KnowledgeUnitType =
  | "Vocab"
  | "Kanji"
  | "Grammar"
  | "Concept"
  | "ExampleSentence";

// ─── KnowledgeUnit discriminated union ───────────────────────────────────────

/** Fields shared by every KU sub-type. */
export interface KnowledgeUnitBase {
  id: string;
  content: string; // The main "thing" (e.g., "食べる", "家族")
  relatedUnits: string[]; // Array of other KnowledgeUnit IDs
  createdAt: Timestamp;
  data: Record<string, any>;
}

export interface VocabKnowledgeUnit extends KnowledgeUnitBase {
  type: "Vocab";
  data: {
    reading?: string;
    definition?: string;
    conjugationType?: 'godan' | 'ichidan' | 'irregular';
    jlptLevel?: string | null;
    wanikaniLevel?: number | null;
    corpusNotes?: string;
    [key: string]: any;
  };
}

export interface KanjiKnowledgeUnit extends KnowledgeUnitBase {
  type: "Kanji";
  data: {
    meaning?: string;
    jlptLevel?: string | null;
    wanikaniLevel?: number | null;
    corpusNotes?: string;
    [key: string]: any;
  };
}

// ─── Grammar Classification ───────────────────────────────────────────────────

export type GrammarProductionType = 'compositional' | 'constructional';

export type GrammarStructuralCategory =
  | 'inflectional' | 'particle' | 'syntactic' | 'derivational' | 'numerical'
  | 'modal' | 'aspectual' | 'discourse' | 'comparative' | 'speech-act'
  | 'honorific' | 'pragmatic';

export type ExpressiveDomain =
  | 'describing-the-world' | 'expressing-the-mind' | 'acting-in-the-world'
  | 'connecting-ideas' | 'managing-conversation';

export type ExpressiveFunction =
  | 'describing-things' | 'describing-events' | 'describing-states-changes'
  | 'quantifying' | 'comparing'
  | 'expressing-desires-intentions' | 'expressing-opinions' | 'expressing-certainty'
  | 'expressing-feelings' | 'expressing-experience'
  | 'making-requests' | 'permission' | 'obligation-necessity'
  | 'offering-accepting' | 'social-rituals'
  | 'reasoning-explanation' | 'conditioning-hypothesizing' | 'concession-contrast'
  | 'sequencing-timing' | 'reporting-quoting'
  | 'asking-questions' | 'topic-management' | 'softening-emphasizing'
  | 'showing-politeness' | 'showing-closeness';

export const EXPRESSIVE_FUNCTION_TO_DOMAIN: Record<ExpressiveFunction, ExpressiveDomain> = {
  'describing-things': 'describing-the-world',
  'describing-events': 'describing-the-world',
  'describing-states-changes': 'describing-the-world',
  'quantifying': 'describing-the-world',
  'comparing': 'describing-the-world',
  'expressing-desires-intentions': 'expressing-the-mind',
  'expressing-opinions': 'expressing-the-mind',
  'expressing-certainty': 'expressing-the-mind',
  'expressing-feelings': 'expressing-the-mind',
  'expressing-experience': 'expressing-the-mind',
  'making-requests': 'acting-in-the-world',
  'permission': 'acting-in-the-world',
  'obligation-necessity': 'acting-in-the-world',
  'offering-accepting': 'acting-in-the-world',
  'social-rituals': 'acting-in-the-world',
  'reasoning-explanation': 'connecting-ideas',
  'conditioning-hypothesizing': 'connecting-ideas',
  'concession-contrast': 'connecting-ideas',
  'sequencing-timing': 'connecting-ideas',
  'reporting-quoting': 'connecting-ideas',
  'asking-questions': 'managing-conversation',
  'topic-management': 'managing-conversation',
  'softening-emphasizing': 'managing-conversation',
  'showing-politeness': 'managing-conversation',
  'showing-closeness': 'managing-conversation',
};

export const EXPRESSIVE_FUNCTIONS_BY_DOMAIN: Record<ExpressiveDomain, ExpressiveFunction[]> = {
  'describing-the-world': ['describing-things', 'describing-events', 'describing-states-changes', 'quantifying', 'comparing'],
  'expressing-the-mind': ['expressing-desires-intentions', 'expressing-opinions', 'expressing-certainty', 'expressing-feelings', 'expressing-experience'],
  'acting-in-the-world': ['making-requests', 'permission', 'obligation-necessity', 'offering-accepting', 'social-rituals'],
  'connecting-ideas': ['reasoning-explanation', 'conditioning-hypothesizing', 'concession-contrast', 'sequencing-timing', 'reporting-quoting'],
  'managing-conversation': ['asking-questions', 'topic-management', 'softening-emphasizing', 'showing-politeness', 'showing-closeness'],
};

export interface GrammarClassification {
  productionType: GrammarProductionType;
  structuralCategory: GrammarStructuralCategory;
  expressiveFunctions: ExpressiveFunction[];
  confusableWith?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────

export interface GrammarKnowledgeUnit extends KnowledgeUnitBase {
  type: "Grammar";
  data: {
    title: string;
    corpusNotes?: string;
    jlptLevel?: string | null;
    classification?: GrammarClassification;
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
  | "conjunction"
  | "grammar"
  | "expression";

export interface GlobalKnowledgeUnit {
  id: string;
  type: KnowledgeUnitType;
  content: string;
  data: {
    reading?: string;
    definition?: string;
    meaning?: string;
    jlptLevel?: string | null;
    wanikaniLevel?: number | null;
    [key: string]: any;
  };
  relatedUnits: string[];
}

export interface UserKnowledgeUnit {
  id: string;
  userId: string;
  kuId: string; // Bridges to GlobalKnowledgeUnit.id
  createdAt: Timestamp;
  status: "learning" | "reviewing";
  facet_count: number;
  history?: any[];
  currentStage?: number;
}

export interface FacetStageEntry {
  type: FacetType;
  source: 'primary' | 'kanji-components' | 'examples';
}

export interface FacetStageDefinition {
  stage: number;
  facets: FacetStageEntry[];
  unlockAtSrsStage: number | null;
}

export interface KuFacetSequence {
  kuType: string;
  stages: FacetStageDefinition[];
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
  kuId: string;
  sourceCollection?: 'knowledge-units' | 'concepts' | 'scenarios';
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
  /** @deprecated - failure tracking moved to UserQuestionState.consecutiveFailures */
  questionAttempts?: number;
  sequenceStage?: number;
  data?: any;
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
  sourceCollection?: 'knowledge-units' | 'concepts' | 'scenarios';
  data: {
    context?: string;
    question: string;
    answer: string;
    acceptedAlternatives?: string[];
    difficulty: LessonDifficulty;
  };
  rank: number;
  rejectionCount: number;
  createdAt: string | Timestamp;
}

export interface UserQuestionState {
  questionId: string;
  rejected: boolean;
  consecutiveFailures: number;
}
