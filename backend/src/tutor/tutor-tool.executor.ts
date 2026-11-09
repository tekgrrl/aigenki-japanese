import { Injectable, Inject, Logger } from '@nestjs/common';
import { StatsService } from '../stats/stats.service';
import { Firestore } from 'firebase-admin/firestore';
import {
  FIRESTORE_CONNECTION,
  KNOWLEDGE_UNITS_COLLECTION,
  LESSONS_COLLECTION,
} from '../firebase/firebase.module';
import { AiToolCall } from './providers/ai-provider.interface';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { ScenariosService } from '../scenarios/scenarios.service';
import { getLevelSeed } from './level-seed.data';
import { FacetType, Lesson, UserRoot } from '../types';
import { dropStrayComponentKanji } from '../lessons/lessons.service';
import { FacetStore } from '../facets/facet-store';
import { jlptLevelOf } from '../users/user.service';

/** Items below this SRS stage still need review: scenario candidates (the user's rule, 2026-11-04). */
const REVIEW_CANDIDATE_STAGE = 3;
const REVIEW_CANDIDATE_LIMIT = 20;

@Injectable()
export class TutorToolExecutor {
  private readonly logger = new Logger(TutorToolExecutor.name);

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly facetStore: FacetStore,
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
    private readonly scenariosService: ScenariosService,
    private readonly statsService: StatsService,
  ) {}

  async execute(
    uid: string,
    call: AiToolCall,
    cache: Map<string, unknown>,
  ): Promise<unknown> {
    const cacheKey = `${call.name}:${stableKey(call.args)}`;
    if (cache.has(cacheKey)) {
      this.logger.debug(`cache hit: ${cacheKey}`);
      return cache.get(cacheKey);
    }
    const result = await this.dispatch(uid, call, cache);
    cache.set(cacheKey, result);
    return result;
  }

  private async dispatch(
    uid: string,
    call: AiToolCall,
    cache: Map<string, unknown>,
  ): Promise<unknown> {
    this.logger.log(`tool: ${call.name}`);
    switch (call.name) {
      case 'get_user_profile':
        return this.getUserProfile(uid, cache);
      case 'get_frontier_vocab':
        return this.getFrontierVocab(uid, call.args.facetTypes as FacetType[] | undefined, cache);
      case 'get_leech_vocab':
        return this.getLeechVocab(uid, call.args.facetTypes as FacetType[] | undefined, cache);
      case 'get_review_candidates':
        return this.getReviewCandidates(uid);
      case 'get_allowed_grammar':
        return this.getAllowedGrammar(uid, cache);
      case 'get_weak_grammar':
        return this.getWeakGrammar(uid, cache);
      case 'get_curriculum_node':
        return this.getCurriculumNode(uid, cache);
      case 'get_knowledge_unit':
        return this.getKnowledgeUnit(call.args.kuId as string);
      case 'search_knowledge_units':
        return this.searchKnowledgeUnits(call.args);
      case 'get_level_seed':
        return getLevelSeed(call.args.jlptLevel as string);
      case 'get_grammar_patterns':
        return this.scenariosService.getGrammarPatterns(uid, call.args.jlptLevel as string);
      case 'create_scenario':
        return this.scenariosService.saveFromTutor(uid, call.args);
      default:
        this.logger.warn(`unknown tool: ${call.name}`);
        return { error: `Unknown tool: ${call.name}` };
    }
  }

  // User doc is cached across all tutor tools in a single turn
  private async getUserDoc(
    uid: string,
    cache: Map<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const key = `_user_doc:${uid}`;
    if (cache.has(key)) return cache.get(key) as Record<string, unknown>;
    const snap = await this.db.collection('users').doc(uid).get();
    const doc = (snap.data() ?? {}) as Record<string, unknown>;
    cache.set(key, doc);
    return doc;
  }

  private async getUserProfile(
    uid: string,
    cache: Map<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const doc = await this.getUserDoc(uid, cache);
    const prefs = (doc.preferences ?? {}) as Record<string, unknown>;
    const ctx = (doc.tutorContext ?? {}) as Record<string, unknown>;
    return {
      jlptLevel: jlptLevelOf(doc as Pick<UserRoot, 'preferences'>),
      communicationStyle: ctx.communicationStyle ?? 'balanced',
      preferredUserRole: prefs.preferredUserRole ?? null,
    };
  }

  private async getFrontierVocab(
    uid: string,
    facetTypes: FacetType[] | undefined,
    cache: Map<string, unknown>,
  ): Promise<unknown[]> {
    const doc = await this.getUserDoc(uid, cache);
    const ctx = (doc.tutorContext ?? {}) as Record<string, unknown>;
    let entries = (ctx.frontierVocab ?? []) as any[];
    if (facetTypes?.length) {
      entries = entries.filter((e: any) =>
        e.facetTypes?.some((ft: string) => facetTypes.includes(ft as FacetType)),
      );
    }
    return entries;
  }

  /**
   * Enrolled Vocab and Grammar whose lowest facet is below REVIEW_CANDIDATE_STAGE, weakest
   * first, capped. Audio-first words (picture-choice facets) are left out: scenarios show text.
   */
  private async getReviewCandidates(uid: string): Promise<{ kuId: string; content: string; type: string; minSrsStage: number }[]> {
    const facets = this.facetStore.query(uid);
    const minStage = new Map<string, number>();
    const audioFirst = new Set<string>();
    (await facets.select('kuId', 'srsStage', 'facetType', 'sourceCollection').get()).docs.forEach(d => {
      const f = d.data();
      if (!f.kuId || f.facetType === 'flash' || f.sourceCollection === 'scenarios' || f.sourceCollection === 'concepts') return;
      if (f.facetType === 'picture-choice') audioFirst.add(f.kuId);
      const stage = (f.srsStage as number) ?? 0;
      minStage.set(f.kuId, Math.min(minStage.get(f.kuId) ?? Infinity, stage));
    });
    const weak = [...minStage.entries()]
      .filter(([kuId, stage]) => stage < REVIEW_CANDIDATE_STAGE && !audioFirst.has(kuId))
      .sort((a, b) => a[1] - b[1]);
    if (weak.length === 0) return [];
    const kuCol = this.db.collection(KNOWLEDGE_UNITS_COLLECTION);
    const out: { kuId: string; content: string; type: string; minSrsStage: number }[] = [];
    for (let i = 0; i < weak.length && out.length < REVIEW_CANDIDATE_LIMIT; i += 50) {
      const chunk = weak.slice(i, i + 50);
      const docs = await this.db.getAll(...chunk.map(([kuId]) => kuCol.doc(kuId)));
      docs.forEach((d, n) => {
        const type = d.data()?.type;
        if (d.exists && (type === 'Vocab' || type === 'Grammar')) {
          out.push({ kuId: d.id, content: d.data()!.content as string, type, minSrsStage: chunk[n][1] });
        }
      });
    }
    return out.slice(0, REVIEW_CANDIDATE_LIMIT);
  }

  private async getLeechVocab(
    uid: string,
    facetTypes: FacetType[] | undefined,
    cache: Map<string, unknown>,
  ): Promise<unknown[]> {
    const doc = await this.getUserDoc(uid, cache);
    const ctx = (doc.tutorContext ?? {}) as Record<string, unknown>;
    let entries = (ctx.leechVocab ?? []) as any[];
    if (facetTypes?.length) {
      entries = entries.filter((e: any) =>
        e.facetTypes?.some((ft: string) => facetTypes.includes(ft as FacetType)),
      );
    }
    return entries;
  }

  private async getAllowedGrammar(
    uid: string,
    cache: Map<string, unknown>,
  ): Promise<string[]> {
    const doc = await this.getUserDoc(uid, cache);
    // Resolved from enrolled KU ids at call time — always current content + title.
    return this.statsService.getAllowedGrammar(uid, doc as Record<string, any>);
  }

  private async getWeakGrammar(
    uid: string,
    cache: Map<string, unknown>,
  ): Promise<unknown[]> {
    const doc = await this.getUserDoc(uid, cache);
    const ctx = (doc.tutorContext ?? {}) as Record<string, unknown>;
    return (ctx.weakGrammarPoints ?? []) as unknown[];
  }

  private async getCurriculumNode(
    uid: string,
    cache: Map<string, unknown>,
  ): Promise<string> {
    const doc = await this.getUserDoc(uid, cache);
    const ctx = (doc.tutorContext ?? {}) as Record<string, unknown>;
    return (ctx.currentCurriculumNode as string) ?? 'N5.basics';
  }

  private async getKnowledgeUnit(kuId: string): Promise<unknown> {
    const [kuSnap, lessonSnap] = await Promise.all([
      this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(kuId).get(),
      this.db.collection(LESSONS_COLLECTION).doc(kuId).get(),
    ]);
    if (!kuSnap.exists) return { error: `KnowledgeUnit ${kuId} not found` };
    return {
      ku: { id: kuId, ...kuSnap.data() },
      lesson: lessonSnap.exists ? dropStrayComponentKanji(lessonSnap.data() as Lesson) : null,
    };
  }

  private async searchKnowledgeUnits(
    args: Record<string, unknown>,
  ): Promise<unknown[]> {
    const { type, jlptLevel, theme } = args;
    const kus = await this.knowledgeUnitsService.findAll({
      type: type as string | undefined,
    });
    let results = kus as any[];
    if (jlptLevel) {
      results = results.filter(ku => ku.jlptLevel === jlptLevel);
    }
    if (theme) {
      const t = (theme as string).toLowerCase();
      results = results.filter(
        ku =>
          ku.content?.toLowerCase().includes(t) ||
          ku.description?.toLowerCase().includes(t),
      );
    }
    return results.slice(0, 20).map(ku => ({
      id: ku.id,
      type: ku.type,
      content: ku.content,
      jlptLevel: ku.jlptLevel ?? null,
    }));
  }
}

function stableKey(args: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(args).sort()));
}
