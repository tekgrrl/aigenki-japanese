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
    rawText?: string;
    parsedJson?: any;
    toolCalls?: Array<{ fn: string; args: Record<string, unknown>; response: Record<string, unknown> }>;
    costUsd?: number;
  };
  errorData?: {
    message?: string;
    stack?: string;
    rawError?: string; // For non-Error objects
  };
}

export interface PromotedEntry {
  kuId: string;
  content: string;
  type: string;
  srsStage: number;
  promotedAt: Timestamp;
}

/**
 * A dismissible "practice this in a Scenario" opportunity, recorded when a KU's
 * facet crosses into a new SRS level (Sumi-suri -> Kaisho -> Gyosho -> Sosho -> Mushin).
 * Purely a suggestion — never read by SRS/facet logic, only surfaced in the daily plan.
 */
export interface ScenarioOpportunity {
  kuId: string;
  content: string;
  type: string; // KU type: 'Vocab' | 'Grammar' | 'Concept' | 'Kanji'
  newLevel: string; // e.g. "Kaisho" — from lib/srs-levels.ts getSrsLevelName
  createdAt: Timestamp;
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
  /** Response-only (GET /users/me, never stored): the level the user counts as, 'N5' until they choose one. */
  effectiveJlptLevel?: 'N5' | 'N4' | 'N3' | 'N2' | 'N1';
  /** Response-only (GET /users/me): a level has been chosen. Until then the app is limited to /profile. */
  profileComplete?: boolean;
  /** The level the last successful level sync applied to aboveLevel / allowed grammar (LevelSyncService). */
  aboveLevelComputedFor?: 'N5' | 'N4' | 'N3' | 'N2' | 'N1';

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
    recentlyPromoted?: PromotedEntry[];
    scenarioOpportunities?: ScenarioOpportunity[];

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

    /**
     * @deprecated Text snapshot taken at enrollment; goes stale when KUs are renamed. Still
     * appended but no longer read — use allowedGrammarKuIds via TutorContextService.getAllowedGrammar().
     */
    allowedGrammar: string[];

    /** Enrolled (at-or-below-level) Grammar KU ids the AI may use; text is resolved from the current KUs at read time. */
    allowedGrammarKuIds?: string[];

    /**
     * Vocab the user explicitly said they don't want to learn right now ("Not now" on a
     * flagged word). Must never be used as incidental/filler content in lessons, reviews,
     * or scenarios — forward-only: does not retroactively touch already-generated content.
     */
    excludedVocab?: string[];

    /** Same as excludedVocab, but for grammar patterns explicitly declined via the same flag flow. */
    excludedGrammar?: string[];

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

  /** YYYY-MM-DD of the last day the daily plan was generated; used to gate first-dashboard-visit trigger. */
  lastDailyPlanDate?: string;

  /** Top-level user-facing preferences stored directly on the UserRoot document. */
  preferences?: {
    showFurigana?: boolean;
    /** User's current JLPT study level — used as default difficulty for generated scenarios. */
    jlptLevel?: 'N5' | 'N4' | 'N3' | 'N2' | 'N1';
    /** Default user persona in roleplay scenarios (e.g. "Traveler", "Student"). */
    preferredUserRole?: string;
    /** Experiment: new Vocab with approved pictures is learned audio-first (picture cards). */
    audioFirstExperiment?: boolean;
  };
}

export interface LessonValidation {
  status: 'pending' | 'pass' | 'fail';
  checkedAt?: Timestamp;
  violations?: Array<{ segment: string; detectedLevel: string; type: 'vocab' | 'grammar' }>;
}

/**
 * One usage (sense) of a Vocab word. `id` is stable once written; `label` is display text and
 * may be edited. `meaning` is the literal answer a learner would type; `acceptedAnswers` grows
 * as the AI accepts other answers for this usage.
 */
