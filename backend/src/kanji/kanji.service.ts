import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { KanjiLesson, KnowledgeUnit } from '@/types'; // Adjust path to your shared types  
import { GeminiService } from '../gemini/gemini.service';

@Injectable()
export class KanjiService {
    private readonly logger = new Logger(KanjiService.name);
    private readonly rapidApiKey: string;
    private readonly rapidApiHost = 'kanjialive-api.p.rapidapi.com';

    constructor(
        private configService: ConfigService,
        private knowledgeUnitsService: KnowledgeUnitsService,
        private geminiService: GeminiService,
    ) {
        this.rapidApiKey = this.configService.get<string>('RAPIDAPI_KEY') || '';
    }

    async getKanjiDetails(uid: string, kanjiChar: string, kuId?: string): Promise<KanjiLesson> {
        // 1. Fetch Deterministic Data (Kanji Alive via RapidAPI)
        let apiData = await this.fetchKanjiAliveData(kanjiChar);

        if (apiData.error === "No kanji found.") {
            // fallback to Gemini
            this.logger.log(`Gemini fallback for kanji ${kanjiChar}`);
            apiData = await this.geminiService.generateKanjiDetails(kanjiChar);
        }

        this.logger.log(`apiData = ${JSON.stringify(apiData)}`);

        // 2. Fetch Contextual Data (Related Vocab from DB)
        const relatedVocab = await this.knowledgeUnitsService.findByKanjiComponent(kanjiChar);

        // 3. Assemble the KanjiLesson Object
        return {
            kuId,
            type: 'Kanji',
            kanji: kanjiChar,
            meaning: apiData.kanji.meaning.english,

            // Flatten API readings
            kunyomi: apiData.kanji.kunyomi.hiragana.split('、'),
            onyomi: apiData.kanji.onyomi.katakana.split('、'),

            // Visuals
            strokeCount: apiData.kanji.strokes.count,
            strokeImages: apiData.kanji.strokes.images,

            // Radical
            radical: {
                character: apiData.radical.character,
                meaning: apiData.radical.meaning.english,
                image: apiData.radical.image,
                animation: apiData.radical.animation,
            },

            references: {
                grade: apiData.references?.grade,
                kodansha: apiData.references?.kodansha,
                classic_nelson: apiData.references?.classic_nelson,
            },

            mnemonic_meaning: '', // TODO: Fetch from AI or DB?
            mnemonic_reading: '', // TODO: Fetch from AI or DB?

            // Map DB results to the simplified context shape
            relatedVocab: relatedVocab.map(ku => ({
                id: ku.id,
                content: ku.content,
                reading: ku.type === 'Vocab' ? (ku.data.reading ?? '') : '',
            }))
        };
    }

    private async fetchKanjiAliveData(kanji: string) {
        if (!this.rapidApiKey) {
            throw new Error('RAPIDAPI_KEY is not defined');
        }

        this.logger.log(`Fetching kanji data for ${kanji}`);
        const url = `https://${this.rapidApiHost}/api/public/kanji/${encodeURIComponent(kanji)}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'X-RapidAPI-Key': this.rapidApiKey,
                    'X-RapidAPI-Host': this.rapidApiHost,
                },
            });

            if (!response.ok) {
                this.logger.error(`Kanji Alive API Error: ${response.statusText}`);
                throw new NotFoundException(`Data not found for kanji: ${kanji}`);
            }

            const data = await response.json();
            console.log(`data = ${JSON.stringify(data)}`);

            return data;
        } catch (error) {
            this.logger.error(`Failed to fetch kanji data for ${kanji}`, error);
            throw error;
        }
    }
}