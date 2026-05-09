import { Controller, Get, Post, Query, Body, Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { ApilogService } from './apilog.service';
import { GeminiService } from '../gemini/gemini.service';
import { FIRESTORE_CONNECTION } from '../firebase/firebase.module';
import { GET_USER_LEVEL_DECLARATION, getCumulativeGrammar, JlptLevel } from '../prompts/curriculum';
import {
    buildVocabQuestionPrompt,
    buildNounParticleQuestionPrompt,
    buildConceptQuestionPrompt,
    VOCAB_QUESTION_OPTIONS,
    CONCEPT_QUESTION_OPTIONS,
} from '../prompts/quiz.prompts';

const QUESTION_RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        question: { type: 'STRING' },
        context: { type: 'STRING' },
        answer: { type: 'STRING' },
        accepted_alternatives: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['question', 'answer'],
};

const EXAMPLE_MECHANIC = {
    goalTitle: 'Connecting reasons with ので',
    englishIntent: 'Express a reason or cause naturally',
    rule: '[plain form] + ので + [result]',
    simpleExample: { japanese: '雨が降っているので、傘を持ってください。', english: 'Because it is raining, please take an umbrella.', highlight: 'ので' },
    naturalExample: {
        japanese: '明日は早いので、今日は早く寝ます。',
        english: 'Because I have an early start tomorrow, I will sleep early today.',
        highlight: 'ので',
        fragments: ['明日は早いので', '今日は早く寝ます'],
        accepted_alternatives: [],
    },
};

@Controller('apilogs')
export class ApilogController {
    constructor(
        private readonly apilogService: ApilogService,
        private readonly geminiService: GeminiService,
        @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    ) { }

    @Get()
    async getLogs(
        @Query('limit') limitArg: string,
        @Query('route') route?: string,
        @Query('status') status?: string,
    ) {
        const limit = parseInt(limitArg, 10) || 50;
        // Don't allow massive queries
        const safeLimit = Math.min(Math.max(limit, 1), 100);

        return this.apilogService.findAll(safeLimit, route, status);
    }

    @Get('latency')
    async getLatency(@Query('sample') sampleArg?: string) {
        const sample = Math.min(parseInt(sampleArg ?? '200', 10) || 200, 500);
        return this.apilogService.getLatencyStats(sample);
    }

    @Post('prompt-test')
    async runPromptTest(@Body() body: {
        systemPrompt: string;
        userMessage?: string;
        useTools?: boolean;
        uid?: string;
        responseSchema?: Record<string, unknown>;
        model?: string;
    }) {
        const { systemPrompt, userMessage = '', useTools = false, uid, responseSchema, model } = body;

        const toolDeclarations = useTools ? [GET_USER_LEVEL_DECLARATION] : [];
        const toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {};

        if (useTools) {
            toolHandlers.get_user_level = async () => {
                if (!uid) return { jlptLevel: 'N5', cumulativeGrammar: getCumulativeGrammar('N5') };
                const userDoc = await this.db.collection('users').doc(uid).get();
                const level = ((userDoc.data() as any)?.preferences?.jlptLevel ?? 'N5') as JlptLevel;
                return { jlptLevel: level, cumulativeGrammar: getCumulativeGrammar(level) };
            };
        }

        return this.geminiService.runPromptTest({
            systemPrompt,
            userMessage,
            toolDeclarations,
            toolHandlers,
            responseSchema,
            model,
        });
    }

    @Get('prompt-presets')
    getPromptPresets() {
        return [
            {
                id: 'vocab-conjugation',
                name: 'Vocab: Conjugation',
                systemPrompt: buildVocabQuestionPrompt('conjugation'),
                exampleUserMessage: 'Topic: 食べる\nReading: たべる\nMeaning: to eat',
                useTools: true,
                responseSchema: QUESTION_RESPONSE_SCHEMA,
                description: VOCAB_QUESTION_OPTIONS['conjugation'],
            },
            {
                id: 'vocab-translation',
                name: 'Vocab: Translation',
                systemPrompt: buildVocabQuestionPrompt('translation'),
                exampleUserMessage: 'Topic: 勉強する\nReading: べんきょうする\nMeaning: to study',
                useTools: true,
                responseSchema: QUESTION_RESPONSE_SCHEMA,
                description: VOCAB_QUESTION_OPTIONS['translation'],
            },
            {
                id: 'vocab-fill-in-the-blank',
                name: 'Vocab: Fill-in-the-Blank',
                systemPrompt: buildVocabQuestionPrompt('fill-in-the-blank'),
                exampleUserMessage: 'Topic: 図書館\nReading: としょかん\nMeaning: library',
                useTools: true,
                responseSchema: QUESTION_RESPONSE_SCHEMA,
                description: VOCAB_QUESTION_OPTIONS['fill-in-the-blank'],
            },
            {
                id: 'noun-particle',
                name: 'Noun: Particle Fill-in',
                systemPrompt: buildNounParticleQuestionPrompt(),
                exampleUserMessage: 'Topic: 駅\nReading: えき\nMeaning: train station',
                useTools: true,
                responseSchema: QUESTION_RESPONSE_SCHEMA,
                description: 'Noun + particle fill-in-the-blank (noun+particle blanked together)',
            },
            {
                id: 'concept-error-correction',
                name: 'Concept: Error Correction',
                systemPrompt: buildConceptQuestionPrompt(EXAMPLE_MECHANIC, 'error-correction'),
                exampleUserMessage: '',
                useTools: true,
                responseSchema: QUESTION_RESPONSE_SCHEMA,
                description: CONCEPT_QUESTION_OPTIONS['error-correction'],
            },
            {
                id: 'concept-novel-translation',
                name: 'Concept: Novel Translation',
                systemPrompt: buildConceptQuestionPrompt(EXAMPLE_MECHANIC, 'novel-translation'),
                exampleUserMessage: '',
                useTools: true,
                responseSchema: QUESTION_RESPONSE_SCHEMA,
                description: CONCEPT_QUESTION_OPTIONS['novel-translation'],
            },
        ];
    }
}