export interface VocabUsage {
  id: string;
  label: string;
  meaning: string;
  acceptedAnswers: string[];
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
  /** `usage`: short label for the usage/sense the example shows (same label = same usage). Absent on older lessons until labelled. `usageId`: the VocabUsage it shows. */
  context_examples?: { sentence: string; translation: string; usage?: string; usageId?: string }[];
  /** The word's usages, built from its examples and definitions. Absent until built: see usagesOf(). */
  usages?: VocabUsage[];
  /** Definitions no example shows, so they aren't usages (shown to the admin). */
  usageSetAside?: string[];
  /** Fingerprint of the examples whose usage build was rejected; lazy builds skip them until the examples change. */
  usageBuildRejected?: string;
  validation?: LessonValidation;
  /** When true, component_kanji must be empty — this word is never taught/queued with its kanji breakdown, regardless of how it's stored. Set by the AI at generation time or curated manually via the admin editor; enforced app-side, not just prompted for. */
  kanaOnly?: boolean;
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

  // Real example words showing the kanji in use (From API)
  exampleWords?: {
    japanese: string;
    meaning: string;
    audioUrl?: string;
  }[];

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
  formation: string | string[];
  notes: string;         // nuance, pitfalls
  validation?: LessonValidation;
  examples: {
    japanese: string;
    english: string;
    context?: string;    // e.g. "convenience store" — for future facet targeting
    fragments: string[];
    accepted_alternatives: string[];
    /**
     * Standalone, dictionary-form vocab words in this sentence worth flagging via
     * the "I don't know this" long-press (issue #222) — excludes the grammar
     * pattern being taught and proper nouns. Independent of `fragments`: a
     * fragment may bundle a term with a particle (e.g. "医者に"), so the frontend
     * matches a fragment's text against these terms rather than assuming 1:1.
     */
    learnableTerms?: { term: string; surfaceForm: string; reading: string; meaning: string }[];
    /**
     * `japanese` with furigana markup (食[た]べます), for display only — fragments and
     * alternatives keep using `japanese`. Backfilled lazily (POST /lessons/:kuId/furigana);
     * absent on lessons not yet shown.
     */
    furigana?: string;
    /**
     * Indices into `fragments` hand-marked as the grammar pattern this example teaches (the
     * pieces that become blanks; see lib/sentence-assembly.ts). The lesson editor clears them when
     * the sentence or fragments are edited; saving drops marks that can't build a card. Other writers
     * that change fragments (scripts, regeneration) must clear them too.
     */
    patternFragments?: number[];
  }[];
}

