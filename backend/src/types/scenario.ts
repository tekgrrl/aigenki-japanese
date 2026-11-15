import { Timestamp } from 'firebase-admin/firestore';
import { IsBoolean, IsOptional } from 'class-validator';

export type ScenarioDifficulty = 'N5' | 'N4' | 'N3' | 'N2' | 'N1';
export type ScenarioState = 'encounter' | 'drill' | 'simulate' | 'completed';

export interface ChatMessage {
    speaker: 'user' | 'ai';
    text: string;
    timestamp: number;
    correction?: string;
    sceneFinished?: boolean;
    roleName?: string;
}

export interface ScenarioDialogueLine {
    speaker: string;
    /** Unambiguous who's-speaking signal, independent of the free-text `speaker` label's language/wording. See GitHub #213. */
    speakerRole?: 'user' | 'ai';
    text: string;
    translation: string;
    audioUrl?: string;
}

export interface ExtractedKU {
    content: string;
    reading: string;
    meaning: string;
    type: 'vocab' | 'kanji';
    kuId?: string;
    status: 'new' | 'learning' | 'mastered';
    jlptLevel?: string;
}

export interface GrammarNote {
    pattern?: string;  // the extractable pattern, e.g. "～をお願いします"
    title: string;
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
    outcome: 'passed' | 'failed';
    recommendedAction: 'repeat_lesson' | 'replay_chat';
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
        /** The rendered scene (from visualPrompt), when the user has drawn one. */
        picture?: ScenarioPicture;
    };

    dialogue: ScenarioDialogueLine[];
    extractedKUs: ExtractedKU[];
    grammarNotes?: GrammarNote[];
    grammarMatches?: GrammarMatch[];

    /** Vocab mined from the user's OWN chatHistory turns at simulate->completed (not AI-scripted). Written by ScenariosService.extractLiveChatKnowledge. */
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
    /** Set with sourceType 'grammar-pattern' — references a GrammarSection, not a Grammar KU. */
    sourceSectionId?: string;
    isActive?: boolean;

    progress?: Record<string, LevelProgress>;
    currentLevelStatus?: ProgressStatus;

    /**
     * Set on a learner's copy of a pool scenario (doc id = pool id): the shared content comes from
     * `scenario-pool/{poolId}` and this doc holds the learner's progress (scenarios/pool.ts).
     */
    poolId?: string;
    /**
     * Other content words in the script (not Key Vocabulary). On a pool scenario: the list found at
     * publish. On a learner's doc: the linked copy, once they opted in at "Start Learning". Not part
     * of the Role Play gate.
     */
    secondaryKUs?: ExtractedKU[];
    /** Pool scenarios: the admin-written extension the simulation adds to the scenario (role play + evaluation). */
    simulationBrief?: string;

    /** Set to true when all linked vocab KUs have minSrsStage >= VOCAB_READY_MIN_STAGE (3), Key Grammar included. Written by ReviewOutcomeService.onGraded after a review. Used for dashboard queries. */
    vocabReady?: boolean;
}

/**
 * A shared scenario in the pre-created pool (`scenario-pool/{id}`): content only, no progress.
 * Learners start it into their own scenario doc; see scenarios/pool.ts for how the two combine.
 */
export type PoolScenario = Pick<Scenario,
    'title' | 'description' | 'difficultyLevel' | 'setting' | 'roles' | 'dialogue' | 'extractedKUs' | 'grammarMatches' | 'grammarNotes'
    | 'secondaryKUs' | 'simulationBrief'
> & {
    id: string;
    /** The scene's learning goals and allowed sets; the scenario is generated from these. */
    goals?: PoolGoals;
    /** When the dialogue etc. were generated (absent until the first learner starts it). */
    generatedAt?: Timestamp;
    /** Items taught before this scenario's phase: the generator may use them, but they aren't Key items. */
    allowed?: PhaseItemsRef;
    /** Free-text tags for choosing (e.g. traveller, resident). */
    situationTags?: string[];
    /** The Journey phase that owns this scenario's goals, brief and allowed items (edited in the planner). */
    phaseRef?: { journeyId: string; journeyTitle: string; phaseId: string; phaseTitle: string };
    /** The admin's scenario it was published from (absent when made in the pool editor). */
    publishedFrom?: { uid: string; scenarioId: string };
    createdAt: Timestamp;
};

/** Resolved Vocab and Grammar items (same shape as a Journey phase's). */
export interface PhaseItemsRef {
    vocab: { content: string; kuId: string }[];
    grammarKuIds: string[];
}

/** A pool scenario's learning goals: what its generated scenario may use and teaches. */
export interface PoolGoals {
    summary: string;
    /** Allowed / taught words, resolved to KUs when the admin saves (learners never create one). */
    vocab: { content: string; kuId: string }[];
    /** Allowed / taught grammar points (Grammar KU ids). */
    grammarKuIds: string[];
    /** Phrases the dialogue should use as they are. */
    setPhrases: string[];
}

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
    grammarNotes?: GrammarNote[];
    grammarMatches?: GrammarMatch[];
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

// FIX: DTOs must be Classes for NestJS reflection/validation to work
export class GenerateScenarioDto {
    difficulty?: ScenarioDifficulty;
    theme?: string;
    sourceType?: 'library' | 'custom' | 'context-example' | 'grammar-pattern';
    sourceContextSentence?: string;
    targetVocab?: string;
    sourceKuId?: string;
    /** Set with sourceType 'grammar-pattern' — references a GrammarSection, not a Grammar KU. See types/grammar-section.ts. */
    sourceSectionId?: string;
    userRole?: string;
    aiRole?: string;
}

export class ImportScenarioDto {
    conversationText!: string;
    userRole!: string;
    aiRole?: string;
    aiRoles?: string[];
    difficulty?: ScenarioDifficulty;
    sceneNotes?: string;
}

// FIX: DTOs must be Classes for NestJS reflection/validation to work
export class ChatTurnDto {
    userMessage!: string;
}

export class ResetSessionDto {
    @IsBoolean()
    @IsOptional()
    archive: boolean = false;
}
/** A scenario's rendered setting image. The file lives under PICTURES_DIR/scenarios/{uid}/. */
export interface ScenarioPicture {
    file: string;
    status: 'approved' | 'needs-review';
    attempts: { hasText: boolean; where: string }[];
    createdAt: Timestamp;
}
