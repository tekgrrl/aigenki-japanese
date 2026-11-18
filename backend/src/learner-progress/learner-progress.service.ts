import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION, KNOWLEDGE_UNITS_COLLECTION, QUESTIONS_COLLECTION, USER_KUS_SUBCOLLECTION, FieldValue } from '../firebase/firebase.module';
import type { QuestionItem } from '../types';
import { FacetStore } from '../facets/facet-store';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { conjugate, FORM_GROUPS, parseSkillId, skillId, slotForms, VERB_FORMS, VerbForm, Verb } from '../lib/verb-forms';
import { SkillAttempt, SkillState, skillState } from './skill-rules';

export const SKILL_EVIDENCE_SUBCOLLECTION = 'skill-evidence';

export interface SkillProgress {
  skillId: string;
  form: VerbForm;
  group: string;
  label: string;
  attempts: number;
  correct: number;
  /** Different verbs answered correctly. */
  distinctVerbs: number;
  lastResult: 'pass' | 'fail' | null;
  lastAt: string | null;
  state: SkillState;
}

/** A verb a drill can use. */
export interface PoolVerb {
  kuId: string;
  content: string;
  reading: string;
  meaning: string;
  /** The learner is studying it (it has cards), so the drill needn't show its meaning. */
  studied: boolean;
}

export interface VerbFormGroupRow extends SkillProgress {
  studiedVerbs: number;
  otherVerbs: number;
}

/**
 * One place to ask where a learner is with a KU or a skill. Read-only apart from recording skill
 * evidence. Skills are abstract rules (verb forms first: see lib/verb-forms.ts); whether one is
 * learned is judged by skill-rules.ts from the raw evidence stored here.
 */
