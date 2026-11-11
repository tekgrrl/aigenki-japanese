import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FieldValue, Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  CONCEPTS_COLLECTION,
  FIRESTORE_CONNECTION,
  KNOWLEDGE_UNITS_COLLECTION,
  LESSONS_COLLECTION,
  QUESTIONS_COLLECTION,
  QUESTION_STATES_SUBCOLLECTION,
} from '../firebase/firebase.module';
import { FacetStore } from '../facets/facet-store';
import { ADMIN_USER_ID } from '../lib/constants';
import { guessQuestionKind } from '../lib/question-kind';
import { usagesOf } from '../lessons/vocab-usages';
import { QuestionItem, VocabLesson } from '../types';

/** A question as the admin Questions page shows it. */
export interface AdminQuestion {
  id: string;
  kuId: string;
  /** The word or concept it belongs to; null when that no longer exists (an orphan). */
  word: { content: string; type: string } | null;
  /** Vocab: the label of the usage it tests, if it has one and the usage still exists. */
  usageLabel?: string;
  kind: string;
  /** True when `kind` was guessed from the text (questions made before kinds were stored). */
  kindGuessed: boolean;
  createdAt: string | null;
  /** When the admin marked it reviewed; null if not reviewed. */
  reviewedAt: string | null;
  /** How many learners' cards currently show it. */
  inUse: number;
  data: QuestionItem['data'];
}

export interface AdminQuestionFilter {
  /** 'Vocab' | 'Grammar' | 'Concept' | 'Kanji', or 'Orphaned' for questions whose word is gone. */
  kuType?: string;
  kuId?: string;
  kind?: string;
  /** Matches the word or the question text. */
  q?: string;
  /** Leave out questions the admin has marked reviewed. */
  hideReviewed?: boolean;
}

/**
 * Admin tools for the shared AI-question corpus: list (with the word, kind and how many cards use
 * each), edit, move to another word, delete. Admin-only, so full collection scans are fine.
 */
