import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION, USER_KUS_SUBCOLLECTION } from '../firebase/firebase.module';
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
        @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    ) {
        this.rapidApiKey = this.configService.get<string>('RAPIDAPI_KEY') || '';
    }

    /**
     * Up to `limit` words that use a kanji, shown on its reviews so the learner can see why
     * it's there: the word that introduced it (fromKuId) first, then the user's other
     * enrolled words, then other words (lowest JLPT level first).
     */
    async getWordsUsing(
        uid: string,
        kanjiChar: string,
        fromKuId?: string,
        limit = 3,
    ): Promise<{ kuId: string; content: string; meaning: string }[]> {
        // Stub KUs (created by a flag/scenario, no lesson yet) have no definition: skip them.
        const meaningOf = (w: KnowledgeUnit) =>
            String((w.data as { definition?: string }).definition ?? '').split(/[;,]/)[0].trim();
        const words = (await this.knowledgeUnitsService.findByKanjiComponent(kanjiChar))
            .filter(w => w.content !== kanjiChar && meaningOf(w) !== '');
        if (words.length === 0) return [];

        const enrolled = new Set<string>();
        const ids = words.map(w => w.id);
        const chunks = Array.from({ length: Math.ceil(ids.length / 30) }, (_, i) => ids.slice(i * 30, i * 30 + 30));
        const snaps = await Promise.all(chunks.map(chunk =>
            this.db.collection('users').doc(uid).collection(USER_KUS_SUBCOLLECTION)
                .where('kuId', 'in', chunk).select('kuId').get()));
        snaps.forEach(snap => snap.docs.forEach(d => enrolled.add(d.data().kuId)));

        const level = (w: KnowledgeUnit) => {
            const m = /N(\d)/.exec(String((w.data as { jlptLevel?: string }).jlptLevel ?? ''));
            return m ? -Number(m[1]) : 0; // N5 (-5) sorts before N1 (-1); unlevelled last
        };
        const rank = (w: KnowledgeUnit) => (w.id === fromKuId ? 0 : enrolled.has(w.id) ? 1 : 2);
        return words
            .sort((a, b) => rank(a) - rank(b) || level(a) - level(b) || a.content.length - b.content.length)
            .slice(0, limit)
            .map(w => ({
                kuId: w.id,
                content: w.content,
                meaning: meaningOf(w), // first sense only: "cold; common cold" → "cold"
            }));
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

            // Real example words from Kanji Alive — absent on the Gemini fallback path
            // (its schema doesn't request them), so default to empty.
            exampleWords: (apiData.examples ?? []).slice(0, 6).map((ex: any) => ({
                japanese: ex.japanese,
                meaning: ex.meaning?.english ?? '',
                audioUrl: ex.audio?.mp3,
            })),

            // Map DB results to the simplified context shape
            relatedVocab: relatedVocab.map(ku => ({
                id: ku.id,
                content: ku.content,
                reading: ku.type === 'Vocab' ? (ku.data.reading ?? '') : '',
            }))
        };
    }

    /** Kanji Alive's English meanings per kanji; a kanji Kanji Alive doesn't know caches as []. */
    private readonly kanjiAliveMeanings = new Map<string, string[]>();

    /**
     * Kanji Alive's English meanings for a kanji (e.g. 会 → ["meet", "society"]) — the
     * meanings the Kanji lesson shows. Kanji-Component-Meaning facets carry the gloss of the
     * word that introduced the kanji instead, so answer checking accepts both. Never throws
     * and never falls back to Gemini: on failure the facet's own meanings still apply.
     */
    async getKanjiAliveMeanings(kanji: string): Promise<string[]> {
        const cached = this.kanjiAliveMeanings.get(kanji);
        if (cached) return cached;
        try {
            const data = await this.fetchKanjiAliveData(kanji);
            const english: string = data?.kanji?.meaning?.english ?? '';
            const meanings = english.split(',').map(s => s.trim()).filter(Boolean);
            this.kanjiAliveMeanings.set(kanji, meanings);
            return meanings;
        } catch (error) {
            this.logger.warn(`getKanjiAliveMeanings: no Kanji Alive meanings for ${kanji}: ${(error as Error)?.message}`);
            return [];
        }
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