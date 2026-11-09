import { Injectable, Inject, Logger } from '@nestjs/common';
import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { FacetType, TutorVocabEntry } from '../types';
import { FIRESTORE_CONNECTION, USER_KUS_SUBCOLLECTION } from '../firebase/firebase.module';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { isAboveLevel } from '../lib/jlpt';
import { UserService } from '../users/user.service';
import { enrolledKuId } from '../user-knowledge-units/enrolled-ku-id';

/**
 * The learner's tutor context (`users/{uid}.tutorContext`): what AI generation may use and
 * should focus on: frontier and leech vocab, allowed grammar, excluded items, weak grammar,
 * the current curriculum node.
 */
@Injectable()
export class TutorContextService {
    private readonly logger = new Logger(TutorContextService.name);

    constructor(
        @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
        private readonly knowledgeUnitsService: KnowledgeUnitsService,
        private readonly userService: UserService,
    ) { }

    /** Adds facetTypes to the word's frontierVocab entry (the entry is created if missing). */
    async addToFrontierVocab(uid: string, content: string, facetTypes: FacetType[]): Promise<void> {
        const userRef = this.db.collection('users').doc(uid);
        await this.db.runTransaction(async (transaction) => {
            const entries: TutorVocabEntry[] = (await transaction.get(userRef)).data()?.tutorContext?.frontierVocab ?? [];
            transaction.update(userRef, { 'tutorContext.frontierVocab': withFacetTypes(entries, content, facetTypes) });
        });
    }

    /** Drops the word's frontierVocab entry (every facet type). */
    async removeFromFrontierVocab(uid: string, content: string): Promise<void> {
        const userRef = this.db.collection('users').doc(uid);
        await this.db.runTransaction(async (transaction) => {
            const entries: TutorVocabEntry[] = (await transaction.get(userRef)).data()?.tutorContext?.frontierVocab ?? [];
            transaction.update(userRef, { 'tutorContext.frontierVocab': entries.filter(e => e.content !== content) });
        });
    }

    /** Drops a word from both frontierVocab and leechVocab (every facet type). */
    async removeFromTutorVocab(uid: string, content: string): Promise<void> {
        const userRef = this.db.collection('users').doc(uid);
        await this.db.runTransaction(async (transaction) => {
            const ctx = (await transaction.get(userRef)).data()?.tutorContext ?? {};
            const without = (entries: TutorVocabEntry[] = []) => entries.filter(e => e.content !== content);
            transaction.update(userRef, {
                'tutorContext.frontierVocab': without(ctx.frontierVocab),
                'tutorContext.leechVocab': without(ctx.leechVocab),
            });
        });
    }

    /**
     * After a review: a facet that became a leech ('add') or was passed after failures ('remove').
     * Updates leechVocab and, for a Grammar point, weakGrammarPoints, in one transaction.
     */
    async updateLeech(uid: string, content: string, facetType: FacetType, change: 'add' | 'remove', isGrammar: boolean): Promise<void> {
        const userRef = this.db.collection('users').doc(uid);
        const apply = (entries: TutorVocabEntry[] = []) =>
            change === 'add' ? withFacetTypes(entries, content, [facetType]) : withoutFacetType(entries, content, facetType);
        await this.db.runTransaction(async (transaction) => {
            const ctx = (await transaction.get(userRef)).data()?.tutorContext ?? {};
            transaction.update(userRef, {
                'tutorContext.leechVocab': apply(ctx.leechVocab),
                ...(isGrammar ? { 'tutorContext.weakGrammarPoints': apply(ctx.weakGrammarPoints) } : {}),
            });
        });
    }

    /**
     * Records an enrolled (at-or-below-level) Grammar KU as allowed for AI generation.
     * The KU id is the source of truth (`allowedGrammarKuIds`); text is resolved from the
     * current KU at read time by getAllowedGrammar(), so renames never go stale. The legacy
     * text snapshot (`allowedGrammar`) is still appended for now but no longer read.
     */
    async addToAllowedGrammar(uid: string, pattern: string, kuId: string): Promise<void> {
        // Make sure the id list exists (backfilled from user-kus) before appending to it,
        // otherwise the first arrayUnion would create a one-item list and skip the backfill.
        await this.getAllowedGrammarKuIds(uid);
        await this.db.collection('users').doc(uid).update({
            'tutorContext.allowedGrammarKuIds': FieldValue.arrayUnion(kuId),
            'tutorContext.allowedGrammar': FieldValue.arrayUnion(pattern),
        });
    }

    /**
     * The user's allowed grammar for AI generation, as current "content — title" strings
     * resolved from the in-memory KU cache. Deleted KUs simply drop out.
     */
    async getAllowedGrammar(uid: string, userData?: Record<string, any>): Promise<string[]> {
        const ids = await this.getAllowedGrammarKuIds(uid, userData);
        const kus = await this.knowledgeUnitsService.getManyCached(ids);
        return kus
            .filter(k => k.type === 'Grammar')
            .map(k => {
                const content = String(k.content ?? '').trim();
                const title = String((k.data as Record<string, any>)?.title ?? '').trim();
                return title && title !== content ? `${content} — ${title}` : content;
            });
    }

    private async getAllowedGrammarKuIds(uid: string, userData?: Record<string, any>): Promise<string[]> {
        const data = userData ?? (await this.db.collection('users').doc(uid).get()).data();
        const ids = data?.tutorContext?.allowedGrammarKuIds;
        if (Array.isArray(ids)) return ids as string[];
        return this.backfillAllowedGrammarKuIds(uid);
    }

