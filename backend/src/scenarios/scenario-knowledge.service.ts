import { Inject, Injectable, Logger } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { Scenario, ExtractedKU, GrammarMatch } from '../types/scenario';
import { FIRESTORE_CONNECTION, KNOWLEDGE_UNITS_COLLECTION, USER_KUS_SUBCOLLECTION } from '../firebase/firebase.module';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { LessonsService } from '../lessons/lessons.service';
import { UserService } from '../users/user.service';

/**
 * Ties a scenario's words and grammar to the learner's knowledge: the get_grammar_patterns tool
 * the AI calls, and enrolling extracted Vocab and matched Grammar. Shared by scenario generation,
 * the encounter → drill step and live-chat extraction.
 */
@Injectable()
export class ScenarioKnowledgeService {
  private readonly logger = new Logger(ScenarioKnowledgeService.name);

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
    private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
    private readonly lessonsService: LessonsService,
    private readonly userService: UserService,
  ) {}

  buildGrammarToolHandlers(uid: string) {
    return {
      get_grammar_patterns: async (args: Record<string, unknown>) => {
        const jlptLevel = (args.jlptLevel as string) || await this.userService.getJlptLevel(uid);

        // Fetch only grammar KUs the user has enrolled (and are not above their level)
        // Filtered in code, not with where('aboveLevel', '!=', true): Firestore's != skips
        // documents without the field (older enrolments, and new ones until the flag is written).
        const ukuSnap = await this.db
          .collection('users').doc(uid)
          .collection(USER_KUS_SUBCOLLECTION)
          .get();

        const enrolledKuIds = ukuSnap.docs.filter(d => d.data().aboveLevel !== true).map(d => d.data().kuId as string);
        if (enrolledKuIds.length === 0) {
          this.logger.log(`get_grammar_patterns(${jlptLevel}) → 0 enrolled patterns for uid=${uid}`);
          return { patterns: [] };
        }

        // Batch-fetch global KUs for enrolled IDs, filter to Grammar at the requested level
        const kuRefs = enrolledKuIds.map(id => this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(id));
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
  async linkVocabKu(uid: string, scenario: Scenario, ku: ExtractedKU): Promise<ExtractedKU> {
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

  /**
   * Live-chat extraction: links an extracted word only if it's new to this learner (no UKU yet).
   * Returns null when they already have it. Looks the word up once and hands the id to linkVocabKu.
   */
  async linkVocabIfNew(uid: string, scenario: Scenario, ku: ExtractedKU): Promise<ExtractedKU | null> {
    const globalKu = await this.knowledgeUnitsService.findByContent(ku.content, 'Vocab');
    if (globalKu && await this.userKnowledgeUnitsService.findByKuId(uid, globalKu.id)) return null;
    return this.linkVocabKu(uid, scenario, { ...ku, kuId: globalKu?.id });
  }

  /** Enroll a matched Grammar KU and write its context-example lesson. Idempotent (deterministic doc id). */
  async linkGrammarMatch(
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
}