export interface UserGrammarLesson {
  id: string;
  kuId: string;
  lessonId: string;      // = kuId (Grammar lessons stored at lessons/{kuId})
  sourceType: 'scenario' | 'concept' | 'scenario-live';
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
    /** Distinct kanji in content, in order (lib/kanji-chars kanjiIn) — "words using 食" is one array-contains query. */
    kanji?: string[];
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

export interface GrammarKnowledgeUnit extends KnowledgeUnitBase {
  type: "Grammar";
  data: {
    title: string;
    corpusNotes?: string;
    jlptLevel?: string | null;
    classification?: GrammarClassification;
    /** Hand-set in admin: this grammar point gets a scenario chain (Flash cards) when it reaches SRS stage 3. Absent = no scenario. */
    scenarioReady?: boolean;
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
  createdAt: Timestamp;
  status: "learning" | "reviewing" | "mastered";
  facet_count: number;
  history?: any[];
  source?: {
    type: 'scenario' | 'lesson' | 'flag';
    id: string;
  };
  /** Current position in the facet unlock sequence. 0 = not yet initialized. */
  currentStage?: number;
  /** True if ku.data.jlptLevel > user.preferences.jlptLevel at enrollment time. Above-level items are excluded from ambient generation context. */
  aboveLevel?: boolean;
  /** Which sequence this KU follows; absent = the default for its type. Fixed at enrollment. */
  sequenceVariant?: SequenceVariant;
}

// ─── Facet sequence types ────────────────────────────────────────────────────

export interface FacetStageEntry {
  type: FacetType;
  /** Where the facet data comes from. 'kanji-components' produces one facet per component. */
  source: 'primary' | 'kanji-components' | 'examples';
}

export interface FacetStageDefinition {
  stage: number;
  facets: FacetStageEntry[];
  /** All facets in this stage must reach this SRS stage before the next stage unlocks. null = terminal. */
  unlockAtSrsStage: number | null;
}

export interface KuFacetSequence {
  kuType: string;
  /** Alternative sequence for the same KU type (e.g. the audio-first experiment). Absent = the default. */
  variant?: SequenceVariant;
  stages: FacetStageDefinition[];
}

/** Experimental audio-first Vocab: picture + sound, no kanji/kana (#246). */
export type SequenceVariant = 'audio-first';

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
  | "sentence-cloze"
  | "picture-choice" // hear the word, pick its picture from four (audio-first)
  | "flash"; // one-and-done task card (e.g. a scenario step); never goes through SRS

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
  /** Consecutive failures on this facet (resets on pass). Used for leech detection. */
  consecutiveFailures?: number;
  /** @deprecated - failure tracking moved to UserQuestionState.consecutiveFailures */
  questionAttempts?: number;
  /** Which stage in the KU's facet unlock sequence this facet belongs to. */
  sequenceStage?: number;
  /**
   * Set when an admin reset or the audio-first switch handed this kanji-component facet to another
   * word (source.id): the word it came from. The new owner's stage logic ignores it (see
   * ReviewProgressService.getSequenceFacets); it's still reviewed and counts for the kanji.
   */
  rehomedFrom?: string;
  /** Vocab meaning card: the usages proven correct at the current SRS stage (cleared when it moves up). */
  provenUsageIds?: string[];
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
  sourceCollection?: 'knowledge-units' | 'concepts' | 'scenarios';
  data: {
    context?: string;
    question: string;
    answer: string;
    acceptedAlternatives?: string[];
    difficulty: LessonDifficulty;
  };
  /** Vocab: the usage this question tests (a VocabLesson usage id). Absent on older questions. */
  usageId?: string;
  /**
   * Which kind of question the prompt asked for: a key of VOCAB_, NOUN_, GRAMMAR_ or
   * CONCEPT_QUESTION_OPTIONS (e.g. 'error-correction'). Absent on questions made before
   * 2026-11-11; the admin page guesses those from the text (lib/question-kind.ts).
   */
  kind?: string;
  /** When the admin marked it reviewed on the Questions page (cleared when unmarked). */
  reviewedAt?: string | Timestamp;
  rank: number;        // 0–100, starts at 50; suitable threshold is 30
  rejectionCount: number; // tracked for observability; not used for ranking
  createdAt: string | Timestamp;
}

export interface UserQuestionState {
  questionId: string;
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

// ─── Grammar Classification ─────────────────────────────────────────

/**
 * How a grammar item is produced by the learner.
 * Determines pedagogical treatment and question generation strategy.
 */
export type GrammarProductionType =
  | 'compositional'   // Constructed from rules and parts (e.g., te-form, particles)
  | 'constructional'; // Retrieved as a unit with slots (e.g., 〜なければならない)

/**
 * Structural classification — what kind of grammar machinery this is.
 * Used by the system to determine question types, conjugation behavior,
 * and confusable-pairing logic.
 */
export type GrammarStructuralCategory =
  // Compositional
  | 'inflectional'       // Verb/adj/copula conjugations
  | 'particle'           // Single-morpheme function words
  | 'syntactic'          // Clause/phrase combination rules
  | 'derivational'       // Word-formation patterns (お〜, 〜的, compound verbs)
  | 'numerical'          // Counters and numerical expressions
  // Constructional
  | 'modal'              // Speaker stance/attitude (obligation, permission, desire)
  | 'aspectual'          // Event phases beyond simple tense
  | 'discourse'          // Inter-clause logical relations
  | 'comparative'        // Comparison, degree, scope
  | 'speech-act'         // Conventional communicative actions
  | 'honorific'          // Keigo register marking
  | 'pragmatic';         // Sentence-final particles, interactional glue

/**
 * Expressive classification — what the learner uses this grammar to do.
 * Drives lesson grouping, confusable detection within communicative functions,
 * and the "unlock by communicative achievement" mechanic.
 */
export type ExpressiveDomain =
  | 'describing-the-world'
  | 'expressing-the-mind'
  | 'acting-in-the-world'
  | 'connecting-ideas'
  | 'managing-conversation';

export type ExpressiveFunction =
  // Describing the world
  | 'describing-things'
  | 'describing-events'
  | 'describing-states-changes'
  | 'quantifying'
  | 'comparing'
  // Expressing the mind
  | 'expressing-desires-intentions'
  | 'expressing-opinions'
  | 'expressing-certainty'
  | 'expressing-feelings'
  | 'expressing-experience'
  // Acting in the world
  | 'making-requests'
  | 'permission'
  | 'obligation-necessity'
  | 'offering-accepting'
  | 'social-rituals'
  // Connecting ideas
  | 'reasoning-explanation'
  | 'conditioning-hypothesizing'
  | 'concession-contrast'
  | 'sequencing-timing'
  | 'reporting-quoting'
  // Managing conversation
  | 'asking-questions'
  | 'topic-management'
  | 'softening-emphasizing'
  | 'showing-politeness'
  | 'showing-closeness';

/**
 * Maps each ExpressiveFunction to its parent ExpressiveDomain.
 * Centralizing this avoids drift between the two type unions.
 */
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

/**
 * The full classification block for a grammar item.
 * Extends GrammarKnowledgeUnit.data and GrammarLesson.
 */
export interface GrammarClassification {
  productionType: GrammarProductionType;
  structuralCategory: GrammarStructuralCategory;