@Injectable()
export class QuestionsAdminService {
  private readonly logger = new Logger(QuestionsAdminService.name);

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly facetStore: FacetStore,
  ) {}

  async list(filter: AdminQuestionFilter = {}): Promise<AdminQuestion[]> {
    const [questionSnap, inUse] = await Promise.all([
      this.db.collection(QUESTIONS_COLLECTION).get(),
      this.cardsPointingAt(),
    ]);
    const questions = questionSnap.docs.map(d => ({ ...(d.data() as QuestionItem), id: d.id }));
    const words = await this.wordsFor([...new Set(questions.map(q => q.kuId).filter(Boolean))]);
    const usageLabels = await this.usageLabelsFor(questions);

    const rows: AdminQuestion[] = questions.map(q => ({
      id: q.id,
      kuId: q.kuId,
      word: words.get(q.kuId) ?? null,
      usageLabel: q.usageId ? usageLabels.get(`${q.kuId}/${q.usageId}`) : undefined,
      kind: q.kind ?? guessQuestionKind(q.data?.question ?? ''),
      kindGuessed: !q.kind,
      createdAt: isoOf(q.createdAt),
      reviewedAt: isoOf(q.reviewedAt),
      inUse: inUse.get(q.id)?.length ?? 0,
      data: q.data,
    }));

    const q = filter.q?.trim().toLowerCase();
    return rows
      .filter(r => !filter.kuId || r.kuId === filter.kuId)
      .filter(r => !filter.kuType || (filter.kuType === 'Orphaned' ? r.word === null : r.word?.type === filter.kuType))
      .filter(r => !filter.kind || r.kind === filter.kind)
      .filter(r => !filter.hideReviewed || !r.reviewedAt)
      .filter(r => !q || r.word?.content.toLowerCase().includes(q) || r.data?.question?.toLowerCase().includes(q))
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  }

  /** Edits the shared question: every learner whose card shows it sees the new text. */
  async update(id: string, changes: { question?: string; context?: string; answer?: string; acceptedAlternatives?: string[] }): Promise<void> {
    const ref = await this.existing(id);
    const updates: Record<string, unknown> = {};
    if (changes.question !== undefined) {
      if (!changes.question.trim()) throw new BadRequestException('question can\'t be empty');
      updates['data.question'] = changes.question.trim();
    }
    if (changes.answer !== undefined) {
      if (!changes.answer.trim()) throw new BadRequestException('answer can\'t be empty');
      updates['data.answer'] = changes.answer.trim();
    }
    if (changes.context !== undefined) {
      updates['data.context'] = changes.context.trim() ? changes.context.trim() : FieldValue.delete();
    }
    if (changes.acceptedAlternatives !== undefined) {
      updates['data.acceptedAlternatives'] = changes.acceptedAlternatives.map(a => a.trim()).filter(Boolean);
    }
    if (Object.keys(updates).length === 0) return;
    await ref.update(updates);
    this.logger.log(`Admin edited question ${id}: ${Object.keys(updates).join(', ')}`);
  }

  /** Marks the question reviewed (now) or clears the mark. */
  async setReviewed(id: string, reviewed: boolean): Promise<void> {
    const ref = await this.existing(id);
    await ref.update({ reviewedAt: reviewed ? Timestamp.now() : FieldValue.delete() });
    this.logger.log(`Admin marked question ${id} ${reviewed ? 'reviewed' : 'not reviewed'}`);
  }

  /** Moves a question to another word (e.g. one whose word was deleted). Its usage belonged to the old word, so it's dropped. */
  async reassign(id: string, kuId: string): Promise<void> {
    const ref = await this.existing(id);
    const [ku, concept] = await Promise.all([
      this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(kuId).get(),
      this.db.collection(CONCEPTS_COLLECTION).doc(kuId).get(),
    ]);
    if (!ku.exists && !concept.exists) throw new BadRequestException(`No word or concept ${kuId}`);
    await ref.update({
      kuId,
      sourceCollection: ku.exists ? 'knowledge-units' : 'concepts',
      usageId: FieldValue.delete(),
    });
    this.logger.log(`Admin reassigned question ${id} to ${kuId}`);
  }

  /** Deletes the question, each learner's state for it, and the pointer on any card showing it (that card gets a fresh question). */
  async remove(id: string): Promise<{ cardsCleared: number }> {
    const ref = await this.existing(id);
    const cards = (await this.cardsPointingAt()).get(id) ?? [];
    for (const { uid, facetId } of cards) {
      await this.facetStore.doc(uid, facetId).update({ currentQuestionId: FieldValue.delete() });
    }
    for (const uid of await this.userIds()) {
      await this.db.collection('users').doc(uid).collection(QUESTION_STATES_SUBCOLLECTION).doc(id).delete();
    }
    await ref.delete();
    this.logger.log(`Admin deleted question ${id}; cleared it from ${cards.length} card(s)`);
    return { cardsCleared: cards.length };
  }

  private async existing(id: string) {
    const ref = this.db.collection(QUESTIONS_COLLECTION).doc(id);
    if (!(await ref.get()).exists) throw new NotFoundException(`Question ${id} not found`);
    return ref;
  }

  /** Every account: users with a doc or per-user subcollections, plus the admin account. */
  private async userIds(): Promise<string[]> {
    const refs = await this.db.collection('users').listDocuments();
    return [...new Set([...refs.map(r => r.id), ADMIN_USER_ID])];
  }

  /** Question id → the cards (AI-question facets) whose currentQuestionId is that question. */
  private async cardsPointingAt(): Promise<Map<string, { uid: string; facetId: string }[]>> {
    const byQuestion = new Map<string, { uid: string; facetId: string }[]>();
    for (const uid of await this.userIds()) {
      const snap = await this.facetStore.query(uid).where('facetType', '==', 'AI-Generated-Question').get();
      for (const d of snap.docs) {
        const questionId = d.data().currentQuestionId as string | undefined;
        if (!questionId) continue;
        byQuestion.set(questionId, [...(byQuestion.get(questionId) ?? []), { uid, facetId: d.id }]);
      }
    }
    return byQuestion;
  }

  /** The word (KU) or concept for each id; missing ids are orphans. */
  private async wordsFor(ids: string[]): Promise<Map<string, { content: string; type: string }>> {
    const words = new Map<string, { content: string; type: string }>();
    if (ids.length === 0) return words;
    const [kus, concepts] = await Promise.all([
      this.db.getAll(...ids.map(id => this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(id))),
      this.db.getAll(...ids.map(id => this.db.collection(CONCEPTS_COLLECTION).doc(id))),
    ]);
    concepts.filter(d => d.exists).forEach(d => words.set(d.id, { content: d.data()!.data?.title ?? d.data()!.content, type: 'Concept' }));
    kus.filter(d => d.exists).forEach(d => words.set(d.id, { content: d.data()!.content, type: d.data()!.type }));
    return words;
  }

  /** "kuId/usageId" → usage label, from the lessons of questions that test a usage. */
  private async usageLabelsFor(questions: QuestionItem[]): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    const kuIds = [...new Set(questions.filter(q => q.usageId).map(q => q.kuId))];
    if (kuIds.length === 0) return labels;
    const lessons = await this.db.getAll(...kuIds.map(id => this.db.collection(LESSONS_COLLECTION).doc(id)));
    for (const doc of lessons) {
      const lesson = doc.data() as VocabLesson | undefined;
      if (lesson?.type !== 'Vocab') continue;
      for (const usage of usagesOf(lesson)) labels.set(`${doc.id}/${usage.id}`, usage.label);
    }
    return labels;
  }
}

/** A stored createdAt (Timestamp, ISO string or missing) as an ISO string. */
function isoOf(t: unknown): string | null {
  if (!t) return null;
  if (typeof t === 'string') return t;
  const ts = t as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  const seconds = ts.seconds ?? ts._seconds;
  return seconds !== undefined ? new Date(seconds * 1000).toISOString() : null;
}
