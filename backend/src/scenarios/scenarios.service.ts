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
import { Scenario, GenerateScenarioDto, ImportScenarioDto, ScenarioState, ExtractedKU, ChatMessage, ScenarioEvaluation, ScenarioAttempt, ProgressStatus, LevelProgress, Attempt } from '../types/scenario';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { LessonsService } from '../lessons/lessons.service';
import { UserService } from '../users/user.service';
import { FIRESTORE_CONNECTION, SCENARIOS_COLLECTION, KNOWLEDGE_UNITS_COLLECTION } from '../firebase/firebase.module';
import { ADMIN_USER_ID } from '../lib/constants';
import { GeminiService } from '../gemini/gemini.service';
import { ValidationService } from '../validation/validation.service';
import { ALLOWED_USER_ROLES, ALLOWED_AI_ROLES, buildArchitectPrompt, buildImportPrompt, buildChatSystemPrompt, buildLiveExtractionPrompt, SCENARIO_RESPONSE_SCHEMA } from '../prompts/scenario.prompts';
import { GET_GRAMMAR_PATTERNS_DECLARATION } from '../prompts/curriculum';
import { GrammarMatch } from '../types/scenario';
import { GrammarSectionsService } from '../grammar-sections/grammar-sections.service';

import { ScenarioTemplate, SCENARIO_TEMPLATES } from './templates';
import { PictureRenderer } from '../pictures/picture-renderer';
import { PictureBrief } from '../prompts/picture.prompts';
import { FacetStore } from '../facets/facet-store';
import { stripFurigana } from '../lib/furigana-text';
import { jlptLevelOf } from '../users/user.service';

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
    private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
    private readonly lessonsService: LessonsService,
    private readonly userService: UserService,
    private readonly validationService: ValidationService,
    private readonly grammarSectionsService: GrammarSectionsService,
    private readonly pictureRenderer: PictureRenderer,
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

  async getGrammarPatterns(uid: string, jlptLevel: string): Promise<unknown> {
    return this.buildGrammarToolHandlers(uid).get_grammar_patterns({ jlptLevel });
  }

  /** Content the user explicitly flagged "not now" — see issue #222. */
  private async getExcludedContent(uid: string): Promise<{ excludedVocab: string[]; excludedGrammar: string[] }> {
    const user = await this.userService.findById(uid);
    return {
      excludedVocab: user?.tutorContext?.excludedVocab ?? [],
      excludedGrammar: user?.tutorContext?.excludedGrammar ?? [],
    };
  }

  private buildGrammarToolHandlers(uid: string) {
    return {
      get_grammar_patterns: async (args: Record<string, unknown>) => {
        const jlptLevel = (args.jlptLevel as string) || await this.userService.getJlptLevel(uid);

        // Fetch only grammar KUs the user has enrolled (and are not above their level)
        // Filtered in code, not with where('aboveLevel', '!=', true): Firestore's != skips
        // documents without the field (older enrolments, and new ones until the flag is written).
        const ukuSnap = await this.db
          .collection('users').doc(uid)
          .collection('user-kus')
          .get();

        const enrolledKuIds = ukuSnap.docs.filter(d => d.data().aboveLevel !== true).map(d => d.data().kuId as string);
        if (enrolledKuIds.length === 0) {
          this.logger.log(`get_grammar_patterns(${jlptLevel}) → 0 enrolled patterns for uid=${uid}`);
          return { patterns: [] };
        }

        // Batch-fetch global KUs for enrolled IDs, filter to Grammar at the requested level
        const kuRefs = enrolledKuIds.map(id => this.db.collection('knowledge-units').doc(id));
        const kuDocs = await this.db.getAll(...kuRefs);

        const patterns = kuDocs
          .filter(doc => {
            if (!doc.exists) return false;
            const d = doc.data()!;
            return d.type === 'Grammar' && (d.data as any)?.jlptLevel === jlptLevel;
          })
          .map(doc => {
            const d = doc.data()!;
            return {
              kuId: doc.id,
              content: d.content as string,
              title: (d.data as any)?.title ?? '',
              corpusNotes: (d.data as any)?.corpusNotes ?? '',
            };
          });

        this.logger.log(`get_grammar_patterns(${jlptLevel}) → ${patterns.length} enrolled patterns for uid=${uid}`);
        return { patterns };
      },
    };
  }

  /** Find-or-create the global Vocab KU for an extracted KU and enroll it for this user. Idempotent. */
  private async linkVocabKu(uid: string, scenario: Scenario, ku: ExtractedKU): Promise<ExtractedKU> {
    try {
      let kuId = ku.kuId;

      if (!kuId) {
        const globalKu = await this.knowledgeUnitsService.findByContent(ku.content, 'Vocab');

        if (globalKu) {
          this.logger.log(`Linking "${ku.content}" to existing global KU ${globalKu.id}`);
          kuId = globalKu.id;
        } else {
          this.logger.log(`No global KU found for "${ku.content}" — creating new KU with level hint ${ku.jlptLevel ?? 'none'}`);
          kuId = await this.knowledgeUnitsService.ensureVocab(ku.content, {
            reading: ku.reading,
            definition: ku.meaning,
            jlptLevel: ku.jlptLevel,
          });
        }
      }

      // Always ensure enrollment, even when kuId was already known — create() is
      // idempotent, and this is what makes the "known globally, new to this user"
      // case (the whole point of live-chat extraction's new-to-user filter) actually
      // enroll a UserKnowledgeUnit instead of silently no-op-ing.
      await this.userKnowledgeUnitsService.create(uid, kuId, { type: 'scenario', id: scenario.id });
      return { ...ku, kuId, status: 'learning' };
    } catch (error) {
      this.logger.error(`Failed to process KU "${ku.content}" during linking`, error);
      return ku;
    }
  }

  /** Enroll a matched Grammar KU and write its context-example lesson. Idempotent (deterministic doc id). */
  private async linkGrammarMatch(
    uid: string,
    scenario: Scenario,
    match: GrammarMatch,
    sourceType: 'scenario' | 'scenario-live' = 'scenario',
  ): Promise<boolean> {
    try {
      await this.userKnowledgeUnitsService.create(uid, match.kuId, { type: 'scenario', id: scenario.id });
      await this.lessonsService.createUserGrammarLesson(
        uid,
        match.kuId,
        { sourceType, sourceId: scenario.id, sourceTitle: scenario.title },
        match.exampleFromConversation,
      );
      return true;
    } catch (err) {
      this.logger.error(`Failed to link grammar match kuId="${match.kuId}"`, err);
      return false;
    }
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
    return snapshot.docs.map(doc => doc.data() as Scenario);
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
    return doc.data() as Scenario;
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

    const prompt = buildArchitectPrompt(
      resolvedDto,
      user?.tutorContext?.excludedVocab ?? [],
      user?.tutorContext?.excludedGrammar ?? [],
      grammarSection,
    );

    try {
      const data = await this.geminiService.generateScenario(
        prompt,
        [GET_GRAMMAR_PATTERNS_DECLARATION],
        this.buildGrammarToolHandlers(userId),
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
        this.buildGrammarToolHandlers(uid),
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

  async advanceState(uid: string, id: string): Promise<void> {
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
            updatedKUs.push(await this.linkVocabKu(uid, scenario, ku));
          }
          updateData.extractedKUs = updatedKUs;
        }

        // Link Grammar KUs — prefer grammarMatches (tool-based, exact kuIds) over legacy grammarNotes
        if (scenario.grammarMatches && scenario.grammarMatches.length > 0) {
          let linked = 0;
          for (const match of scenario.grammarMatches) {
            if (await this.linkGrammarMatch(uid, scenario, match, 'scenario')) linked++;
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
              if (await this.linkGrammarMatch(uid, scenario, synthetic, 'scenario')) matched++;
            } catch (err) {
              this.logger.error(`Failed to process grammar note "${note.title}"`, err);
            }
          }
          this.logger.log(`Grammar notes (legacy): ${matched}/${scenario.grammarNotes.length} matched to pool for scenarioId=${scenario.id}`);
        }

        newState = 'drill';
        break;
      case 'drill':
        newState = 'simulate';
        // Seed chat history if AI speaks first
        const initialHistory = this.getInitialChatHistory(scenario);
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
          const evaluation = await this.generateEvaluation(scenario);
          if (evaluation) {
            updateData.evaluation = evaluation;
            this.writeProgressUpdate(scenario, evaluation.rating, updateData);
          }

          try {
            const { extractedKUs, grammarMatches } = await this.extractLiveChatKnowledge(uid, scenario, evaluation);
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
      chatHistory: this.getInitialChatHistory(scenario), // Reset to initial seed if applicable
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

    // 1. Construct User Message
    const userMsgObj: ChatMessage = {
      speaker: 'user',
      text: userMessage,
      timestamp: Date.now(),
    };

    // 2. Format History
    let historyLines = "No previous conversation.";
    if (scenario.chatHistory && scenario.chatHistory.length > 0) {
      historyLines = scenario.chatHistory.map(msg => {
        const role = msg.speaker === 'user' ? 'User' : 'AI';
        return `${role}: ${msg.text}`;
      }).join('\n');
    }

    // 3. Build Prompt
    // 3a. Format Reference Script
    let referenceScript = "No reference script available.";
    if (scenario.dialogue && scenario.dialogue.length > 0) {
      referenceScript = scenario.dialogue.map(line => {
        return `${line.speaker}: ${line.text} (${line.translation || ''})`;
      }).join('\n');
    }

    let userRole = scenario.roles?.user;
    let aiRoles: string | string[] | undefined = scenario.roles?.ai;

    if (!userRole || !aiRoles) {
      // Fallback for older scenarios that lack the 'roles' field
      const roles = this.determineRoles(scenario.setting.participants);
      userRole = roles.userRole;
      aiRoles = roles.aiRole;
    }

    const { excludedVocab, excludedGrammar } = await this.getExcludedContent(uid);
    const systemPrompt = buildChatSystemPrompt(scenario, aiRoles, userRole, referenceScript, historyLines, excludedVocab, excludedGrammar);

    // 3. Get AI Response
    const aiResponse = await this.geminiService.generateChatResponse(
      systemPrompt,
      userMessage,
      { scenarioId: id, topic: scenario.title }
    );

    if (!aiResponse) {
      throw new InternalServerErrorException("Failed to generate AI response");
    }

    // 4. Construct AI Message
    const aiMsgObj: ChatMessage = {
      speaker: 'ai',
      text: aiResponse.message,
      timestamp: Date.now(),
      correction: aiResponse.correction,
      sceneFinished: aiResponse.sceneFinished,
      roleName: aiResponse.speaker || undefined,
    };

    // 5. Persist to Firestore (Atomic Update)
    const updateData: Record<string, any> = {
      chatHistory: FieldValue.arrayUnion(userMsgObj, aiMsgObj)
    };

    // If the AI says the scene is finished, update isObjectiveMet
    if (aiResponse.sceneFinished) {
      updateData.isObjectiveMet = true;
      updateData.isActive = false; // Auto-deactivate
    }

    await this.scenariosColRef(uid).doc(id).update(updateData);

    // 6. Return Full History (so frontend can sync)
    // We assume the frontend has the previous state, but returning full history is safer for sync
    const currentHistory = scenario.chatHistory || [];
    return [...currentHistory, userMsgObj, aiMsgObj];
  }


  private getInitialChatHistory(scenario: Scenario): ChatMessage[] {
    if (!scenario.dialogue || scenario.dialogue.length === 0) return [];

    const firstLine = scenario.dialogue[0];

    // Primary signal: explicit speakerRole, set directly by the generation
    // prompt — unambiguous regardless of what language/name the model chose
    // for the free-text `speaker` label. Fixes GitHub #213 (fuzzy string
    // matching between `speaker` and `roles.ai`/`roles.user` failed silently
    // whenever the two were in different languages, e.g. "店員" vs "Shop Assistant").
    if (firstLine.speakerRole) {
      if (firstLine.speakerRole === 'user') return [];
      return [{
        speaker: 'ai',
        text: firstLine.text,
        timestamp: Date.now(),
        roleName: firstLine.speaker,
      }];
    }

    // Fallback for scenarios generated before speakerRole existed.
    this.logger.warn(`getInitialChatHistory: dialogue[0] has no speakerRole (scenario ${scenario.id}, predates #213 fix) — falling back to fuzzy speaker-name matching`);

    let userRole: string;
    let aiRolesRaw: string | string[];

    if (scenario.roles?.user && scenario.roles?.ai) {
      userRole = scenario.roles.user;
      aiRolesRaw = scenario.roles.ai;
    } else {
      const roles = this.determineRoles(scenario.setting.participants);
      userRole = roles.userRole;
      aiRolesRaw = roles.aiRole;
    }

    const aiRoles = Array.isArray(aiRolesRaw) ? aiRolesRaw : [aiRolesRaw];
    const speaker = firstLine.speaker.toLowerCase();
    const user = userRole.toLowerCase();

    if (user.includes(speaker) || speaker.includes(user)) {
      return [];
    }

    const matchedAiRole = aiRoles.find(r => {
      const ai = r.toLowerCase();
      return ai.includes(speaker) || speaker.includes(ai);
    });

    if (matchedAiRole) {
      return [{
        speaker: 'ai',
        text: firstLine.text,
        timestamp: Date.now(),
        roleName: matchedAiRole,
      }];
    }

    return [];
  }

  // Helper method for evaluation
  private async generateEvaluation(scenario: Scenario): Promise<ScenarioEvaluation> {
    // 1. Determine Roles for Context
    let userRole = scenario.roles?.user;
    let aiRole = scenario.roles?.ai;

    if (!userRole || !aiRole) {
      const roles = this.determineRoles(scenario.setting.participants);
      userRole = roles.userRole;
      aiRole = roles.aiRole;
    }

    // 2. Prepare Context for Gemini Service
    const aiRoleStr = Array.isArray(aiRole) ? aiRole.join(', ') : aiRole;
    const context = {
      title: scenario.title,
      goal: scenario.setting.goal,
      difficulty: scenario.difficultyLevel,
      isObjectiveMet: scenario.isObjectiveMet ?? false,
      userRole,
      aiRole: aiRoleStr,
    };

    // 3. Prepare History (Map ChatMessage[] to simpler structure if needed, though interfaces align)
    const history = (scenario.chatHistory || []).map(msg => ({
      speaker: msg.speaker,
      text: msg.text
    }));

    // 4. Delegate to Gemini Service
    const evaluation = await this.geminiService.evaluateScenario(history, context);

    // 5. Apply Business Logic for Outcome
    // IF success AND rating >= 3 -> Passed
    // ELSE -> Failed
    if (evaluation.success && evaluation.rating >= 3) {
      evaluation.outcome = 'passed';
      evaluation.recommendedAction = 'replay_chat'; // or maybe just 'practice_roleplay'
    } else {
      evaluation.outcome = 'failed';
      evaluation.recommendedAction = 'repeat_lesson';
    }

    return evaluation;
  }

  /**
   * Mines new vocab/grammar from what the user actually said during the live
   * 'simulate' chat (as opposed to the AI-scripted 'encounter' dialogue), and
   * enrolls anything genuinely new via the same linking helpers 'encounter'
   * uses. Deliberately conservative: does not touch SRS/leech state, does not
   * create review facets — stops at the same enrollment depth 'encounter'
   * already stops at (UserKnowledgeUnit + UserGrammarLesson).
   */
  private async extractLiveChatKnowledge(
    uid: string,
    scenario: Scenario,
    evaluation: ScenarioEvaluation,
  ): Promise<{ extractedKUs: ExtractedKU[]; grammarMatches: GrammarMatch[] }> {
    const userLines = (scenario.chatHistory || [])
      .filter(msg => msg.speaker === 'user')
      .map(msg => msg.text);

    if (userLines.length === 0) {
      return { extractedKUs: [], grammarMatches: [] };
    }

    const prompt = buildLiveExtractionPrompt(scenario, userLines, evaluation.corrections ?? []);

    const data = await this.geminiService.generateWithTools<{ extractedKUs?: any[]; grammarMatches?: any[] }>(
      prompt,
      '',
      [GET_GRAMMAR_PATTERNS_DECLARATION],
      this.buildGrammarToolHandlers(uid),
      undefined,
      { route: '/scenarios/extract-live', topic: scenario.title },
    );

    const candidateKUs: ExtractedKU[] = Array.isArray(data.extractedKUs) ? data.extractedKUs : [];
    const candidateMatches: GrammarMatch[] = Array.isArray(data.grammarMatches) ? data.grammarMatches : [];

    // "New to this user" filter — grammar is already scoped to the user's own
    // enrolled pool by get_grammar_patterns, but vocab has no such scoping, so
    // skip anything the user already has a UserKnowledgeUnit for.
    const extractedKUs: ExtractedKU[] = [];
    for (const ku of candidateKUs) {
      const globalKu = await this.knowledgeUnitsService.findByContent(ku.content, 'Vocab');
      if (globalKu) {
        const existingUku = await this.userKnowledgeUnitsService.findByKuId(uid, globalKu.id);
        if (existingUku) continue;
      }
      extractedKUs.push(await this.linkVocabKu(uid, scenario, { ...ku, kuId: globalKu?.id }));
    }

    const grammarMatches: GrammarMatch[] = [];
    for (const match of candidateMatches) {
      if (await this.linkGrammarMatch(uid, scenario, match, 'scenario-live')) {
        grammarMatches.push(match);
      }
    }

    return { extractedKUs, grammarMatches };
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

  private determineRoles(participants: string[]): { aiRole: string; userRole: string } {
    if (!participants || participants.length === 0) {
      return { aiRole: 'Partner', userRole: 'Traveler' };
    }

    let userRole = participants.find(p => ALLOWED_USER_ROLES.some(k => p.toLowerCase().includes(k.toLowerCase())));
    let aiRole: string;

    if (userRole) {
      // AI is the other participant
      aiRole = participants.find(p => p !== userRole) || 'Partner';
    } else {
      // Try to find AI Role first
      const foundAiRole = participants.find(p => ALLOWED_AI_ROLES.some(k => p.toLowerCase().includes(k.toLowerCase())));

      if (foundAiRole && !userRole) {
        aiRole = foundAiRole;
        userRole = participants.find(p => p !== aiRole) || 'Traveler';
      } else {
        // Fallback: Assume index 1 is user (common in generated scenarios like ["Staff", "Traveler"])
        if (participants.length > 1) {
          userRole = participants[1];
          aiRole = participants[0];
        } else {
          // Only 1 participant?
          userRole = 'Traveler'; // Default
          aiRole = participants[0] || 'Partner';
        }
      }
    }

    this.logger.log(`AI Role: ${aiRole}, User Role: ${userRole}`);

    return { aiRole, userRole };
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