
import { Injectable, Inject, Logger } from '@nestjs/common';
import type { ITtsProvider } from './audio.interface';
import { GoogleTtsService } from './google-tts.service';
import { GeminiService } from '../gemini/gemini.service';
import { PronounceDto } from './dto/pronounce.dto';
import { validateSegments, punctuationSplit, buildPacedSsml } from './ssml.util';

const DEFAULT_PAUSE_MS = 400;

export interface PronounceResult {
    audio: Buffer;
    voiceUsed: string;
    segmentation: 'gemini' | 'punctuation' | 'none';
}

@Injectable()
export class AudioService {
    private readonly logger = new Logger(AudioService.name);

    constructor(
        @Inject('ITtsProvider') private readonly ttsProvider: ITtsProvider,
        private readonly googleTtsService: GoogleTtsService,
        private readonly geminiService: GeminiService,
    ) { }

    /** `voice`: a scenario speaker's chosen voice (validated by the controller); the app's voice when absent. */
    async getAudioStream(text: string, voice?: string): Promise<Buffer> {
        this.logger.log(`Generating audio for text: "${text.substring(0, 50)}..."`);
        try {
            return await this.ttsProvider.generateAudio(text, voice);
        } catch (error) {
            this.logger.error('Failed to generate audio stream', error);
            throw error;
        }
    }

    /**
     * Standalone pronunciation-practice tool. Deliberately independent of
     * `getAudioStream`/`generateAudio` above — nothing here can regress the
     * 3 existing app callers of `/audio/speak`.
     */
    async pronounce(dto: PronounceDto): Promise<PronounceResult> {
        if (dto.mode === 'clear') {
            const { audio, voiceUsed } = await this.googleTtsService.synthesize(
                { text: dto.text },
                { voiceName: dto.voice },
            );
            return { audio, voiceUsed, segmentation: 'none' };
        }

        const pauseMs = dto.pauseMs ?? DEFAULT_PAUSE_MS;
        let segments: string[] | null = null;
        let segmentation: PronounceResult['segmentation'] = 'punctuation';

        try {
            const geminiSegments = await this.geminiService.segmentJapaneseSentence(dto.text);
            if (validateSegments(dto.text, geminiSegments)) {
                segments = geminiSegments;
                segmentation = 'gemini';
            } else {
                this.logger.warn(`pronounce: Gemini segmentation failed to reconstruct original text, falling back to punctuation split`);
            }
        } catch (error) {
            this.logger.warn('pronounce: Gemini segmentation call failed, falling back to punctuation split', error);
        }

        if (!segments) {
            segments = punctuationSplit(dto.text);
        }

        const ssml = buildPacedSsml(segments, pauseMs);
        const { audio, voiceUsed } = await this.googleTtsService.synthesize(
            { ssml },
            { voiceName: dto.voice },
        );
        return { audio, voiceUsed, segmentation };
    }
}
