import { Injectable, Inject, Logger } from '@nestjs/common';
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
import { FacetType } from '../types';

@Injectable()
export class TutorToolExecutor {
  private readonly logger = new Logger(TutorToolExecutor.name);

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
    private readonly scenariosService: ScenariosService,
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
      jlptLevel: prefs.jlptLevel ?? 'N5',
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
    const ctx = (doc.tutorContext ?? {}) as Record<string, unknown>;
    return (ctx.allowedGrammar ?? []) as string[];
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
      lesson: lessonSnap.exists ? lessonSnap.data() : null,
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
