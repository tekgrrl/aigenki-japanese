import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { FIRESTORE_CONNECTION, LESSONS_COLLECTION, KNOWLEDGE_UNITS_COLLECTION, PICTURES_COLLECTION, USER_GRAMMAR_LESSONS_SUBCOLLECTION, USER_LESSONS_SUBCOLLECTION, USER_KUS_SUBCOLLECTION, FieldValue } from '../firebase/firebase.module';
import { Firestore, BulkWriter, Timestamp } from 'firebase-admin/firestore';
import { GeminiService } from '../gemini/gemini.service';
import { QuestionsService } from '../questions/questions.service';
import { KnowledgeUnit, Lesson, VocabLesson, VocabUsage, KanjiLesson, GrammarLesson, GrammarKnowledgeUnit, UserGrammarLesson, UserRoot } from '../types';
import { performance } from 'perf_hooks';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { ValidationService } from '../validation/validation.service';
import { buildVocabLessonMessage, buildVocabCacheContext } from '../prompts/vocab.prompts';
import { buildGrammarLessonMessage } from '../prompts/grammar.prompts';
import { ADMIN_USER_ID } from '../lib/constants';
import { KanjiService } from '../kanji/kanji.service';
import { isUsagePicture, subjectOf, usageKey } from '../pictures/pictures.service';
import { BuiltUsages, checkBuiltUsages, examplesFingerprint, withUncoveredSetAside, withUsageIds } from './vocab-usages';
import { FacetStore } from '../facets/facet-store';

function applyKuOverrides(lesson: Lesson, ku: KnowledgeUnit): Lesson {
  if (ku.type !== 'Grammar') return lesson;
  const overrides: Partial<GrammarLesson> = { pattern: ku.content };
  if (ku.data?.title) overrides.title = ku.data.title;
  return { ...lesson, ...overrides } as Lesson;
}

/**
 * Read-time twin of generateLesson's component_kanji safety net: a "component" kanji
 * that isn't a character of the word itself (斯 on こう, 珈琲 on コーヒー) is wrong by
 * definition. Lessons generated before that net existed still store them, and would
 * otherwise get them taught as kanji-component facets and slides.
 */
export function dropStrayComponentKanji(lesson: Lesson): Lesson {
  if (lesson.type !== 'Vocab' || !Array.isArray(lesson.component_kanji)) return lesson;
  const { kept, dropped } = splitComponentKanji(lesson.vocab, lesson.component_kanji);
  return dropped.length === 0 ? lesson : { ...lesson, component_kanji: kept };
}

/**
 * Splits component kanji into those that are characters of `word` and those that
 * aren't. With no word to check against, nothing is dropped — better to keep a stray
 * than to strip every real component.
 */
export function splitComponentKanji<T extends { kanji?: string }>(
  word: string | undefined,
  components: T[],
): { kept: T[]; dropped: T[] } {
  if (!word) return { kept: components, dropped: [] };
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const k of components) (k?.kanji && word.includes(k.kanji) ? kept : dropped).push(k);
  return { kept, dropped };
}

/** Start Learning serves at most this many waiting items per session; the rest come next time. */
const WAITING_PER_SESSION = 10;

/** buildVocabUsages / saveBuiltUsages: one label per example, and the usages if they were written. */
export type BuildUsagesResult = {
  usages: (string | null)[];
  saved: boolean;
  built?: { usages: VocabUsage[]; usageSetAside: string[] };
};

