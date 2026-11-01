import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
    FIRESTORE_CONNECTION,
    KNOWLEDGE_UNITS_COLLECTION,
    LESSONS_COLLECTION,
    QUESTIONS_COLLECTION,
    REVIEW_FACETS_COLLECTION,
    USER_KUS_SUBCOLLECTION,
    QUESTION_STATES_SUBCOLLECTION,
} from '../firebase/firebase.module';
import { Firestore, Timestamp, DocumentReference, FieldValue } from '@google-cloud/firestore';
import { Inject } from '@nestjs/common';
// Removed CURRENT_USER_ID import
import { KnowledgeUnit } from '@/types';
import { KnowledgeUnitType } from '@/types';
import { NotFoundException } from '@nestjs/common';
import { Query } from '@google-cloud/firestore';
import { GrammarNote } from '@/types/scenario';

@Injectable()
export class KnowledgeUnitsService {

    private readonly logger = new Logger(KnowledgeUnitsService.name);

    // In-memory cache backing search() — Firestore has no substring query, so
    // search fetches the whole collection and filters in memory. Loaded lazily
    // on first search (not at boot) and kept in sync by the single-item
    // mutations below; bulk/rare mutations just invalidate it wholesale rather
    // than patching precisely, since they're infrequent enough that paying for
    // one extra full reload on the next search is cheaper than the complexity.
    private searchCache: KnowledgeUnit[] | null = null;
    // In-flight load promise, so concurrent searches racing on a cold cache
    // share one Firestore fetch instead of each firing their own.
    private searchCacheLoading: Promise<KnowledgeUnit[]> | null = null;

    constructor(
        @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    ) { }

