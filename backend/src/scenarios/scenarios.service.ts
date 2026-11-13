import {
  Injectable,
  Logger,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as fs from 'fs';
import { Firestore, CollectionReference, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { Scenario, PoolScenario, GenerateScenarioDto, ImportScenarioDto, ScenarioState, ExtractedKU, ChatMessage, ScenarioAttempt, ProgressStatus, LevelProgress, Attempt, GrammarMatch } from '../types/scenario';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { UserService } from '../users/user.service';
import { FIRESTORE_CONNECTION, SCENARIOS_COLLECTION, SCENARIO_POOL_COLLECTION, KNOWLEDGE_UNITS_COLLECTION } from '../firebase/firebase.module';
import { mergePoolScenario, newLearnerDoc, poolContentOf } from './pool';
import { JLPT_LEVEL_ORDER, JlptLevel } from '../prompts/curriculum';
import { ADMIN_USER_ID } from '../lib/constants';
import { GeminiService } from '../gemini/gemini.service';
import { ValidationService } from '../validation/validation.service';
import { buildArchitectPrompt, buildImportPrompt, SCENARIO_RESPONSE_SCHEMA } from '../prompts/scenario.prompts';
import { GET_GRAMMAR_PATTERNS_DECLARATION } from '../prompts/curriculum';
import { GrammarSectionsService } from '../grammar-sections/grammar-sections.service';

import { ScenarioTemplate, SCENARIO_TEMPLATES } from './templates';
import { ScenarioKnowledgeService } from './scenario-knowledge.service';
import { ScenarioChatService } from './scenario-chat.service';
import { PictureRenderer } from '../pictures/picture-renderer';
import { PictureBrief } from '../prompts/picture.prompts';
import { FacetStore } from '../facets/facet-store';
import { stripFurigana } from '../lib/furigana-text';
import { jlptLevelOf, excludedContentOf } from '../users/user.service';

/** Role Play gate: every Key Vocabulary and Key Grammar item at Familiar (SRS stage 3) or above. */
export const VOCAB_READY_MIN_STAGE = 3;

@Injectable()
export class ScenariosService {
  private readonly logger = new Logger(ScenariosService.name);

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly facetStore: FacetStore,
    private readonly geminiService: GeminiService,
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
    private readonly userService: UserService,
    private readonly validationService: ValidationService,
    private readonly grammarSectionsService: GrammarSectionsService,
    private readonly pictureRenderer: PictureRenderer,
    private readonly scenarioKnowledge: ScenarioKnowledgeService,
    private readonly scenarioChat: ScenarioChatService,
  ) {}

  /** Scene drawings in progress ("uid/scenarioId"), and the last failure per scenario. */
  private readonly drawingScenes = new Set<string>();
  private readonly sceneErrors = new Map<string, string>();

  private scenariosColRef(uid: string): CollectionReference {
    if (uid === ADMIN_USER_ID) {
      return this.db.collection(SCENARIOS_COLLECTION);
    }
    return this.db.collection('users').doc(uid).collection(SCENARIOS_COLLECTION);
  }

  async getAllScenarios(userId: string, limitDays?: number, state?: string): Promise<Scenario[]> {
    let query = this.scenariosColRef(userId)
      .orderBy('createdAt', 'desc');

    if (limitDays) {
      const date = new Date();
      date.setDate(date.getDate() - limitDays);
      const timestamp = Timestamp.fromDate(date);
      query = query.where('createdAt', '>', timestamp);
    }

    if (state) {
      query = query.where('state', '==', state);
    }

    const snapshot = await query.get();
    return this.withPoolContent(snapshot.docs.map(doc => doc.data() as Scenario));
  }

  /** Fills in the shared content of learners' pool scenarios (one read for all the pool docs). */
  private async withPoolContent(scenarios: Scenario[]): Promise<Scenario[]> {
    const poolIds = [...new Set(scenarios.map(s => s.poolId).filter((id): id is string => !!id))];
    if (poolIds.length === 0) return scenarios;
    const pool = this.db.collection(SCENARIO_POOL_COLLECTION);
    const docs = await this.db.getAll(...poolIds.map(id => pool.doc(id)));
    const byId = new Map(docs.filter(d => d.exists).map(d => [d.id, d.data() as PoolScenario]));
    // A learner doc whose pool scenario was deleted has no content left to show: leave it out.
    return scenarios
      .filter(s => !s.poolId || byId.has(s.poolId))
      .map(s => (s.poolId ? mergePoolScenario(byId.get(s.poolId), s) : s));
  }

  /** The pool scenarios a learner can start, by level then title (content only, no progress). */
  async listPool(): Promise<Pick<PoolScenario, 'id' | 'title' | 'description' | 'difficultyLevel'>[]> {
    const snap = await this.db.collection(SCENARIO_POOL_COLLECTION).select('id', 'title', 'description', 'difficultyLevel').get();
    // Unknown levels sort last.
    const rank = (l: string) => { const i = JLPT_LEVEL_ORDER.indexOf(l as JlptLevel); return i < 0 ? JLPT_LEVEL_ORDER.length : i; };
    return snap.docs
      .map(d => d.data() as PoolScenario)
      .sort((a, b) => rank(a.difficultyLevel) - rank(b.difficultyLevel) || (a.title ?? '').localeCompare(b.title ?? ''))
      .map(p => ({ id: p.id, title: p.title, description: p.description, difficultyLevel: p.difficultyLevel }));
  }

  /**
   * Starts a pool scenario for a learner: their own doc (id = pool id) holding progress only.
   * Already started → the existing doc is kept (Reset handles another attempt).
   */
  async startPoolScenario(uid: string, poolId: string): Promise<{ id: string }> {
    const poolDoc = await this.db.collection(SCENARIO_POOL_COLLECTION).doc(poolId).get();
    if (!poolDoc.exists) throw new NotFoundException('Pool scenario not found');
    const ref = this.scenariosColRef(uid).doc(poolId);
    await this.db.runTransaction(async tx => {
      if (!(await tx.get(ref)).exists) tx.set(ref, newLearnerDoc(poolId, uid));
    });
    return { id: poolId };
  }

  /** Admin: publish one of their own standalone scenarios to the pool (its content fields only). */
  async publishToPool(uid: string, scenarioId: string): Promise<{ poolId: string }> {
    const scenario = await this.getScenario(uid, scenarioId);
    if (!scenario) throw new NotFoundException('Scenario not found');
    if (scenario.poolId) throw new BadRequestException('This scenario is already from the pool');
    const col = this.db.collection(SCENARIO_POOL_COLLECTION);
    const already = await col.where('publishedFrom.uid', '==', uid).where('publishedFrom.scenarioId', '==', scenarioId).limit(1).get();
    if (!already.empty) throw new BadRequestException(`Already published to the pool as ${already.docs[0].id}`);
    const ref = col.doc();
    const pool = poolContentOf(scenario, { uid, scenarioId }, ref.id);
    // Written before the slow script-words call, so a second publish soon after sees it.
    await ref.set(pool);
    this.logger.log(`Published scenario ${scenarioId} (uid=${uid}) to the pool as ${ref.id}`);
    // Script words are a nice-to-have: a failed call doesn't undo the publish (backfill later).
    try {
      await ref.update({ secondaryKUs: await this.scriptWordsFor(pool) });
    } catch (err) {
      this.logger.error(`Script words for ${ref.id} failed; published without them`, err);
    }
    return { poolId: ref.id };
  }

  /**
   * The script's other content words (not Key Vocabulary), one Gemini call. Admin-only (publish,
   * rebuild): each word is resolved to its global KU here, created if new, so learners who opt in
   * only enrol existing words (global word writes are admin-only).
   */
  private async scriptWordsFor(scenario: Pick<Scenario, 'title' | 'dialogue' | 'extractedKUs'>): Promise<ExtractedKU[]> {
    const lines = (scenario.dialogue ?? []).map(l => stripFurigana(l.text));
    const key = (scenario.extractedKUs ?? []).map(k => k.content.trim());
    const words = await this.geminiService.extractScriptVocab(lines, key, scenario.title);
    const skip = new Set(key);
    const kept: ExtractedKU[] = [];
    for (const w of words) {
      const content = (w.content ?? '').trim();
      if (!content || skip.has(content)) continue;
      skip.add(content);
      const kuId = await this.knowledgeUnitsService.ensureVocab(content, { reading: w.reading, definition: w.meaning, jlptLevel: w.jlptLevel });
      kept.push({ content, reading: w.reading, meaning: w.meaning, type: 'vocab', status: 'new', jlptLevel: w.jlptLevel, kuId });
    }
    return kept;
  }

  /** Admin: a pool scenario's own brief and script-word count (not a learner's merged copy). */
  async poolAdminSummary(poolId: string): Promise<{ simulationBrief: string; scriptWords: number }> {
    const doc = await this.db.collection(SCENARIO_POOL_COLLECTION).doc(poolId).get();
    if (!doc.exists) throw new NotFoundException('Pool scenario not found');
    const pool = doc.data() as PoolScenario;
    return { simulationBrief: pool.simulationBrief ?? '', scriptWords: pool.secondaryKUs?.length ?? 0 };
  }

  /** Admin: (re)build a pool scenario's script words. */
  async rebuildScriptWords(poolId: string): Promise<{ count: number }> {
    const ref = this.db.collection(SCENARIO_POOL_COLLECTION).doc(poolId);
    const doc = await ref.get();
    if (!doc.exists) throw new NotFoundException('Pool scenario not found');
    const secondaryKUs = await this.scriptWordsFor(doc.data() as PoolScenario);
    await ref.update({ secondaryKUs });
    return { count: secondaryKUs.length };
  }

  /** Admin: set a pool scenario's simulation brief (empty clears it). Only that field changes. */
  async setSimulationBrief(poolId: string, brief: string): Promise<void> {
    const ref = this.db.collection(SCENARIO_POOL_COLLECTION).doc(poolId);
    if (!(await ref.get()).exists) throw new NotFoundException('Pool scenario not found');
    const trimmed = (brief ?? '').trim();
    await ref.update({ simulationBrief: trimmed ? trimmed : FieldValue.delete() });
  }

  async getScenariosBySourceKuId(userId: string, sourceKuId: string): Promise<Pick<Scenario, 'id' | 'title' | 'sourceContextSentence' | 'createdAt'>[]> {
    // NOTE: Requires Firestore composite index on (sourceKuId ASC, createdAt DESC)
    // for the 'scenarios' collection group (covers both root and users/{uid}/scenarios).
    const snapshot = await this.scenariosColRef(userId)
      .where('sourceKuId', '==', sourceKuId)
      .orderBy('createdAt', 'desc')
      .get();
    return snapshot.docs.map(doc => {
      const d = doc.data() as Scenario;
      return { id: doc.id, title: d.title, sourceContextSentence: d.sourceContextSentence, createdAt: d.createdAt };
    });
  }

  async getScenariosBySourceSectionId(userId: string, sourceSectionId: string): Promise<Pick<Scenario, 'id' | 'title' | 'createdAt'>[]> {
    // NOTE: Requires Firestore composite index on (sourceSectionId ASC, createdAt DESC)
    // for the 'scenarios' collection group (covers both root and users/{uid}/scenarios).
    const snapshot = await this.scenariosColRef(userId)
      .where('sourceSectionId', '==', sourceSectionId)
      .orderBy('createdAt', 'desc')
      .get();
    return snapshot.docs.map(doc => {
      const d = doc.data() as Scenario;
      return { id: doc.id, title: d.title, createdAt: d.createdAt };
    });
  }

  getTemplates(): ScenarioTemplate[] {
    return SCENARIO_TEMPLATES;
  }

  /**
   * Draw the scenario's setting (from its existing visualPrompt brief: no extra text call)
   * in the background. Only ever on request: it costs an image call. Poll getSceneStatus.
   */
  async startScenePicture(uid: string, id: string): Promise<{ drawing: true }> {
    const key = `${uid}/${id}`;
    if (this.drawingScenes.has(key)) throw new BadRequestException('This scene is already being drawn');
    this.drawingScenes.add(key); // claim before any await
    let scenario: Scenario | null;
    try {
      scenario = await this.getScenario(uid, id);
      if (!scenario) throw new NotFoundException('Scenario not found');
      if (!scenario.setting?.visualPrompt?.trim()) throw new BadRequestException('This scenario has no scene description to draw');
    } catch (e) {
      this.drawingScenes.delete(key);
      throw e;
    }
    this.sceneErrors.delete(key);
    const s = scenario.setting;
    const brief: PictureBrief = {
      picturable: true,
      includeCast: false,
      background: [s.location, s.timeOfDay].filter(Boolean).join(', ') || 'none',
      scene: s.visualPrompt,
    };
    const subdir = `scenarios/${uid}`;
    this.pictureRenderer
      .render(brief, { style: 'scene', prefix: id, subdir, logId: id })
      .then(async result => {
        await this.scenariosColRef(uid).doc(id).update({
          'setting.picture': { file: result.file, status: result.status, attempts: result.attempts, createdAt: Timestamp.now() },
        });
        this.pictureRenderer.removeByPrefix(id, result.file, subdir);
        this.logger.log(`Scene for scenario ${id}: ${result.status} after ${result.attempts.length} attempt(s)`);
      })
      .catch(e => {
        this.sceneErrors.set(key, e?.message ?? 'Drawing failed');
        this.logger.error(`Scene for scenario ${id} failed: ${e?.message}`);
      })
      .finally(() => this.drawingScenes.delete(key));
    return { drawing: true };
  }

  getSceneStatus(uid: string, id: string): { drawing: boolean; error?: string } {
    const key = `${uid}/${id}`;
    return { drawing: this.drawingScenes.has(key), ...(this.sceneErrors.has(key) ? { error: this.sceneErrors.get(key) } : {}) };
  }

  /** Absolute path of the scenario's scene image (the caller's own scenario only), or null. */
  async scenePicturePath(uid: string, id: string): Promise<string | null> {
    const file = (await this.getScenario(uid, id))?.setting?.picture?.file;
    const p = file ? this.pictureRenderer.resolve(file) : null;
    return p && fs.existsSync(p) ? p : null;
  }

  async getScenario(uid: string, id: string): Promise<Scenario | null> {
    const doc = await this.scenariosColRef(uid).doc(id).get();
    if (!doc.exists) return null;
    const scenario = doc.data() as Scenario;
    if (!scenario.poolId) return scenario;
    const pool = await this.db.collection(SCENARIO_POOL_COLLECTION).doc(scenario.poolId).get();
    if (!pool.exists) {
      // Progress alone isn't a scenario: treat it as gone rather than serve a doc with no content.
      this.logger.warn(`Pool scenario ${scenario.poolId} is gone; uid=${uid}'s copy can't be shown`);
      return null;
    }
    return mergePoolScenario(pool.data() as PoolScenario, scenario);
  }

  async generateScenario(userId: string, dto: GenerateScenarioDto): Promise<string> {
    // Apply user preferences as defaults for fields not explicitly set in the DTO
    const user = await this.userService.findById(userId);
    const userPrefs = user?.preferences;
    const resolvedDto: GenerateScenarioDto = {
      ...dto,
      difficulty: dto.difficulty ?? jlptLevelOf(user ?? undefined),
      userRole: dto.userRole ?? userPrefs?.preferredUserRole,
      sourceContextSentence: dto.sourceContextSentence == null ? undefined : stripFurigana(dto.sourceContextSentence).trim(),
    };

    const grammarSection = resolvedDto.sourceType === 'grammar-pattern' && resolvedDto.sourceSectionId
      ? await this.grammarSectionsService.findById(resolvedDto.sourceSectionId)
      : null;
    if (resolvedDto.sourceType === 'grammar-pattern' && resolvedDto.sourceSectionId && !grammarSection) {
      this.logger.warn(`generateScenario: sourceSectionId=${resolvedDto.sourceSectionId} not found — generating without the grammar-pattern directive`);
    }

    const { excludedVocab, excludedGrammar } = excludedContentOf(user ?? undefined);
    const prompt = buildArchitectPrompt(resolvedDto, excludedVocab, excludedGrammar, grammarSection);

    try {
      const data = await this.geminiService.generateScenario(
        prompt,
        [GET_GRAMMAR_PATTERNS_DECLARATION],
        this.scenarioKnowledge.buildGrammarToolHandlers(userId),
        SCENARIO_RESPONSE_SCHEMA,
      );

      const docRef = this.scenariosColRef(userId).doc();
      const id = docRef.id;

      // Helper to clean "helpful" formatting like "本屋 (Bookstore)" or "ほんや (honya)"
      const cleanContent = (str: string) => str ? str.replace(/\(.*\)/g, '').replace(/（.*）/g, '').trim() : '';
      const cleanMeaning = (str: string) => str ? str.replace(/^-/, '').trim() : '';

      const newScenario: Scenario = {
        id,
        userId,
        title: data.title,
        description: data.description,
        difficultyLevel: resolvedDto.difficulty!,
        setting: {
          location: data.setting.location,
          participants: data.setting.participants,
          goal: data.setting.goal,
          timeOfDay: data.setting.timeOfDay,
          visualPrompt: data.setting.visualPrompt,
        },
        roles: data.roles,
        dialogue: data.dialogue,
        extractedKUs: data.extractedKUs.map((ku: any) => ({
          content: cleanContent(ku.content),
          reading: cleanContent(ku.reading),
          meaning: cleanMeaning(ku.meaning),
          type: 'vocab',
          status: 'new',
          jlptLevel: ku.jlptLevel ?? null,
        })),
        grammarMatches: Array.isArray(data.grammarMatches) ? data.grammarMatches : [],
        state: 'encounter',
        createdAt: Timestamp.now(),
        chatHistory: [],
        isObjectiveMet: false,
        isActive: true,
        sourceType: resolvedDto.sourceType,
        sourceContextSentence: resolvedDto.sourceContextSentence,
        targetVocab: resolvedDto.targetVocab,
        sourceKuId: resolvedDto.sourceKuId,
        sourceSectionId: resolvedDto.sourceSectionId,
      };

      const cleanData = Object.fromEntries(
        Object.entries(newScenario).filter(([_, value]) => value !== undefined)
      );

      await docRef.set(cleanData);
      void this.validateScenario(newScenario, resolvedDto.difficulty!);
      return id;

    } catch (error) {
      this.logger.error('Scenario Generation Failed:', error);
      throw new InternalServerErrorException('Failed to generate scenario from AI', error);
    }
  }

  /**
   * Regenerates a scenario referenced by a content-quality flag, reusing the
   * original generation parameters (difficulty, source context, roles). Creates
   * a fresh scenario rather than overwriting the flagged one in place — the
   * flagged scenario may carry live chat/progress state that shouldn't be
   * silently discarded; the admin resolves/dismisses the old flag separately
   * once satisfied with the new content.
   */
  async regenerateFromFlag(flagId: string): Promise<{ id: string }> {
    const flag = await this.validationService.getFlagById(flagId);
    if (!flag || flag.sourceType !== 'scenario') {
      throw new NotFoundException(`No scenario flag found for id=${flagId}`);
    }
    if (!flag.userId) {
      throw new InternalServerErrorException(
        `Flag ${flagId} has no userId recorded — created before scenario flags tracked ownership, can't locate the source scenario`,
      );
    }

    const old = await this.getScenario(flag.userId, flag.sourceId);
    if (!old) {
      throw new NotFoundException(`Scenario ${flag.sourceId} not found for uid=${flag.userId}`);
    }
    if (old.poolId) {
      // Regenerating would give only the flagger a private copy; the shared content needs the fix.
      throw new BadRequestException(`Scenario ${flag.sourceId} is shared from the pool: fix scenario-pool/${old.poolId} instead`);
    }

    const dto: GenerateScenarioDto = {
      difficulty: old.difficultyLevel,
      sourceType: old.sourceType,
      sourceContextSentence: old.sourceContextSentence,
      targetVocab: old.targetVocab,
      sourceKuId: old.sourceKuId,
      userRole: old.roles?.user,
      aiRole: Array.isArray(old.roles?.ai) ? old.roles.ai[0] : old.roles?.ai,
    };

    const id = await this.generateScenario(flag.userId, dto);
    return { id };
  }

  async saveFromTutor(uid: string, data: any): Promise<{ id: string; success: true }> {
    const docRef = this.scenariosColRef(uid).doc();
    const id = docRef.id;

    const cleanContent = (str: string) =>
      str ? str.replace(/\(.*\)/g, '').replace(/（.*）/g, '').trim() : '';
    const cleanMeaning = (str: string) =>
      str ? str.replace(/^-/, '').trim() : '';

    let extractedKUs = (data.extractedKUs ?? []).map((ku: any) => ({
      content: cleanContent(ku.content),
      reading: cleanContent(ku.reading),
      meaning: cleanMeaning(ku.meaning),
      type: 'vocab' as const,
      status: 'new' as const,
      jlptLevel: ku.jlptLevel ?? null,
    }));
    let grammarMatches = Array.isArray(data.grammarMatches) ? data.grammarMatches : [];

    // Strict mode: the prompt already asked the model to stay within the supplied
    // vocab/grammar, but that's not guaranteed — this is the actual enforcement. Anything
    // outside the allowed sets is dropped here rather than blocking generation: the
    // dialogue prose itself can't be un-written, but nothing outside what we approved
    // ever gets enrolled or counted toward the roleplay-readiness gate.
    if (Array.isArray(data.strictAllowedVocab)) {
      const allowedVocab = new Set<string>(data.strictAllowedVocab);
      const before = extractedKUs.length;
      extractedKUs = extractedKUs.filter((ku: { content: string }) => allowedVocab.has(ku.content));
      if (extractedKUs.length < before) {
        this.logger.warn(`saveFromTutor: strict mode dropped ${before - extractedKUs.length}/${before} extractedKUs outside allowed vocab for uid=${uid}`);
      }
    }
    if (Array.isArray(data.strictAllowedGrammarKuIds)) {
      const allowedGrammarKuIds = new Set<string>(data.strictAllowedGrammarKuIds);
      const before = grammarMatches.length;
      grammarMatches = grammarMatches.filter((m: { kuId: string }) => allowedGrammarKuIds.has(m.kuId));
      if (grammarMatches.length < before) {
        this.logger.warn(`saveFromTutor: strict mode dropped ${before - grammarMatches.length}/${before} grammarMatches outside allowed grammar pool for uid=${uid}`);
      }
    }

    const newScenario: Scenario = {
      id,
      userId: uid,
      title: data.title,
      description: data.description,
      difficultyLevel: data.difficultyLevel,
      setting: data.setting,
      roles: data.roles,
      dialogue: data.dialogue,
      extractedKUs,
      grammarMatches,
      ...(data.grammarNotes ? { grammarNotes: data.grammarNotes } : {}),
      state: 'encounter' as const,
      createdAt: Timestamp.now(),
      chatHistory: [],
      isObjectiveMet: false,
      isActive: true,
      sourceType: data.sourceType ?? 'custom',
      ...(data.sourceContextSentence && { sourceContextSentence: data.sourceContextSentence }),
      ...(data.targetVocab && { targetVocab: data.targetVocab }),
      ...(data.sourceKuId && { sourceKuId: data.sourceKuId }),
    };

    const cleanData = Object.fromEntries(
      Object.entries(newScenario).filter(([, v]) => v !== undefined),
    );

    await docRef.set(cleanData);
    this.logger.log(`saveFromTutor: created scenario ${id} for uid=${uid}`);
    void this.validateScenario(newScenario, newScenario.difficultyLevel);
    return { id, success: true };
  }

  async importScenario(uid: string, dto: ImportScenarioDto): Promise<string> {
    const resolvedAiRoles = dto.aiRoles?.length ? dto.aiRoles : (dto.aiRole ? [dto.aiRole] : []);
    if (!dto.conversationText?.trim() || !dto.userRole?.trim() || resolvedAiRoles.length === 0) {
      throw new InternalServerErrorException('conversationText, userRole, and at least one aiRole are required');
    }

    const difficulty = dto.difficulty ?? await this.userService.getJlptLevel(uid);
    const prompt = buildImportPrompt({
      ...dto,
      aiRoles: resolvedAiRoles,
      difficulty,
    });

    try {
      const data = await this.geminiService.generateScenario(
        prompt,
        [GET_GRAMMAR_PATTERNS_DECLARATION],
        this.scenarioKnowledge.buildGrammarToolHandlers(uid),
        SCENARIO_RESPONSE_SCHEMA,
      );

      const docRef = this.scenariosColRef(uid).doc();
      const id = docRef.id;

      const cleanContent = (str: string) => str ? str.replace(/\(.*\)/g, '').replace(/（.*）/g, '').trim() : '';
      const cleanMeaning = (str: string) => str ? str.replace(/^-/, '').trim() : '';

      const newScenario: Scenario = {
        id,
        userId: uid,
        title: data.title,
        description: data.description,
        difficultyLevel: difficulty,
        setting: {
          location: data.setting.location,
          participants: data.setting.participants,
          goal: data.setting.goal,
          timeOfDay: data.setting.timeOfDay,
          visualPrompt: data.setting.visualPrompt,
        },
        roles: data.roles,
        dialogue: data.dialogue,
        extractedKUs: data.extractedKUs.map((ku: any) => ({
          content: cleanContent(ku.content),
          reading: cleanContent(ku.reading),
          meaning: cleanMeaning(ku.meaning),
          type: 'vocab',
          status: 'new',
          jlptLevel: ku.jlptLevel ?? null,
        })),
        grammarMatches: Array.isArray(data.grammarMatches) ? data.grammarMatches : [],
        state: 'encounter',
        createdAt: Timestamp.now(),
        chatHistory: [],
        isObjectiveMet: false,
        isActive: true,
        sourceType: 'custom',
      };

      const cleanData = Object.fromEntries(
        Object.entries(newScenario).filter(([_, value]) => value !== undefined)
      );

      await docRef.set(cleanData);
      this.logger.log(`Imported scenario ${id} for uid=${uid}`);
      return id;

    } catch (error) {
      this.logger.error('Scenario Import Failed:', error);
      throw new InternalServerErrorException('Failed to import scenario', error);
    }
  }

  async advanceState(uid: string, id: string, opts: { includeScriptWords?: boolean } = {}): Promise<void> {
    this.logger.log(`Advancing state for scenario ${id}`);
    const scenario = await this.getScenario(uid, id);
    if (!scenario) throw new NotFoundException('Scenario not found');

    let newState: ScenarioState = scenario.state;
    // Prepare updates object
    const updateData: Record<string, any> = {};

    switch (scenario.state) {
      case 'encounter':
        // Transition Encounter -> Drill
        // Link each extracted KU to its global KU and create a UserKnowledgeUnit.
        if (scenario.extractedKUs && scenario.extractedKUs.length > 0) {
          const updatedKUs: ExtractedKU[] = [];
          for (const ku of scenario.extractedKUs) {
            updatedKUs.push(await this.scenarioKnowledge.linkVocabKu(uid, scenario, ku));
          }
          updateData.extractedKUs = updatedKUs;
        }


        // Link Grammar KUs — prefer grammarMatches (tool-based, exact kuIds) over legacy grammarNotes
        if (scenario.grammarMatches && scenario.grammarMatches.length > 0) {
          let linked = 0;
          for (const match of scenario.grammarMatches) {
            if (await this.scenarioKnowledge.linkGrammarMatch(uid, scenario, match, 'scenario')) linked++;
          }
          this.logger.log(`Grammar matches: linked ${linked}/${scenario.grammarMatches.length} for scenarioId=${scenario.id}`);
        } else if (scenario.grammarNotes && scenario.grammarNotes.length > 0) {
          // Legacy path: scenarios created before tool-based matching
          let matched = 0;
          for (const note of scenario.grammarNotes) {
            try {
              const kuId = await this.knowledgeUnitsService.ensureGrammarKU(note);
              if (!kuId) continue;
              const synthetic: GrammarMatch = { kuId, exampleFromConversation: note.exampleInContext };
              if (await this.scenarioKnowledge.linkGrammarMatch(uid, scenario, synthetic, 'scenario')) matched++;
            } catch (err) {
              this.logger.error(`Failed to process grammar note "${note.title}"`, err);
            }
          }
          this.logger.log(`Grammar notes (legacy): ${matched}/${scenario.grammarNotes.length} matched to pool for scenarioId=${scenario.id}`);
        }

        // Opted in: the script's other words go to the learning queue too, but not into the gate.
        // Linked last, so Start Learning (oldest first) serves the Key items before them.
        // Only words already resolved to a KU (at publish or rebuild): a learner never creates one.
        if (opts.includeScriptWords && scenario.secondaryKUs?.length) {
          const resolved = scenario.secondaryKUs.filter(ku => ku.kuId);
          if (resolved.length < scenario.secondaryKUs.length) {
            this.logger.warn(`Scenario ${scenario.id}: ${scenario.secondaryKUs.length - resolved.length} script word(s) have no KU yet (rebuild script words); skipped`);
          }
          updateData.secondaryKUs = await Promise.all(resolved.map(ku => this.scenarioKnowledge.linkVocabKu(uid, scenario, ku)));
        }

        newState = 'drill';
        break;
      case 'drill':
        newState = 'simulate';
        // Seed chat history if AI speaks first
        const initialHistory = this.scenarioChat.initialChatHistory(scenario);
        if (initialHistory.length > 0) {
          updateData.chatHistory = initialHistory;
        }
        break;
      case 'simulate':
        newState = 'completed';
        break;
    }

    updateData.state = newState;

    if (newState === 'completed') {
      updateData.completedAt = Timestamp.now();
      updateData.isActive = false;

      // GENERATE EVALUATION
      if (scenario.chatHistory && scenario.chatHistory.length > 0) {
        try {
          const evaluation = await this.scenarioChat.evaluate(scenario);
          if (evaluation) {
            updateData.evaluation = evaluation;
            this.writeProgressUpdate(scenario, evaluation.rating, updateData);
          }

          try {
            const { extractedKUs, grammarMatches } = await this.scenarioChat.extractLiveChatKnowledge(uid, scenario, evaluation);
            updateData.liveExtractedKUs = extractedKUs;
            updateData.liveGrammarMatches = grammarMatches;
          } catch (e) {
            this.logger.error('Failed to extract live-chat knowledge', e);
          }
        } catch (e) {
          this.logger.error("Failed to generate scenario evaluation", e);
        }
      }
    }

    this.logger.log(`Updating state for scenario ${id} to ${newState}`);
    await this.scenariosColRef(uid).doc(id).update(updateData);
  }



  async resetSession(uid: string, id: string, archive: boolean): Promise<void> {
    this.logger.log(`Resetting session for scenario ${id} (Archive: ${archive})`);
    const scenario = await this.getScenario(uid, id);
    if (!scenario) throw new NotFoundException('Scenario not found');

    const updateData: any = {
      state: 'simulate',
      chatHistory: this.scenarioChat.initialChatHistory(scenario), // Reset to initial seed if applicable
      evaluation: FieldValue.delete(), // clear evaluation
      completedAt: FieldValue.delete(), // clear completedAt
      isObjectiveMet: false, // Reset objective met status
      isActive: true, // Reset to active too
    };

    // Archiving Logic
    if (archive && scenario.state === 'completed' && scenario.chatHistory && scenario.evaluation && scenario.completedAt) {
      const attempt: ScenarioAttempt = {
        completedAt: scenario.completedAt,
        chatHistory: scenario.chatHistory,
        evaluation: scenario.evaluation
      };
      updateData.pastAttempts = FieldValue.arrayUnion(attempt);
    }

    await this.scenariosColRef(uid).doc(id).update(updateData);
  }

  async deactivateScenario(uid: string, id: string): Promise<void> {
    this.logger.log(`Deactivating scenario ${id}`);
    const scenario = await this.getScenario(uid, id);
    if (!scenario) throw new NotFoundException('Scenario not found');
    await this.scenariosColRef(uid).doc(id).update({ isActive: false });
  }

  async handleChat(uid: string, id: string, userMessage: string): Promise<ChatMessage[]> {
    const scenario = await this.getScenario(uid, id);
    if (!scenario) throw new NotFoundException('Scenario not found');

    const { userMsg, aiMsg } = await this.scenarioChat.reply(uid, scenario, userMessage);

    // Persist to Firestore (atomic append)
    const updateData: Record<string, any> = {
      chatHistory: FieldValue.arrayUnion(userMsg, aiMsg)
    };

    // If the AI says the scene is finished, update isObjectiveMet
    if (aiMsg.sceneFinished) {
      updateData.isObjectiveMet = true;
      updateData.isActive = false; // Auto-deactivate
    }

    await this.scenariosColRef(uid).doc(id).update(updateData);

    // Return the full history so the frontend can sync
    return [...(scenario.chatHistory || []), userMsg, aiMsg];
  }


  private progressStatusFromStars(stars: number): ProgressStatus {
    if (stars <= 0) return 'reviewing';
    if (stars <= 2) return 'failing';
    if (stars <= 4) return 'passing';
    return 'passed';
  }

  private writeProgressUpdate(scenario: Scenario, rawRating: number, updateData: Record<string, any>): void {
    const level = scenario.difficultyLevel;
    const stars = Math.max(1, Math.min(5, Math.round(rawRating))) as 1 | 2 | 3 | 4 | 5;
    const now = Timestamp.now();

    const existing: LevelProgress = scenario.progress?.[level] ?? {
      status: 'reviewing',
      bestStars: 0,
      lastAttemptAt: null,
      attempts: [],
    };

    const newAttempt: Attempt = { attemptedAt: now, stars };
    const newBestStars = Math.max(existing.bestStars, stars);
    const newStatus = this.progressStatusFromStars(newBestStars);

    const updated: LevelProgress = {
      status: newStatus,
      bestStars: newBestStars,
      lastAttemptAt: now,
      attempts: [...existing.attempts, newAttempt],
    };

    updateData[`progress.${level}`] = updated;
    updateData.currentLevelStatus = newStatus;
  }

  async checkAndSetVocabReady(uid: string, scenarioId: string): Promise<void> {
    const scenario = await this.getScenario(uid, scenarioId);
    if (!scenario || scenario.state !== 'drill' || scenario.vocabReady === true) return;
    if ((await this.scenarioReadiness(uid, scenario)).ready) {
      await this.scenariosColRef(uid).doc(scenarioId).update({ vocabReady: true });
      this.logger.log(`Set vocabReady=true for scenario ${scenarioId} uid=${uid}`);
    }
  }

  /** Per-item SRS status of a scenario's Key Vocabulary and Key Grammar, plus whether Role Play is unlocked. */
  async getKuStatus(uid: string, scenarioId: string): Promise<{
    items: Record<string, { maxSrsStage: number | null; minSrsStage: number | null }>;
    ready: boolean;
    minStage: number;
    /** Key Grammar labels (grammarMatches only store a kuId). */
    grammar: { kuId: string; content: string; title: string }[];
  }> {
    const scenario = await this.getScenario(uid, scenarioId);
    if (!scenario) throw new NotFoundException('Scenario not found');
    const { items, ready } = await this.scenarioReadiness(uid, scenario);
    const grammarIds = [...new Set((scenario.grammarMatches ?? []).map(g => g.kuId).filter(Boolean))];
    const grammarDocs = grammarIds.length
      ? await this.db.getAll(...grammarIds.map(id => this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(id)))
      : [];
    const grammar = grammarDocs.filter(d => d.exists).map(d => ({
      kuId: d.id,
      content: d.data()!.content as string,
      title: (d.data()!.data?.title as string) ?? '',
    }));
    return { items, ready, minStage: VOCAB_READY_MIN_STAGE, grammar };
  }

  /**
   * The Role Play gate, in one place: every linked Key Vocabulary (extractedKUs) and Key
   * Grammar (grammarMatches) item needs its lowest facet at VOCAB_READY_MIN_STAGE or above.
   * Used by checkAndSetVocabReady, the scenario page (via getKuStatus) and Flash cards.
   */
  async scenarioReadiness(uid: string, scenario: Scenario): Promise<{ items: Record<string, { maxSrsStage: number | null; minSrsStage: number | null }>; ready: boolean }> {
    const kuIds = [...new Set([
      ...scenario.extractedKUs.filter(ku => ku.kuId).map(ku => ku.kuId!),
      ...(scenario.grammarMatches ?? []).map(g => g.kuId).filter(Boolean),
    ])];
    // Nothing linked means nothing to graduate: Role Play is open.
    if (kuIds.length === 0) return { items: {}, ready: true };

    const facetsRef = this.facetStore.query(uid);

    const items: Record<string, { maxSrsStage: number | null; minSrsStage: number | null }> = {};
    await Promise.all(kuIds.map(async (kuId) => {
      const snap = await facetsRef.where('kuId', '==', kuId).get();
      const stages = snap.docs.map(d => (d.data().srsStage as number) ?? 0);
      items[kuId] = {
        maxSrsStage: stages.length > 0 ? Math.max(...stages) : null,
        minSrsStage: stages.length > 0 ? Math.min(...stages) : null,
      };
    }));
    const ready = kuIds.every(kuId => (items[kuId].minSrsStage ?? -1) >= VOCAB_READY_MIN_STAGE);
    return { items, ready };
  }

  private async validateScenario(scenario: Scenario, jlptLevel: string): Promise<void> {
    try {
      // Only the user's own lines need to be level-appropriate — the AI's lines are
      // what the user is meant to practice comprehending, and can't be expected to
      // stay within the user's known vocabulary any more than a real conversation
      // partner would.
      const segments = scenario.dialogue
        .filter(line => line.speakerRole === 'user')
        .map(line => line.text)
        .filter(Boolean);
      if (segments.length === 0) return;

      const result = await this.validationService.validateContent(segments, jlptLevel, scenario.userId);
      await this.validationService.flagScenario(scenario.id, scenario.title, jlptLevel, result, scenario.userId);
    } catch (err) {
      this.logger.error(`Scenario validation failed for id=${scenario.id}`, err);
    }
  }
}