@Injectable()
export class LessonsService {
  private readonly logger = new Logger(LessonsService.name);

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly facetStore: FacetStore,
    private readonly geminiService: GeminiService,
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
    private readonly validationService: ValidationService,
    private readonly kanjiService: KanjiService,
  ) { }

  async generateLesson(uid: string, kuId: string, cachedContentName?: string) {
    this.logger.log(`in generateLesson(): kuId=${kuId}, cachedContentName=${cachedContentName}`);
    // 1. Fetch the KU
    const kuRef = this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(kuId);
    const kuDoc = await kuRef.get();
    if (!kuDoc.exists) {
      this.logger.error(`KnowledgeUnit ${kuId} not found`);
      return { error: "KnowledgeUnit not found" }; // TODO is this ok?
    }

    const ku = kuDoc.data() as KnowledgeUnit;

    // Kanji lessons are never AI-generated — always sourced live from Kanji Alive,
    // same as the top-level Kanji enrollment path (GET /api/kanji/details). No
    // lessons/{kuId} caching here, matching that path's always-fresh behavior.
    if (ku.type === "Kanji") {
      return this.kanjiService.getKanjiDetails(uid, ku.content, kuId);
    }

    const userDoc = await this.db.collection('users').doc(uid).get();
    const jlptLevel: string = (userDoc.data() as any)?.preferences?.jlptLevel ?? 'N5';

    const content = ku.content;

    const lessonDbRef = this.db.collection(LESSONS_COLLECTION).doc(kuId);
    const overlayRef = this.db.collection('users').doc(uid).collection(USER_LESSONS_SUBCOLLECTION).doc(kuId);

    // Check for lesson in 'lessons' collection
    const [lessonDoc, overlayDoc] = await Promise.all([lessonDbRef.get(), overlayRef.get()]);
    // Return existing lesson if it's completed OR if it has no status (legacy lesson)
    if (lessonDoc.exists && (lessonDoc.data()?.status === 'completed' || !lessonDoc.data()?.status)) {
      this.logger.log(`Returning existing lesson for KU ${kuId} from lessons collection`);
      const data = lessonDoc.data()!;
      if (data.userId) {
        void lessonDbRef.update({ userId: FieldValue.delete() });
        delete data.userId;
      }
      const merged = overlayDoc.exists ? { ...data, ...overlayDoc.data() } : data;
      return applyKuOverrides(dropStrayComponentKanji(merged as Lesson), ku);
    }

    this.logger.log(`No existing lesson for KU ${kuId}. Generating new lesson`);

    let userMessage: string;

    if (ku.type === "Grammar") {
      const grammarKu = ku as GrammarKnowledgeUnit;
      userMessage = buildGrammarLessonMessage(grammarKu, jlptLevel);

      const lessonString = await this.geminiService.generateLesson(userMessage, { content: grammarKu.content, kuId }, undefined);
      if (!lessonString) throw new Error('AI response was empty.');

      let lessonJson: GrammarLesson;
      try {
        lessonJson = JSON.parse(lessonString) as GrammarLesson;
        lessonJson.kuId = kuId;
      } catch {
        this.logger.error('Failed to parse Grammar lesson JSON', lessonString);
        throw new Error('Failed to parse AI JSON response for grammar lesson');
      }

      await lessonDbRef.set(lessonJson);

      void this.validateAndFlagLesson(uid, kuId, 'Grammar', ku.content, lessonJson, jlptLevel);

      return applyKuOverrides(lessonJson, ku);
    }

    // TODO: pass ku.data.corpusNotes into buildVocabLessonMessage so Vocab corpus
    // notes are injected into the prompt, mirroring how Grammar uses corpusNotes.
    userMessage = buildVocabLessonMessage(ku.content, !!cachedContentName, jlptLevel);

    const lessonString = await this.geminiService.generateLesson(
      userMessage,
      { content, kuId },
      cachedContentName
    );

    if (!lessonString) {
      this.logger.error("AI response was empty.");
      throw new Error("AI response was empty.");
    }

    let lessonJson: Lesson | undefined;

    try {
      lessonJson = JSON.parse(lessonString) as Lesson;
      (lessonJson as VocabLesson | KanjiLesson).kuId = kuId;

      // --- MERGE USER DEFINITIONS (if Vocab) ---
      // Rely on the KnowledgeUnit type, which is the source of truth
      if (ku.type === "Vocab") {
        const userDefinitions = ku.data.definition
          ? ku.data.definition.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0)
          : [];

        // Ensure definitions array exists
        if (!Array.isArray((lessonJson as any).definitions)) {
          (lessonJson as any).definitions = [];
        }

        const aiDefinitions = (lessonJson as any).definitions || [];

        // Deduplicate (case-insensitive)
        const combined = [...userDefinitions, ...aiDefinitions];
        const uniqueDefinitions = combined.reduce<string[]>((acc, curr) => {
          if (!acc.some(d => d.toLowerCase() === curr.toLowerCase())) {
            acc.push(curr);
          }
          return acc;
        }, []);

        (lessonJson as any).definitions = uniqueDefinitions;

        // Backward compatibility for definition field
        if ((lessonJson as any).definitions.length > 0) {
          (lessonJson as any).definition = (lessonJson as any).definitions.join(', ');
        }

        // Safety net: the prompt already instructs the model to leave component_kanji
        // empty for words normally written in kana (and even names examples), but it
        // doesn't reliably comply — seen in practice for くれる, which got a component
        // kanji (呉) that doesn't appear anywhere in the word's own kana spelling. Any
        // listed "component" kanji that isn't actually a character in the vocab string
        // is definitionally wrong, so filter those out regardless of what the model said.
        const vocabText: string = (lessonJson as any).vocab ?? '';
        const componentKanji = (lessonJson as any).component_kanji;
        if (Array.isArray(componentKanji)) {
          const { kept, dropped } = splitComponentKanji(vocabText, componentKanji);
          if (dropped.length > 0) {
            this.logger.warn(
              `Dropping invalid component_kanji for "${vocabText}" (kuId=${kuId}): ` +
              `${dropped.map((k: any) => k?.kanji).join(', ')} not found in the word itself`,
            );
          }
          (lessonJson as any).component_kanji = kept;
        }

        // Stronger enforcement than the heuristic above: kanaOnly is an explicit
        // "never use this word's kanji breakdown" decision (AI-set at generation time,
        // or curated manually via the admin editor). Don't trust that the model actually
        // left component_kanji empty just because it also set kanaOnly — force it.
        if ((lessonJson as any).kanaOnly === true && Array.isArray((lessonJson as any).component_kanji) && (lessonJson as any).component_kanji.length > 0) {
          this.logger.warn(`kanaOnly=true but component_kanji was non-empty for "${vocabText}" (kuId=${kuId}) — clearing`);
          (lessonJson as any).component_kanji = [];
        }
      }

    } catch (parseError) {
      this.logger.error("Failed to parse AI JSON response for lesson", {
        lessonString,
        parseError,
      });
      throw new Error("Failed to parse AI JSON response for lesson");
    }

    // --- SAVE TO 'lessons' collection ---
    await lessonDbRef.set(lessonJson);

    // Build the word's usages before returning, so the lesson comes back with them (and Start
    // Learning's lazy build has nothing to do). Not for batch runs: their BulkWriter rewrites the
    // lesson (examples included) after this returns, which would drop the usage ids.
    if (ku.type === 'Vocab' && !cachedContentName) {
      try {
        const r = await this.buildVocabUsages(kuId);
        if (r.built) {
          const vl = lessonJson as VocabLesson;
          vl.usages = r.built.usages;
          vl.usageSetAside = r.built.usageSetAside;
          vl.context_examples = (vl.context_examples ?? []).map((e, i) => {
            const label = r.usages[i];
            const usage = r.built!.usages.find(u => u.label === label);
            return usage ? { ...e, usage: usage.label, usageId: usage.id } : e;
          });
        }
      } catch (e) {
        this.logger.error(`buildVocabUsages failed for ${kuId}`, e);
      }
    }

    void this.validateAndFlagLesson(uid, kuId, ku.type, ku.content, lessonJson, jlptLevel);

    // --- UPDATE KU WITH LESSON DATA ---
    if (ku.type === 'Vocab') {
      const vocabLesson = lessonJson as VocabLesson;
      const updates: Record<string, any> = {};

      // Use dot notation to update nested data fields without overwriting the map
      if (vocabLesson.reading) {
        updates['data.reading'] = vocabLesson.reading;
      }

      // definition is populated above by joining definitions
      if (vocabLesson.definition) {
        updates['data.definition'] = vocabLesson.definition;
      }

      if (vocabLesson.conjugationType) {
        updates['data.conjugationType'] = vocabLesson.conjugationType;
      }

      if (Object.keys(updates).length > 0) {
        try {
          this.logger.log(`Updating KU ${kuId} with lesson data: ${JSON.stringify(updates)}`);
          await this.knowledgeUnitsService.update(kuId, updates);
        } catch (e) {
          console.log(e);
          this.logger.error(`Failed to backfill KU ${kuId} with lesson data`, e);
          // Don't fail the response, just log error
        }
      }
    }

    return lessonJson;
  }

  /** Parses a raw section value the same way both write paths below do: JSON if it looks like an object/array literal, else left as-is. */
  private parseSectionValue(content: any): any {
    if (typeof content !== 'string') return content;
    try {
      const trimmed = content.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        return JSON.parse(content);
      }
    } catch (e) {
      // not valid JSON — fall through and save as the raw string
    }
    return content;
  }

  /**
   * Builds a Vocab lesson's usages (lazy backfill, and after generation): each usage gets a
   * stable id, a label, the literal answer and accepted answers, and each example points at its
   * usage. Examples aren't rewritten. A label that has a picture is kept verbatim, because
   * pictures match usages by label; every other label may be merged or renamed. A no-op if
   * usages already exist, unless `force` (admin "Relabel usages"), which regroups from scratch
   * (pictured labels still kept) and keeps the ids of usages whose label survives. A lazy build
   * isn't retried after a rejection until the examples change.
   * Returns one label per example (the Start Learning slideshow uses them) and what was built.
   */
  async buildVocabUsages(kuId: string, force = false): Promise<BuildUsagesResult> {
    const lessonRef = this.db.collection(LESSONS_COLLECTION).doc(kuId);
    const doc = await lessonRef.get();
    if (!doc.exists) throw new NotFoundException('Lesson not found');
    const lesson = doc.data() as VocabLesson;
    const examples = lesson.context_examples ?? [];
    if (lesson.type !== 'Vocab') throw new BadRequestException('Only Vocab lessons have usages');

    const current = examples.map(e => e.usage ?? null);
    const built = (lesson.usages?.length ?? 0) > 0 && examples.every(e => e.usageId);
    if (examples.length === 0 || (!force && built)) return { usages: current, saved: false };
    const rejected = lesson.usageBuildRejected === examplesFingerprint(examples.map(e => e.sentence));
    if (!force && rejected) return { usages: current, saved: false };

    const fixedLabels = await this.pictureFixedLabels(kuId, current);
    const raw = await this.geminiService.buildExampleUsages(
      lesson.vocab,
      lesson.definitions ?? [],
      examples.map(e => ({ sentence: e.sentence, translation: e.translation })),
      fixedLabels,
      kuId,
      lesson.partOfSpeech,
    );
    if (!raw) return { usages: current, saved: false };
    return this.saveBuiltUsages(kuId, raw, examples.map(e => e.sentence), fixedLabels);
  }

  /** Per example: its label if a (non-rejected) picture is attached to that label, else null. */
  private async pictureFixedLabels(kuId: string, labels: (string | null)[]): Promise<(string | null)[]> {
    const pics = await this.db.collection(PICTURES_COLLECTION).where('kuId', '==', kuId).get();
    const pictured = new Set(
      pics.docs
        .map(d => d.data())
        .filter(p => p.status !== 'rejected' && subjectOf(p).kind === 'ku-usage')
        .map(p => usageKey(subjectOf(p).usage)),
    );
    return labels.map(l => (l && pictured.has(usageKey(l)) ? l : null));
  }

  /**
   * Checks the usage-building prompt's output and writes it: usage ids (kept for labels that
   * survive), the usages, and each example's usage. `sentences` and `fixedLabels` are what the
   * prompt was given; nothing is written if the lesson's examples have changed since. Used
   * straight after the Gemini call, and by scripts/build-usages.ts to apply a reviewed dry run.
   */
  async saveBuiltUsages(
    kuId: string,
    raw: unknown,
    sentences: string[],
    fixedLabels: (string | null)[],
  ): Promise<BuildUsagesResult> {
    const lessonRef = this.db.collection(LESSONS_COLLECTION).doc(kuId);
    const lesson = (await lessonRef.get()).data() as VocabLesson | undefined;
    const current = (lesson?.context_examples ?? []).map(e => e.usage ?? null);
    if (!lesson) return { usages: current, saved: false };

    let checked: BuiltUsages;
    try {
      checked = withUncoveredSetAside(checkBuiltUsages(raw, sentences.length, fixedLabels), lesson.definitions ?? []);
    } catch (e) {
      this.logger.warn(`Usages for ${lesson.vocab} (${kuId}) rejected: ${(e as Error).message}`);
      // Remembered so lazy builds don't call Gemini again for the same examples.
      await lessonRef.update({ usageBuildRejected: examplesFingerprint(sentences) }).catch(() => undefined);
      return { usages: current, saved: false };
    }
    let usages: VocabUsage[] = [];

    // A regenerate or admin edit may have replaced the examples (or their labels) since the
    // prompt was given them. Only write if they're still the same.
    const unchanged = (fresh: VocabLesson['context_examples'] = []) =>
      fresh.length === sentences.length &&
      fresh.every((e, i) => e.sentence === sentences[i] && (!fixedLabels[i] || usageKey(e.usage) === usageKey(fixedLabels[i])));
    const written = await this.db.runTransaction(async tx => {
      const fresh = (await tx.get(lessonRef)).data() as VocabLesson | undefined;
      if (!fresh || !unchanged(fresh.context_examples)) return false;
      // Ids from what's stored now, so a concurrent build's ids are kept, not replaced.
      usages = withUsageIds(checked.usages, fresh.usages);
      tx.update(lessonRef, {
        usages,
        usageSetAside: checked.setAside,
        usageBuildRejected: FieldValue.delete(),
        context_examples: (fresh.context_examples ?? []).map((e, i) => {
          const u = usages[checked.exampleUsages[i]];
          return { ...e, usage: u.label, usageId: u.id };
        }),
      });
      return true;
    });
    if (!written) {
      this.logger.warn(`Examples for ${lesson.vocab} (${kuId}) changed since its usages were built; not saved`);
      return { usages: current, saved: false };
    }
    this.logger.log(`Built ${usages.length} usages for ${lesson.vocab} (${kuId}): ${usages.map(u => `${u.label} = ${u.meaning}`).join(' | ')}`);
    return {
      usages: checked.exampleUsages.map(i => usages[i].label),
      saved: true,
      built: { usages, usageSetAside: checked.setAside },
    };
  }

  /**
   * Lazy furigana for a Grammar lesson's examples (they were generated without readings).
   * Each annotation must strip back to its sentence exactly, or that example stays plain.
   * Idempotent: examples that already have `furigana` aren't re-annotated.
   */
  async addGrammarFurigana(kuId: string): Promise<{ furigana: (string | null)[]; saved: boolean }> {
    const lessonRef = this.db.collection(LESSONS_COLLECTION).doc(kuId);
    const doc = await lessonRef.get();
    if (!doc.exists) throw new NotFoundException('Lesson not found');
    const lesson = doc.data() as GrammarLesson;
    if (lesson.type !== 'Grammar') throw new BadRequestException('Only Grammar lessons are annotated here');
    const examples = lesson.examples ?? [];
    const current = examples.map(e => e.furigana ?? null);
    const missing = examples.map((e, i) => (e.furigana ? -1 : i)).filter(i => i >= 0);
    if (missing.length === 0) return { furigana: current, saved: false };

    let annotated: string[];
    try {
      annotated = await this.geminiService.addFurigana(missing.map(i => examples[i].japanese), kuId);
    } catch (e) {
      this.logger.error(`Furigana failed for Grammar lesson ${kuId}`, e);
      return { furigana: current, saved: false };
    }
    const result = [...current];
    missing.forEach((exIdx, k) => {
      const ok = isValidFurigana(examples[exIdx].japanese, annotated[k]);
      if (!ok) this.logger.warn(`Furigana rejected for ${kuId} example ${exIdx}: ${annotated[k]}`);
      result[exIdx] = ok ? annotated[k] : null;
    });

    // Only write if the examples are still the ones annotated (a regenerate may have run).
    const written = await this.db.runTransaction(async tx => {
      const fresh = (await tx.get(lessonRef)).data() as GrammarLesson | undefined;
      const freshEx = fresh?.examples ?? [];
      if (!fresh || freshEx.length !== examples.length || freshEx.some((e, i) => e.japanese !== examples[i].japanese)) return false;
      tx.update(lessonRef, {
        examples: freshEx.map((e, i) => (result[i] && !e.furigana ? { ...e, furigana: result[i] } : e)),
      });
      return true;
    });
    if (!written) this.logger.warn(`Examples for Grammar lesson ${kuId} changed during furigana; not saved`);
    return { furigana: result, saved: written };
  }

  private async writeGlobalLesson(kuId: string, updates: Record<string, any>): Promise<void> {
    if (Object.keys(updates).length === 0) return;

    const lessonRef = this.db.collection(LESSONS_COLLECTION).doc(kuId);
    const lessonDoc = await lessonRef.get();
    if (!lessonDoc.exists) throw new NotFoundException('Lesson not found');

    const parsed: Record<string, any> = {};
    for (const [section, value] of Object.entries(updates)) {
      parsed[section] = this.parseSectionValue(value);
    }

    // Same invariant as generateLesson's safety net: kanaOnly=true must mean
    // component_kanji is empty. The admin editor always sends both fields together
    // on save, so enforcing within this single update is sufficient — no need to
    // read back existing Firestore state.
    if (parsed.kanaOnly === true) {
      parsed.component_kanji = [];
    }

    await lessonRef.update(parsed);
  }

  async updateLesson(uid: string, kuId: string, section: string, content: string) {
    const isAdmin = uid === ADMIN_USER_ID || process.env.ADMIN_ALL === 'true';
    if (isAdmin) {
      await this.writeGlobalLesson(kuId, { [section]: content });
    } else {
      const lessonDoc = await this.db.collection(LESSONS_COLLECTION).doc(kuId).get();
      if (!lessonDoc.exists) throw new NotFoundException('Lesson not found');
      const overlayRef = this.db.collection('users').doc(uid).collection(USER_LESSONS_SUBCOLLECTION).doc(kuId);
      await overlayRef.set({ [section]: this.parseSectionValue(content) }, { merge: true });
    }

    return { success: true };
  }

  /** Admin-only: batched write of multiple lesson sections to global data in a single Firestore update. */
  async updateGlobalLesson(kuId: string, updates: Record<string, any>) {
    await this.writeGlobalLesson(kuId, updates);
    return { success: true };
  }

  async findByKuId(uid: string, kuId: string): Promise<Lesson | null> {
    const [lessonDoc, overlayDoc] = await Promise.all([
      this.db.collection(LESSONS_COLLECTION).doc(kuId).get(),
      this.db.collection('users').doc(uid).collection(USER_LESSONS_SUBCOLLECTION).doc(kuId).get(),
    ]);

    if (!lessonDoc.exists) return null;

    const lesson = lessonDoc.data() as Lesson;
    return dropStrayComponentKanji(
      overlayDoc.exists ? { ...lesson, ...overlayDoc.data() } as Lesson : lesson,
    );
  }

  async createUserGrammarLesson(
    uid: string,
    kuId: string,
    source: { sourceType: 'scenario' | 'concept' | 'scenario-live'; sourceId: string; sourceTitle: string },
    contextExample: { japanese: string; english: string; fragments: string[]; accepted_alternatives: string[] },
  ): Promise<UserGrammarLesson> {
    const docId = `${kuId}_${source.sourceType}_${source.sourceId}`;
    const ref = this.db.collection('users').doc(uid).collection(USER_GRAMMAR_LESSONS_SUBCOLLECTION).doc(docId);

    const data: Omit<UserGrammarLesson, 'id'> = {
      kuId,
      lessonId: kuId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceTitle: source.sourceTitle,
      contextExample,
      createdAt: Timestamp.now(),
    };

    await ref.set(data, { merge: false });
    this.logger.log(`Created UserGrammarLesson ${docId} for uid=${uid} kuId=${kuId}`);
    return { id: docId, ...data };
  }

  async getUserGrammarLessons(uid: string, kuId: string): Promise<UserGrammarLesson[]> {
    const snapshot = await this.db
      .collection('users').doc(uid)
      .collection(USER_GRAMMAR_LESSONS_SUBCOLLECTION)
      .where('kuId', '==', kuId)
      .get();

    if (snapshot.empty) return [];
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as unknown as UserGrammarLesson);
  }


  async getQueue(uid: string): Promise<{ kuId: string; content: string; type: string }[]> {
    // Start Learning services the user's own queue first: everything already waiting
    // (status 'learning' — the "Available lessons" count), and only that. New corpus
    // items are added only when nothing is waiting.
    const waiting = await this.getWaitingLessons(uid);
    if (waiting.length > 0) return waiting;

    const userDoc = await this.db.collection('users').doc(uid).get();
    const jlptLevel = (userDoc.data() as UserRoot | undefined)?.preferences?.jlptLevel ?? 'N5';

    const facetsCol = this.facetStore.query(uid);

    const [facetsSnap, ukuSnap] = await Promise.all([
      facetsCol.get(),
      this.db.collection('users').doc(uid).collection('user-kus').get(),
    ]);

    // Separate facet KU ids from UKU KU ids so we can compute enrolled-but-not-started.
    // A facet can be "started" for two different KUs at once: the word whose sequence
    // it belongs to (source.id) and the specific content it targets (kuId) — these
    // differ for Kanji-Component-* facets, which target the component kanji's own kuId
    // while being gated by the parent Vocab word's source.id (see
    // ReviewProgressService.getFacetsAtStage). Registering only one of the two
    // incorrectly leaves the other looking "enrolled but never started" forever —
    // track both so neither the parent word nor the component kanji gets stuck.
    const facetKuIds = new Set<string>();
    facetsSnap.docs.forEach(d => {
      const data = d.data();
      if (data.kuId) facetKuIds.add(data.kuId as string);
      if (data.source?.id) facetKuIds.add(data.source.id as string);
    });
    const ukuKuIds = ukuSnap.docs.map(d => d.data().kuId as string).filter(Boolean);
    const seenKuIds = new Set([...facetKuIds, ...ukuKuIds]);

    // ── Path 1a: Vocab / Kanji corpus ─────────────────────────────────────
    // ── Path 1b: Grammar corpus ────────────────────────────────────────────
    // Run separately so Grammar always gets guaranteed slots regardless of
    // how many Vocab/Kanji items exist at the same JLPT level.
    const [vocabKanjiSnap, grammarCorpusSnap] = await Promise.all([
      this.db.collection(KNOWLEDGE_UNITS_COLLECTION)
        .where('data.jlptLevel', '==', jlptLevel)
        .where('type', 'in', ['Vocab', 'Kanji'])
        .limit(200)
        .get(),
      this.db.collection(KNOWLEDGE_UNITS_COLLECTION)
        .where('data.jlptLevel', '==', jlptLevel)
        .where('type', '==', 'Grammar')
        .limit(50)
        .get(),
    ]);

    // Audio-first experiment: Vocab at the user's level that has approved pictures comes
    // first, so the experiment's words actually reach the learner. Fetched directly — the
    // corpus query above only samples the first 200 at the level.
    let picturedDocs: FirebaseFirestore.DocumentSnapshot[] = [];
    if ((userDoc.data() as UserRoot | undefined)?.preferences?.audioFirstExperiment === true) {
      const pics = await this.db.collection(PICTURES_COLLECTION).where('status', '==', 'approved').select('kuId', 'subject').get();
      // Usage pictures only: free-standing ones have kuId null, and whole-KU ones aren't cards.
      const ids = [...new Set(pics.docs.filter(d => isUsagePicture(d.data())).map(d => d.data().kuId as string))].filter(id => !seenKuIds.has(id));
      if (ids.length) {
        const kuCol = this.db.collection(KNOWLEDGE_UNITS_COLLECTION);
        picturedDocs = (await this.db.getAll(...ids.map(id => kuCol.doc(id))))
          .filter(d => d.exists && d.data()?.type === 'Vocab' && d.data()?.data?.jlptLevel === jlptLevel);
      }
    }
    const pictured = new Set(picturedDocs.map(d => d.id));
    const vocabKanjiItems = [...picturedDocs, ...vocabKanjiSnap.docs.filter(d => !pictured.has(d.id))]
      .filter(d => !seenKuIds.has(d.id))
      .slice(0, 7)
      .map(d => ({ kuId: d.id, content: d.data()?.content as string, type: d.data()?.type as string }));

    const grammarCorpusItems = grammarCorpusSnap.docs
      .filter(d => !seenKuIds.has(d.id))
      .slice(0, 3)
      .map(d => ({ kuId: d.id, content: d.data().content as string, type: d.data().type as string }));

    // ── Path 2: Enrolled-but-not-started queue ────────────────────────────
    // KUs the user enrolled (via a scenario, or the "help me learn this" flag
    // flow) but hasn't started in review yet (UKU exists, no facets). Covers
    // all types, not just Grammar — a flagged Vocab word with zero facets
    // would otherwise never surface here at all (seenKuIds already excludes
    // it from the fresh-corpus pool below).
    const enrolledNotStarted = ukuKuIds.filter(id => !facetKuIds.has(id));

    let enrolledGrammarItems: { kuId: string; content: string; type: string }[] = [];
    let enrolledVocabKanjiItems: { kuId: string; content: string; type: string }[] = [];
    if (enrolledNotStarted.length > 0) {
      const chunk = enrolledNotStarted.slice(0, 30);
      const enrolledSnap = await this.db.collection(KNOWLEDGE_UNITS_COLLECTION)
        .where('__name__', 'in', chunk)
        .get();
      enrolledGrammarItems = enrolledSnap.docs
        .filter(d => d.data().type === 'Grammar')
        .slice(0, 3)
        .map(d => ({ kuId: d.id, content: d.data().content as string, type: d.data().type as string }));
      enrolledVocabKanjiItems = enrolledSnap.docs
        .filter(d => d.data().type === 'Vocab' || d.data().type === 'Kanji')
        .slice(0, 3)
        .map(d => ({ kuId: d.id, content: d.data().content as string, type: d.data().type as string }));
    }

    // Enrolled grammar first, then corpus grammar, then enrolled vocab/kanji, then corpus vocab/kanji
    const grammarItems = [
      ...enrolledGrammarItems,
      ...grammarCorpusItems.filter(g => !enrolledGrammarItems.some(e => e.kuId === g.kuId)),
    ].slice(0, 3);

    const combinedVocabKanjiItems = [
      ...enrolledVocabKanjiItems,
      ...vocabKanjiItems.filter(v => !enrolledVocabKanjiItems.some(e => e.kuId === v.kuId)),
    ].slice(0, 7);

    return [...grammarItems, ...combinedVocabKanjiItems].slice(0, 10);
  }

  /**
   * The user's KUs waiting for a lesson, oldest enrolment first, at most WAITING_PER_SESSION.
   * Waiting = UKU status 'learning' AND no facets yet (by kuId or source.id, as in Path 2
   * below). The status is a cache: a stale 'learning' on a word that already has facets
   * (e.g. written before kanji-component facets counted toward their word) would otherwise
   * be served every session, since enrollment skips a word that's already started.
   * Deleted KUs are skipped.
   */
  private async getWaitingLessons(uid: string): Promise<{ kuId: string; content: string; type: string }[]> {
    const ukuSnap = await this.db.collection('users').doc(uid).collection(USER_KUS_SUBCOLLECTION)
      .where('status', '==', 'learning')
      .get();
    if (ukuSnap.empty) return [];

    const facetsCol = this.facetStore.query(uid);
    const started = new Set<string>();
    (await facetsCol.select('kuId', 'source').get()).docs.forEach(d => {
      const f = d.data();
      if (f.kuId) started.add(f.kuId as string);
      if (f.source?.id) started.add(f.source.id as string);
    });

    const millis = (t: any) => (typeof t?.toMillis === 'function' ? t.toMillis() : (t?.seconds ?? t?._seconds ?? 0) * 1000);
    const candidates = ukuSnap.docs.map(d => d.data())
      .filter(u => u.kuId && !started.has(u.kuId as string))
      .sort((a, b) => millis(a.createdAt) - millis(b.createdAt));

    // Read in chunks until enough live KUs are found: a run of UKUs whose KU was deleted
    // must not hide newer waiting words.
    const kuCol = this.db.collection(KNOWLEDGE_UNITS_COLLECTION);
    const found: { kuId: string; content: string; type: string }[] = [];
    for (let i = 0; i < candidates.length && found.length < WAITING_PER_SESSION; i += 50) {
      const chunk = candidates.slice(i, i + 50);
      const kuDocs = await this.db.getAll(...chunk.map(u => kuCol.doc(u.kuId as string)));
      for (const d of kuDocs) {
        if (d.exists) found.push({ kuId: d.id, content: d.data()!.content as string, type: d.data()!.type as string });
      }
    }
    return found.slice(0, WAITING_PER_SESSION);
  }

  async processBatch(uid: string, vocabValues: { id: string; content: string }[]) {
    const userDoc = await this.db.collection('users').doc(uid).get();
    const batchJlptLevel: string = (userDoc.data() as any)?.preferences?.jlptLevel ?? 'N5';

    const cacheName = await this.geminiService.createContextCache(
      buildVocabCacheContext(batchJlptLevel),
      3600
    );

    this.logger.log(`Created Context Cache: ${cacheName} for batch processing`);
    const bulkWriter = this.db.bulkWriter();

    let processedCount = 0;
    const totalItems = vocabValues.length;

    try {
      for (const item of vocabValues) {
        processedCount++;
        this.logger.log(`[Batch ${processedCount}/${totalItems}] Processing item: ${item.content} (${item.id})`);

        try {
          const lessonRef = this.db.collection(LESSONS_COLLECTION).doc(item.id);
          const lessonDoc = await lessonRef.get();
          const lessonData = lessonDoc.data();

          // Skip if lesson exists and is not marked as failed.
          // This creates a "resume" capability and prevents overwriting legacy lessons (undefined status)
          // or lessons that are currently generating/completed.
          if (lessonDoc.exists && lessonData?.status !== 'failed') {
            this.logger.log(`Skipping ${item.content} - already exists (Status: ${lessonData?.status ?? 'legacy'})`);
            continue;
          }

          // Set status to generating
          await lessonRef.set({
            kuId: item.id,
            status: 'generating',
            createdAt: new Date(),
          }, { merge: true });

          // --- GENERATE ---
          this.logger.log(`Generating lesson for ${item.content} using cache ${cacheName}`);
          const lesson = await this.generateLesson(uid, item.id, cacheName);

          // --- SAVE ---
          void bulkWriter.set(lessonRef, {
            ...lesson,
            status: 'completed'
          }, { merge: true });

          this.logger.log(`Successfully generated and queued write for ${item.content}`);

          // --- RATE LIMIT DELAY (Trickle) ---
          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (err) {
          this.logger.error(`Failed to process item ${item.content}`, err);
          const lessonRef = this.db.collection(LESSONS_COLLECTION).doc(item.id);
          // Mark as failed so it can be retried later
          void bulkWriter.set(lessonRef, { status: 'failed', error: (err as Error).message }, { merge: true });
        }
      }

      this.logger.log('Batch iteration completed. Waiting for BulkWriter to flush...');

    } catch (e) {
      this.logger.error('Critical Error in processBatch loop', e);
    } finally {
      // Ensure BulkWriter is closed to commit all changes
      try {
        await bulkWriter.close();
        this.logger.log('BulkWriter closed successfully. Batch processing finished.');
      } catch (closeError) {
        this.logger.error('Failed to close BulkWriter', closeError);
      }

      // Cleanup Cache
      try {
        await this.geminiService.deleteContextCache(cacheName);
        this.logger.log(`Deleted Context Cache: ${cacheName}`);
      } catch (cacheError) {
        this.logger.error(`Failed to delete Context Cache: ${cacheName}`, cacheError);
      }
    }
  }

  async regenerateLesson(uid: string, kuId: string): Promise<Lesson> {
    const lessonRef = this.db.collection(LESSONS_COLLECTION).doc(kuId);
    await lessonRef.set({ status: 'failed' }, { merge: true });
    return this.generateLesson(uid, kuId) as Promise<Lesson>;
  }

  private async validateAndFlagLesson(
    uid: string,
    kuId: string,
    kuType: string,
    kuContent: string,
    lesson: Lesson,
    jlptLevel: string,
  ): Promise<void> {
    try {
      let segments: string[] = [];
      if (kuType === 'Vocab') {
        segments = ((lesson as VocabLesson).context_examples ?? [])
          .map(e => e.sentence)
          .filter(Boolean);
      } else if (kuType === 'Grammar') {
        segments = ((lesson as GrammarLesson).examples ?? [])
          .map(e => e.japanese)
          .filter(Boolean);
      }

      if (segments.length === 0) return;

      const result = await this.validationService.validateContent(segments, jlptLevel, uid);
      await this.validationService.flagLesson(kuId, kuContent, jlptLevel, result);
    } catch (err) {
      this.logger.error(`Lesson validation failed for kuId=${kuId}`, err);
    }
  }
}

/**
 * A furigana annotation is valid when removing its [reading]s gives back the sentence
 * exactly, and every reading is hiragana directly after kanji (what FuriganaText renders).
 */
export function isValidFurigana(sentence: string, annotated: string | undefined): boolean {
  if (typeof annotated !== 'string') return false;
  if (annotated.replace(/\[[^\]]*\]/g, '') !== sentence) return false;
  const brackets = annotated.match(/\[[^\]]*\]/g) ?? [];
  const valid = annotated.match(/[\u4e00-\u9faf\u3005]\[[ぁ-ゖー]+\]/g) ?? [];
  return brackets.length === valid.length;
}