@Injectable()
export class LearnerProgressService {
  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly facetStore: FacetStore,
    private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
  ) {}

  private evidenceRef(uid: string) {
    return this.db.collection('users').doc(uid).collection(SKILL_EVIDENCE_SUBCOLLECTION);
  }

  /** Appends one answer to a skill's evidence. Raw: no judgement is stored. */
  async recordSkillAttempt(uid: string, id: string, attempt: Omit<SkillAttempt, 'at'>): Promise<void> {
    if (!parseSkillId(id)) throw new Error(`Unknown skill ${id}`);
    const entry: SkillAttempt = { at: new Date().toISOString(), ...attempt };
    await this.evidenceRef(uid).doc(id).set(
      { skillId: id, attempts: FieldValue.arrayUnion(entry), updatedAt: Timestamp.now() },
      { merge: true },
    );
  }

  /**
   * A graded AI-question card: if its question was a verb-form drill, record the answer as evidence
   * for the drill's skill. Any other question is ignored.
   */
  async recordDrillAnswer(uid: string, questionId: string, result: 'pass' | 'fail'): Promise<void> {
    const q = (await this.db.collection(QUESTIONS_COLLECTION).doc(questionId).get()).data() as QuestionItem | undefined;
    if (q?.kind !== 'verb-form' || !q.verbForm) return;
    await this.recordSkillAttempt(uid, q.verbForm.skillId, { result, verbKuId: q.verbForm.verbKuId, grammarKuId: q.kuId, questionId });
  }

  /** Progress on the given skills, in the order asked. */
  async skills(uid: string, ids: string[]): Promise<SkillProgress[]> {
    if (ids.length === 0) return [];
    const docs = await this.db.getAll(...ids.map(id => this.evidenceRef(uid).doc(id)));
    return ids.map((id, i) => {
      const { form, group } = parseSkillId(id)!;
      const attempts = (docs[i].data()?.attempts ?? []) as SkillAttempt[];
      const correct = attempts.filter(a => a.result === 'pass');
      const last = [...attempts].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
      return {
        skillId: id,
        form,
        group,
        label: FORM_GROUPS[form].find(g => g.id === group)!.label,
        attempts: attempts.length,
        correct: correct.length,
        distinctVerbs: new Set(correct.map(a => a.verbKuId)).size,
        lastResult: last?.result ?? null,
        lastAt: last?.at ?? null,
        state: skillState(attempts),
      };
    });
  }

  /** Every verb-form skill of these forms, in teaching order. */
  verbFormSkillIds(forms: VerbForm[]): string[] {
    return forms.flatMap(f => FORM_GROUPS[f].map(g => skillId(f, g.id)));
  }

  /**
   * The verbs drills can use, per form and ending group, verbs the learner studies first. Two reads
   * however many forms. Corpus verbs need `data.conjugationType` (set when their lesson is generated).
   */
  async verbPools(uid: string, forms: VerbForm[]): Promise<Map<VerbForm, Map<string, PoolVerb[]>>> {
    const pools = new Map<VerbForm, Map<string, PoolVerb[]>>(forms.map(f => [f, new Map(FORM_GROUPS[f].map(g => [g.id, []]))]));
    if (forms.length === 0) return pools;
    const [verbSnap, studiedSnap] = await Promise.all([
      this.db.collection(KNOWLEDGE_UNITS_COLLECTION).where('data.conjugationType', 'in', ['godan', 'ichidan', 'irregular']).get(),
      this.db.collection('users').doc(uid).collection(USER_KUS_SUBCOLLECTION).where('status', 'in', ['reviewing', 'mastered']).get(),
    ]);
    const studied = new Set(studiedSnap.docs.map(d => d.data().kuId as string));
    for (const d of verbSnap.docs) {
      const k = d.data();
      const verb: Verb = { content: k.content, reading: k.data?.reading ?? '', conjugationType: k.data.conjugationType };
      if (!verb.reading) continue;
      for (const form of forms) {
        const c = conjugate(verb, form);
        if (c) pools.get(form)!.get(c.group)!.push({ kuId: d.id, content: k.content, reading: verb.reading, meaning: k.data?.definition ?? '', studied: studied.has(d.id) });
      }
    }
    return pools;
  }

  /** The verb-form grid for the admin progress page: every form and group, with evidence and verbs available. */
  async verbFormGrid(uid: string): Promise<{ form: VerbForm; groups: VerbFormGroupRow[] }[]> {
    const forms = VERB_FORMS;
    const [progress, pools] = await Promise.all([
      this.skills(uid, this.verbFormSkillIds(forms)),
      this.verbPools(uid, forms),
    ]);
    return forms.map(form => ({
      form,
      groups: progress.filter(p => p.form === form).map(p => {
        const verbs = pools.get(form)!.get(p.group) ?? [];
        return { ...p, studiedVerbs: verbs.filter(v => v.studied).length, otherVerbs: verbs.filter(v => !v.studied).length };
      }),
    }));
  }

  /**
   * One view of where the learner is with a KU: its status and sequence stage, each card's SRS
   * stage, and for a Grammar point the verb-form skills its notation needs.
   */
  async forKu(uid: string, kuId: string) {
    const kuDoc = await this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(kuId).get();
    if (!kuDoc.exists) throw new NotFoundException(`KU ${kuId} not found`);
    const ku = kuDoc.data()!;
    const [uku, facets] = await Promise.all([
      this.userKnowledgeUnitsService.findByKuId(uid, kuId),
      this.facetStore.forKu(uid, kuId),
    ]);
    const forms = ku.type === 'Grammar' ? slotForms(ku.content) : [];
    const verbForms = await this.skills(uid, this.verbFormSkillIds(forms));
    return {
      kuId,
      type: ku.type as string,
      content: ku.content as string,
      status: uku?.status ?? null,
      sequenceStage: uku?.currentStage ?? null,
      cards: facets.map(f => ({
        facetId: f.id,
        facetType: f.facetType,
        srsStage: f.srsStage ?? 0,
        sequenceStage: f.sequenceStage ?? null,
        nextReviewAt: f.nextReviewAt instanceof Timestamp ? f.nextReviewAt.toDate().toISOString() : (f.nextReviewAt as unknown as string) ?? null,
      })),
      verbForms,
    };
  }
}