    private async ensureSearchCache(): Promise<KnowledgeUnit[]> {
        if (this.searchCache) return this.searchCache;
        if (this.searchCacheLoading) return this.searchCacheLoading;

        this.searchCacheLoading = (async () => {
            const snapshot = await this.db.collection(KNOWLEDGE_UNITS_COLLECTION).get();
            const loaded = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    createdAt: typeof data.createdAt?.toDate === 'function'
                        ? data.createdAt.toDate().toISOString()
                        : data.createdAt,
                } as unknown as KnowledgeUnit;
            });
            this.searchCache = loaded;
            this.logger.log(`Search cache loaded: ${loaded.length} KUs`);
            return loaded;
        })();

        try {
            return await this.searchCacheLoading;
        } finally {
            this.searchCacheLoading = null;
        }
    }

    /** Current KUs for the given ids from the in-memory cache (no Firestore reads). Unknown ids are skipped. */
    async getManyCached(ids: string[]): Promise<KnowledgeUnit[]> {
        if (ids.length === 0) return [];
        const want = new Set(ids);
        return (await this.ensureSearchCache()).filter(k => want.has(k.id));
    }

    private invalidateSearchCache(): void {
        this.searchCache = null;
    }

    private upsertSearchCacheEntry(ku: KnowledgeUnit): void {
        if (!this.searchCache) return; // not warmed yet — next search will load fresh
        const i = this.searchCache.findIndex(k => k.id === ku.id);
        if (i >= 0) this.searchCache[i] = ku;
        else this.searchCache.push(ku);
    }

    private removeSearchCacheEntry(id: string): void {
        if (!this.searchCache) return;
        this.searchCache = this.searchCache.filter(k => k.id !== id);
    }

    async findAll({ status, type, content, jlptLevel }: { status?: string, type?: string, content?: string[], jlptLevel?: string }) {
        try {
            let query: Query = this.db.collection(KNOWLEDGE_UNITS_COLLECTION) as unknown as Query;

            if (status) {
                query = query.where("status", "==", status);
            }

            if (type) {
                query = query.where("type", "==", type);
            }

            if (content) {
                query = query.where("content", "in", content);
            }

            if (jlptLevel) {
                query = query.where("data.jlptLevel", "==", jlptLevel);
            }

            const snapshot = await query.orderBy("createdAt", "desc").limit(300).get();

            if (snapshot.empty) {
                return [];
            }

            const kus: KnowledgeUnit[] = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                kus.push({
                    id: doc.id,
                    ...data,
                    createdAt: typeof data.createdAt?.toDate === 'function'
                        ? data.createdAt.toDate().toISOString()
                        : data.createdAt,
                } as unknown as KnowledgeUnit);
            });

            return kus;
        } catch (error) {
            this.logger.error("Failed to get knowledge units", error);
            throw error;
        }
    }

    async findByContent(content: string, type: KnowledgeUnitType): Promise<KnowledgeUnit | null> {
        const snapshot = await this.db
            .collection(KNOWLEDGE_UNITS_COLLECTION)
            .where('type', '==', type)
            .where('content', '==', content)
            .limit(1)
            .get();

        if (snapshot.empty) return null;

        const doc = snapshot.docs[0];
        const data = doc.data();
        return {
            id: doc.id,
            ...data,
            createdAt: typeof data.createdAt?.toDate === 'function'
                ? data.createdAt.toDate().toISOString()
                : data.createdAt,
        } as unknown as KnowledgeUnit;
    }

    async search(query: string, type?: string, jlptLevel?: string): Promise<KnowledgeUnit[]> {
        // Firestore has no native substring/contains query, only prefix-range
        // tricks \u2014 which miss anything the query isn't the literal start of
        // (e.g. searching "\u306a" wouldn't find "Present form of \u3044 and \u306a
        // adjectives"). The corpus is currently a few thousand docs, small
        // enough to filter in memory \u2014 cached in searchCache (see
        // ensureSearchCache) rather than re-fetched every call, since a fresh
        // full collection read per search doesn't scale on read cost/latency.
        // Revisit with a real search index (see feature backlog) if/when the
        // corpus outgrows this.
        //
        // type/jlptLevel are applied here, before the result cap below \u2014 a
        // common query character (\u306a: 85 hits) can otherwise bury a relevant
        // result under more common ones from a type the caller didn't want,
        // in a way no amount of post-hoc client-side filtering can recover.
        const cache = await this.ensureSearchCache();
        const q = query.toLowerCase();

        const matches = cache
            .filter(ku => ku.content?.toLowerCase()?.includes(q))
            .filter(ku => !type || ku.type === type)
            .filter(ku => !jlptLevel || (ku.data as any)?.jlptLevel === jlptLevel);

        // Rank prefix matches above mid-string matches. (A length-based
        // secondary sort was tried and dropped — this corpus mixes bare
        // Japanese patterns like "～ながら" with English-titled Grammar KUs
        // like "Present form of い and な adjectives", and comparing them by
        // character count just penalizes the English ones, which isn't a
        // real relevance signal.)
        matches.sort((a, b) => {
            const aPrefix = a.content.toLowerCase().startsWith(q) ? 0 : 1;
            const bPrefix = b.content.toLowerCase().startsWith(q) ? 0 : 1;
            return aPrefix - bPrefix;
        });

        return matches.slice(0, 75);
    }

    async findByKanjiComponent(kanjiChar: string): Promise<KnowledgeUnit[]> {
        const snapshot = await this.db.collection(KNOWLEDGE_UNITS_COLLECTION)
            .where('type', '==', 'Vocab')
            .get();

        const matches: KnowledgeUnit[] = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.content && data.content.includes(kanjiChar)) {
                // Rehydrate logic...
                matches.push({ id: doc.id, ...data } as unknown as KnowledgeUnit);
            }
        });

        return matches;
    }

    async ensureKanjiStub(char: string, metadata: any): Promise<string> {
        const existing = await this.findByContent(char, 'Kanji');

        if (existing) {
            return existing.id;
        }

        const newRef = this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc();
        await newRef.set({
            content: char,
            type: 'Kanji',
            data: {
                meaning: metadata?.meaning || '...',
                onyomi: metadata?.onyomi || [],
                kunyomi: metadata?.kunyomi || [],
            },
            createdAt: Timestamp.now(),
            relatedUnits: [],
        });

        return newRef.id;
    }

    async ensureVocab(content: string, hint?: { reading?: string; definition?: string; jlptLevel?: string }): Promise<string> {
        const existing = await this.findByContent(content, 'Vocab');

        if (existing) {
            return existing.id;
        }

        const newRef = this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc();
        await newRef.set({
            content,
            type: 'Vocab',
            data: {
                reading: hint?.reading ?? '',
                definition: hint?.definition ?? '',
                ...(hint?.jlptLevel ? { jlptLevel: hint.jlptLevel } : {}),
            },
            status: 'learning',
            createdAt: Timestamp.now(),
            relatedUnits: [],
        });

        return newRef.id;
    }

    async update(id: string, updates: Partial<any>) {
        const ref = this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(id);

        const doc = await ref.get();
        if (!doc.exists) {
            throw new NotFoundException(`Knowledge Unit ${id} not found`);
        }

        await ref.update(updates);

        const existing = doc.data()!;
        this.upsertSearchCacheEntry({
            id,
            ...existing,
            ...updates,
            createdAt: typeof existing.createdAt?.toDate === 'function'
                ? existing.createdAt.toDate().toISOString()
                : existing.createdAt,
        } as unknown as KnowledgeUnit);

        return { id, ...updates };
    }

    async create(body: any) {
        if (!body.type || !body.content) {
            this.logger.warn("POST /knowledge-units - Validation failed", body);
            throw new BadRequestException("Type and Content are required");
        }

        const newKuData = {
            ...body,
            relatedUnits: body.relatedUnits || [],
            data: body.data || {},
            createdAt: Timestamp.now(),
            status: "learning",
        };
        delete newKuData.userId; // KUs are global; no user ownership

        const newDocRef = await this.db
            .collection(KNOWLEDGE_UNITS_COLLECTION)
            .add(newKuData);

        this.upsertSearchCacheEntry({
            id: newDocRef.id,
            ...newKuData,
            createdAt: newKuData.createdAt.toDate().toISOString(),
        } as unknown as KnowledgeUnit);

        this.logger.log(`POST /knowledge-units - Created unit ${newDocRef.id}`);
        return { id: newDocRef.id };
    }

    async bulkUpdate(items: Partial<KnowledgeUnit>[]): Promise<{ updated: number; skipped: number; ids: string[] }> {
        if (!Array.isArray(items) || items.length === 0) {
            throw new BadRequestException('items must be a non-empty array');
        }

        const IMMUTABLE = new Set(['id', 'createdAt']);

        const toUpdate: { ref: DocumentReference; data: Record<string, any> }[] = [];
        let skipped = 0;

        for (const item of items) {
            if (!item.id) {
                this.logger.warn('bulkUpdate - skipping item missing id', item);
                skipped++;
                continue;
            }
            const payload: Record<string, any> = {};
            for (const [k, v] of Object.entries(item)) {
                if (!IMMUTABLE.has(k)) payload[k] = v;
            }
            if (Object.keys(payload).length === 0) {
                skipped++;
                continue;
            }
            toUpdate.push({
                ref: this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(item.id),
                data: payload,
            });
        }

        const BATCH_SIZE = 500;
        const updatedIds: string[] = [];

        for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
            const chunk = toUpdate.slice(i, i + BATCH_SIZE);
            const batch = this.db.batch();
            for (const { ref, data } of chunk) {
                // merge: true patches without overwriting unmentioned fields
                batch.set(ref, data, { merge: true });
                updatedIds.push(ref.id);
            }
            await batch.commit();
        }

        this.invalidateSearchCache();
        this.logger.log(`bulkUpdate - updated ${updatedIds.length}, skipped ${skipped}`);
        return { updated: updatedIds.length, skipped, ids: updatedIds };
    }

    async bulkIngest(items: Partial<KnowledgeUnit>[]): Promise<{ created: number; skipped: number; ids: string[] }> {
        if (!Array.isArray(items) || items.length === 0) {
            throw new BadRequestException('items must be a non-empty array');
        }

        // Dedup against the full global corpus by content+type
        const existingSnapshot = await this.db
            .collection(KNOWLEDGE_UNITS_COLLECTION)
            .select('content', 'type')
            .get();

        const existingKeys = new Set<string>();
        existingSnapshot.forEach(doc => {
            const d = doc.data();
            if (d.content && d.type) {
                existingKeys.add(`${d.type}::${d.content}`);
            }
        });

        const toCreate: { ref: DocumentReference; data: Record<string, any> }[] = [];
        let skipped = 0;

        for (const item of items) {
            if (!item.content || !item.type) {
                this.logger.warn('bulkIngest - skipping item missing content or type', item);
                skipped++;
                continue;
            }
            const key = `${item.type}::${item.content}`;
            if (existingKeys.has(key)) {
                skipped++;
                continue;
            }
            existingKeys.add(key); // prevent dupes within the same request
            const ref = item.id
                ? this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(item.id)
                : this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc();
            toCreate.push({
                ref,
                data: {
                    content: item.content,
                    type: item.type,
                    data: item.data || {},
                    relatedUnits: item.relatedUnits || [],
                    status: 'learning',
                    createdAt: Timestamp.now(),
                },
            });
        }

        // Firestore batch limit is 500 writes per commit
        const BATCH_SIZE = 500;
        const createdIds: string[] = [];

        for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
            const chunk = toCreate.slice(i, i + BATCH_SIZE);
            const batch = this.db.batch();
            for (const { ref, data } of chunk) {
                batch.set(ref, data);
                createdIds.push(ref.id);
            }
            await batch.commit();
        }

        this.invalidateSearchCache();
        this.logger.log(`bulkIngest - created ${createdIds.length}, skipped ${skipped}`);
        return { created: createdIds.length, skipped, ids: createdIds };
    }

    async findOneById(id: string): Promise<KnowledgeUnit | null> {
        const doc = await this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(id).get();
        if (!doc.exists) return null;
        const data = doc.data()!;
        return {
            id: doc.id,
            ...data,
            createdAt: typeof data.createdAt?.toDate === 'function'
                ? data.createdAt.toDate().toISOString()
                : data.createdAt,
        } as unknown as KnowledgeUnit;
    }

    async ensureGrammarKU(note: GrammarNote): Promise<string | null> {
        const content = note.pattern ?? note.title;

        // Exact match first
        const existing = await this.findByContent(content, 'Grammar');
        if (existing) return existing.id;

        // Prefix search fallback — handles minor AI wording variations
        const prefixSnap = await this.db.collection(KNOWLEDGE_UNITS_COLLECTION)
            .where('type', '==', 'Grammar')
            .where('content', '>=', content)
            .where('content', '<=', content + '')
            .limit(1)
            .get();

        if (!prefixSnap.empty) {
            const matched = prefixSnap.docs[0];
            this.logger.log(`Grammar KU fuzzy-matched "${content}" → "${matched.data().content}"`);
            return matched.id;
        }

        this.logger.warn(`Grammar KU not found in pool for pattern "${content}" — skipping creation`);
        return null;
    }

    async findOne(id: string): Promise<KnowledgeUnit> {
        const ku = await this.findOneById(id);
        if (!ku) throw new NotFoundException(`Knowledge Unit ${id} not found`);
        return ku;
    }

    async cascadeDelete(uid: string, kuId: string): Promise<{ deleted: Record<string, number> }> {
        const userRef = this.db.collection('users').doc(uid);
        const deleted: Record<string, number> = {};

        const deleteSubcollectionDocs = async (subcollection: string, field: string) => {
            const snap = await userRef.collection(subcollection).where(field, '==', kuId).get();
            if (snap.empty) return 0;
            const batch = this.db.batch();
            snap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            return snap.size;
        };

        deleted['review-facets'] = await deleteSubcollectionDocs(REVIEW_FACETS_COLLECTION, 'kuId');
        deleted['user-kus'] = await deleteSubcollectionDocs(USER_KUS_SUBCOLLECTION, 'kuId');
        deleted['feed'] = await deleteSubcollectionDocs('feed', 'kuId');

        // Global: questions (and their per-user question-states)
        const questionsSnap = await this.db.collection(QUESTIONS_COLLECTION).where('kuId', '==', kuId).get();
        if (!questionsSnap.empty) {
            // Delete question-states for each question
            const stateSnap = await userRef.collection(QUESTION_STATES_SUBCOLLECTION)
                .where('kuId', '==', kuId).get();
            const batch = this.db.batch();
            questionsSnap.docs.forEach(d => batch.delete(d.ref));
            stateSnap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            deleted['questions'] = questionsSnap.size;
            deleted['question-states'] = stateSnap.size;
        }

        // Global: lesson doc (keyed by kuId)
        const lessonRef = this.db.collection(LESSONS_COLLECTION).doc(kuId);
        const lessonSnap = await lessonRef.get();
        if (lessonSnap.exists) {
            await lessonRef.delete();
            deleted['lessons'] = 1;
        }

        // Global: KU itself
        await this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(kuId).delete();
        this.removeSearchCacheEntry(kuId);
        deleted['knowledge-units'] = 1;

        this.logger.log(`Cascade deleted KU ${kuId} for user ${uid}: ${JSON.stringify(deleted)}`);
        return { deleted };
    }

    async migrateGrammarJlptLevel(): Promise<{ migrated: number; skipped: number }> {
        // Grammar KUs imported from corpus have jlptLevel at top level.
        // This migrates them to data.jlptLevel to be consistent with Vocab/Kanji.
        const snap = await this.db
            .collection(KNOWLEDGE_UNITS_COLLECTION)
            .where('type', '==', 'Grammar')
            .get();

        let migrated = 0;
        let skipped = 0;
        const BATCH_SIZE = 500;

        const toMigrate = snap.docs.filter(doc => {
            const d = doc.data();
            return d.jlptLevel && !d.data?.jlptLevel;
        });

        for (let i = 0; i < toMigrate.length; i += BATCH_SIZE) {
            const chunk = toMigrate.slice(i, i + BATCH_SIZE);
            const batch = this.db.batch();
            for (const doc of chunk) {
                const jlptLevel = doc.data().jlptLevel;
                batch.update(doc.ref, {
                    'data.jlptLevel': jlptLevel,
                    jlptLevel: FieldValue.delete(),
                });
            }
            await batch.commit();
            migrated += chunk.length;
        }

        skipped = snap.size - migrated;
        this.invalidateSearchCache();
        this.logger.log(`migrateGrammarJlptLevel: migrated=${migrated}, skipped=${skipped}`);
        return { migrated, skipped };
    }

    async migrateGrammarExplanationToCorpusNotes(): Promise<{ migrated: number; skipped: number }> {
        const snap = await this.db
            .collection(KNOWLEDGE_UNITS_COLLECTION)
            .where('type', '==', 'Grammar')
            .get();

        const toMigrate = snap.docs.filter(doc => {
            const d = doc.data();
            return d.data?.explanation !== undefined;
        });

        const BATCH_SIZE = 500;
        let migrated = 0;

        for (let i = 0; i < toMigrate.length; i += BATCH_SIZE) {
            const chunk = toMigrate.slice(i, i + BATCH_SIZE);
            const batch = this.db.batch();
            for (const doc of chunk) {
                const explanation = doc.data().data?.explanation;
                batch.update(doc.ref, {
                    'data.corpusNotes': explanation,
                    'data.explanation': FieldValue.delete(),
                });
            }
            await batch.commit();
            migrated += chunk.length;
        }

        const skipped = snap.size - migrated;
        this.invalidateSearchCache();
        this.logger.log(`migrateGrammarExplanationToCorpusNotes: migrated=${migrated}, skipped=${skipped}`);
        return { migrated, skipped };
    }
}
