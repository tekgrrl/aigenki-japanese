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

    /** Set to true when all linked vocab KUs have minSrsStage >= VOCAB_READY_MIN_STAGE (3), Key Grammar included. Written by ReviewOutcomeService.onGraded after a review. Used for dashboard queries. */
    vocabReady?: boolean;
}

/**
 * A shared scenario in the pre-created pool (`scenario-pool/{id}`): content only, no progress.
 * Learners start it into their own scenario doc; see scenarios/pool.ts for how the two combine.
 */
export type PoolScenario = Pick<Scenario,
    'title' | 'description' | 'difficultyLevel' | 'setting' | 'roles' | 'dialogue' | 'extractedKUs' | 'grammarMatches' | 'grammarNotes'
> & {
    id: string;
    /** The admin's scenario it was published from. */
    publishedFrom: { uid: string; scenarioId: string };
    createdAt: Timestamp;
};

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