  /**
   * Expressive functions this grammar realizes. Most items have one primary
   * function; some serve multiple (e.g., 〜のだ does explanation AND emphasis).
   * The first entry is treated as the primary function for lesson grouping.
   */
  expressiveFunctions: ExpressiveFunction[];

  /**
   * Optional: specific patterns this is commonly confused with.
   * Stored as kuIds. Used by question generation to produce discrimination
   * questions and by SRS to schedule contrasting reviews.
   */
  confusableWith?: string[];
}

// ─── Content validation ───────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  violations: Array<{ segment: string; detectedLevel: string; type: 'vocab' | 'grammar' }>;
}

export interface ContentFlag {
  id?: string;
  kuId?: string;
  sourceType: 'lesson' | 'facet' | 'scenario';
  sourceId: string;
  /** Owning user of a scenario-sourced flag — scenarios live in a per-user
   *  subcollection, so regenerating one needs to know whose. Not set for
   *  lesson-sourced flags (lessons are global, not per-user). */
  userId?: string;
  kuContent: string;
  userLevel: string;
  violations: Array<{ segment: string; detectedLevel: string; type: 'vocab' | 'grammar' }>;
  status: 'open' | 'resolved' | 'dismissed';
  /** Set when the flag was created manually rather than by the automated validator. */
  manualNote?: string;
  /** Manual flags: the exact sentence/part of the content being reported (picked in the lesson UI). */
  quotedSegment?: string;
  /** Manual flags: quick category picked in the lesson UI (e.g. "Above level"). */
  category?: string;
  dismissNote?: string;
  resolvedAt?: Timestamp;
  createdAt: Timestamp;
}

// ── Pictures: documents in the global `pictures` collection ─────────────────
// Image files live on local disk (PICTURES_DIR); these docs hold their metadata.

export type PictureStatus = 'approved' | 'needs-review' | 'rejected' | 'unpicturable';

/**
 * Named render presets. `card`: the square picture card (cream paper, optional cast).
 * `scene`: a wide establishing scene (e.g. a scenario's setting), with a soft full
 * background. Both are text-free.
 */
export type PictureStyle = 'card' | 'scene';

/** What the image model is asked to draw. */
export interface PictureBrief {
  picturable: boolean;
  includeCast: boolean;
  /** "none", or at most two simple meaning-carrying background elements. */
  background: string;
  scene: string;
  /** Why it can't be drawn, when picturable is false (from the brief step or the admin). */
  reason?: string;
}

/** One automatic check of a rendered image for leaked text. */
export interface PictureTextCheck {
  hasText: boolean;
  where: string;
}

/**
 * What a picture is OF.
 * - 'ku-usage': one usage (sense) of a Vocab word — the picture cards.
 * - 'ku': a whole KU or Concept (never a Kanji).
 * - 'none': a free-standing asset, not attached to anything yet.
 */
export type PictureSubjectKind = 'ku-usage' | 'ku' | 'none';
export const SUBJECT_KINDS: PictureSubjectKind[] = ['ku-usage', 'ku', 'none'];

export interface PictureSubject {
  kind: PictureSubjectKind;
  /** Absent for 'none'. */
  kuId?: string;
  /** 'ku-usage' only. */
  usage?: string;
}

/** What a picture was generated from — kept so a redraw uses the same usage. */
export interface PictureSource {
  usage: string;
  definition: string;
  sentence: string;
  translation: string;
}

/** A `pictures` document exactly as stored (the id is the doc id, not a field). */
export interface PictureDoc {
  /** The subject's KU (or Concept) id; null for a free-standing ('none') picture. */
  kuId: string | null;
  /** Absent on docs written before subjects existed: those are 'ku-usage' (see subjectOf). */
  subject?: PictureSubject;
  /** The subject's word / KU content, or a free-standing picture's description. */
  content: string;
  reading: string;
  /** The usage label for 'ku-usage'; "" otherwise. */
  usage: string;
  source: PictureSource;
  status: PictureStatus;
  /** Absent = generated. Only 'uploaded' is ever written. */
  origin?: 'generated' | 'uploaded';
  /** Absent = 'card'. Only 'scene' is ever written. */
  style?: PictureStyle;
  /** The editor's note the brief was last drafted with, or an upload's description. */
  note?: string;
  /** Absent on uploads. */
  brief?: PictureBrief;
  /** File name inside PICTURES_DIR; absent for unpicturable pictures. */
  file?: string;
  /** Empty on uploads. */
  attempts: PictureTextCheck[];
  createdAt: Timestamp;
}

/** A picture as the service returns it. */
export type Picture = PictureDoc & { id: string };

/** A picture in the admin list (computed, never stored). */
export type AdminPicture = Picture & {
  /** An uploaded usage picture whose usage no longer exists in the lesson. */
  staleUsage?: boolean;
};

/** Where one of a Vocab word's usages stands in the picture flow (computed, never stored). */
export type UsageState = 'none' | 'waiting' | 'bound';

/** A Vocab word's usages and their picture states, for the Add a Picture flow. */
export interface UsageStates {
  kuId: string;
  content: string;
  reading: string;
  /** False when some examples have no usage label: the word then counts as one usage. */
  labelled: boolean;
  usages: {
    usage: string;
    sentence: string;
    translation: string;
    /** bound: an approved picture; waiting: one in Needs Review / Unpicturable, or being drawn. */
    state: UsageState;
    /** The bound and waiting pictures. */
    pictureIds: string[];
    /** The same pictures, for a preview (no file when unpicturable). */
    pictures: { id: string; status: PictureStatus; file?: string }[];
    /** A picture for this usage is being drawn right now. */
    drawing: boolean;
    /** How many rejected pictures this usage has (they don't count). */
    rejected: number;
  }[];
}

export * from './scenario';
export * from './grammar-section';