    /**
     * The Grammar KU ids that belong in a user's allowed grammar: enrolled and not above their level.
     * `level`: the level to judge by (a level change passes the one it's applying); default the stored one.
     */
    private async selectAllowedGrammarKuIds(uid: string, level?: string): Promise<string[]> {
        const userRef = this.db.collection('users').doc(uid);
        const [userLevel, ukus] = await Promise.all([level ?? this.userService.getJlptLevel(uid), userRef.collection(USER_KUS_SUBCOLLECTION).get()]);
        const candidateIds = ukus.docs
            .filter(d => d.data().aboveLevel !== true)
            .map(enrolledKuId);
        // Re-check the level against the KU itself: legacy UKUs have no aboveLevel flag, and a
        // fresh enrolment's flag is written after the UKU, so the flag alone can let N3+ through.
        return (await this.knowledgeUnitsService.getManyCached(candidateIds))
            .filter(k => k.type === 'Grammar' && !isAboveLevel((k.data as Record<string, any>)?.jlptLevel, userLevel))
            .map(k => k.id);
    }

    /**
     * One-off per user: build the id list the first time it's read (see getAllowedGrammarKuIds).
     * The legacy text list can't be mapped back reliably after renames.
     */
    private async backfillAllowedGrammarKuIds(uid: string): Promise<string[]> {
        const userRef = this.db.collection('users').doc(uid);
        const grammarIds = await this.selectAllowedGrammarKuIds(uid);
        // arrayUnion, not a plain set: an enrolment's addToAllowedGrammar can land mid-backfill.
        // arrayUnion() with no elements throws, so with nothing to add just create the empty
        // list (only if still absent) so the backfill doesn't rerun on every call.
        if (grammarIds.length > 0) {
            await userRef.update({ 'tutorContext.allowedGrammarKuIds': FieldValue.arrayUnion(...grammarIds) });
        } else {
            await this.db.runTransaction(async tx => {
                const fresh = await tx.get(userRef);
                if (!Array.isArray(fresh.data()?.tutorContext?.allowedGrammarKuIds)) {
                    tx.update(userRef, { 'tutorContext.allowedGrammarKuIds': [] });
                }
            });
        }
        this.logger.log(`Backfilled allowedGrammarKuIds for ${uid}: ${grammarIds.length} grammar KUs`);
        return grammarIds;
    }

    /**
     * After the learner's level changes to `level` (and recomputeAboveLevel has run): updates the id list,
     * so grammar now above their level drops out and grammar now within it comes in.
     */
    async rebuildAllowedGrammarKuIds(uid: string, level: string): Promise<string[]> {
        const userRef = this.db.collection('users').doc(uid);
        const [grammarIds, userDoc] = await Promise.all([this.selectAllowedGrammarKuIds(uid, level), userRef.get()]);
        const current: string[] = userDoc.data()?.tutorContext?.allowedGrammarKuIds ?? [];
        const add = grammarIds.filter(id => !current.includes(id));
        const remove = current.filter(id => !grammarIds.includes(id));
        // arrayUnion / arrayRemove of just the difference, not a plain set: a grammar point enrolled
        // during the rebuild (addToAllowedGrammar) must not be overwritten. Each call needs elements.
        if (add.length > 0) await userRef.set({ tutorContext: { allowedGrammarKuIds: FieldValue.arrayUnion(...add) } }, { merge: true });
        if (remove.length > 0) await userRef.update({ 'tutorContext.allowedGrammarKuIds': FieldValue.arrayRemove(...remove) });
        this.logger.log(`Rebuilt allowedGrammarKuIds for ${uid}: ${grammarIds.length} grammar KUs (+${add.length} -${remove.length})`);
        return grammarIds;
    }

    async addToExcludedVocab(uid: string, content: string): Promise<void> {
        await this.db.collection('users').doc(uid).update({
            'tutorContext.excludedVocab': FieldValue.arrayUnion(content),
        });
    }

    async addToExcludedGrammar(uid: string, pattern: string): Promise<void> {
        await this.db.collection('users').doc(uid).update({
            'tutorContext.excludedGrammar': FieldValue.arrayUnion(pattern),
        });
    }

    async updateCurriculumNode(uid: string, jlptLevel: string): Promise<void> {
        await this.db.collection('users').doc(uid).update({
            'tutorContext.currentCurriculumNode': jlptLevel,
        });
    }
}

/** `entries` with facetTypes merged into the entry for `content` (added if missing). */
function withFacetTypes(entries: TutorVocabEntry[], content: string, facetTypes: FacetType[]): TutorVocabEntry[] {
    const out = [...entries];
    const idx = out.findIndex(e => e.content === content);
    if (idx >= 0) out[idx] = { content, facetTypes: Array.from(new Set([...out[idx].facetTypes, ...facetTypes])) };
    else out.push({ content, facetTypes });
    return out;
}

/** `entries` without `facetType` on the entry for `content` (the entry goes when none remain). */
function withoutFacetType(entries: TutorVocabEntry[], content: string, facetType: FacetType): TutorVocabEntry[] {
    return entries.flatMap(e => {
        if (e.content !== content) return [e];
        const remaining = e.facetTypes.filter(t => t !== facetType);
        return remaining.length > 0 ? [{ content, facetTypes: remaining }] : [];
    });
}
