import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QuestionsAdminService } from './questions-admin.service';
import { FakeFirestore } from '../testing/fake-firestore';
import { FacetStore } from '../facets/facet-store';
import { FieldValue } from 'firebase-admin/firestore';

/** Two learners, one Grammar word, one Vocab word with a usage, a concept, and an orphaned question. */
async function setup() {
  const db = new FakeFirestore();
  const service = new QuestionsAdminService(db as any, new FacetStore(db as any));
  await db.collection('knowledge-units').doc('g1').set({ type: 'Grammar', content: '{N}まで' });
  await db.collection('knowledge-units').doc('v1').set({ type: 'Vocab', content: '高い' });
  await db.collection('concepts').doc('c1').set({ type: 'Concept', content: 'rel', data: { title: 'Relative Clauses' } });
  await db.collection('lessons').doc('v1').set({ type: 'Vocab', definitions: ['expensive'], usages: [{ id: 'u1', label: 'price', meaning: 'expensive', acceptedAnswers: [] }] });
  const qs = db.collection('questions');
  await qs.doc('qOld').set({ kuId: 'g1', createdAt: '2026-05-01T00:00:00.000Z', data: { question: 'I walked to the station.', answer: '駅まで歩きました。' } });
  await qs.doc('qNew').set({ kuId: 'g1', kind: 'error-correction', createdAt: '2026-11-03T00:00:00.000Z', data: { question: 'Correct the error: 学校は九時にからです。', context: 'School is until nine.', answer: '学校は九時までです。', acceptedAlternatives: [] } });
  await qs.doc('qVocab').set({ kuId: 'v1', usageId: 'u1', kind: 'translation', createdAt: '2026-08-01T00:00:00.000Z', data: { question: 'Translate: this is expensive', answer: 'これは高いです。' } });
  await qs.doc('qConcept').set({ kuId: 'c1', createdAt: '2026-04-01T00:00:00.000Z', data: { question: 'Translate: the man who reads', answer: '読んでいる人' } });
  await qs.doc('qOrphan').set({ kuId: 'gone', createdAt: '2026-05-02T00:00:00.000Z', data: { question: 'Please give me this book.', answer: 'この本をください。' } });
  for (const uid of ['a', 'b']) {
    await db.collection('users').doc(uid).collection('review-facets').doc(`f-${uid}`).set({ facetType: 'AI-Generated-Question', kuId: 'g1', currentQuestionId: 'qNew' });
    await db.collection('users').doc(uid).collection('question-states').doc('qNew').set({ questionId: 'qNew', rejected: false, consecutiveFailures: 0 });
  }
  await db.collection('users').doc('a').collection('review-facets').doc('f-other').set({ facetType: 'Content-to-Definition', currentQuestionId: 'qOld' });
  return { db, service };
}

describe('QuestionsAdminService.list', () => {
  it('joins each question to its word, kind and the cards showing it, oldest first', async () => {
    const { service } = await setup();
    const rows = await service.list();
    expect(rows.map(r => r.id)).toEqual(['qConcept', 'qOld', 'qOrphan', 'qVocab', 'qNew']);
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    expect(byId.qNew).toMatchObject({ word: { content: '{N}まで', type: 'Grammar' }, kind: 'error-correction', kindGuessed: false, inUse: 2 });
    expect(byId.qOld).toMatchObject({ kind: 'other', kindGuessed: true, inUse: 0 }); // only AI-question cards count
    expect(byId.qVocab.usageLabel).toBe('price');
    expect(byId.qConcept.word).toEqual({ content: 'Relative Clauses', type: 'Concept' });
    expect(byId.qOrphan.word).toBeNull();
  });

  it('filters by word type, orphans, kind and text', async () => {
    const { service } = await setup();
    expect((await service.list({ kuType: 'Grammar' })).map(r => r.id)).toEqual(['qOld', 'qNew']);
    expect((await service.list({ kuType: 'Orphaned' })).map(r => r.id)).toEqual(['qOrphan']);
    expect((await service.list({ kind: 'error-correction' })).map(r => r.id)).toEqual(['qNew']);
    expect((await service.list({ q: '高い' })).map(r => r.id)).toEqual(['qVocab']);
    expect((await service.list({ q: 'station' })).map(r => r.id)).toEqual(['qOld']);
  });
});

describe('QuestionsAdminService.update', () => {
  it('edits the shared question, trimming text and dropping empty accepted answers', async () => {
    const { db, service } = await setup();
    await service.update('qNew', { question: ' Correct the error: 学校は九時にです。 ', acceptedAlternatives: ['学校は九時までです', ' ', ''] });
    const q = db.store('questions').get('qNew')!;
    expect(q.data.question).toBe('Correct the error: 学校は九時にです。');
    expect(q.data.acceptedAlternatives).toEqual(['学校は九時までです']);
    expect(q.data.answer).toBe('学校は九時までです。'); // untouched
  });

  it('refuses an empty question or answer, and an unknown id', async () => {
    const { service } = await setup();
    await expect(service.update('qNew', { answer: '  ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('nope', { answer: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('QuestionsAdminService.reassign', () => {
  it('moves an orphan to an existing word and drops its old usage', async () => {
    const { db, service } = await setup();
    await db.collection('questions').doc('qOrphan').update({ usageId: 'old-usage' });
    await service.reassign('qOrphan', 'g1');
    const q = db.store('questions').get('qOrphan')!;
    expect(q).toMatchObject({ kuId: 'g1', sourceCollection: 'knowledge-units' });
    expect(q.usageId).not.toBe('old-usage');
  });

  it('can move a question to a concept, and refuses a word that doesn\'t exist', async () => {
    const { db, service } = await setup();
    await service.reassign('qOrphan', 'c1');
    expect(db.store('questions').get('qOrphan')).toMatchObject({ kuId: 'c1', sourceCollection: 'concepts' });
    await expect(service.reassign('qOrphan', 'missing')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('QuestionsAdminService.remove', () => {
  it('deletes the question and every learner\'s state, and clears it from the cards showing it', async () => {
    const { db, service } = await setup();
    expect(await service.remove('qNew')).toEqual({ cardsCleared: 2 });
    expect(db.store('questions').has('qNew')).toBe(false);
    for (const uid of ['a', 'b']) {
      expect(db.store(`users/${uid}/question-states`).has('qNew')).toBe(false);
      expect(db.store(`users/${uid}/review-facets`).get(`f-${uid}`)!.currentQuestionId).not.toBe('qNew');
    }
  });
});

describe('QuestionsAdminService.setReviewed', () => {
  it('marks a question reviewed, hides it when asked, and can clear the mark', async () => {
    const { service } = await setup();
    await service.setReviewed('qNew', true);
    expect((await service.list()).find(r => r.id === 'qNew')!.reviewedAt).not.toBeNull();
    expect((await service.list({ kuType: 'Grammar', hideReviewed: true })).map(r => r.id)).toEqual(['qOld']);
    expect((await service.list({ kuType: 'Grammar' })).map(r => r.id)).toEqual(['qOld', 'qNew']);
  });

  it('clearing the mark sends a field delete', async () => {
    const { db, service } = await setup();
    const update = jest.spyOn(db.collection('questions').doc('qNew').constructor.prototype, 'update');
    await service.setReviewed('qNew', false);
    expect(update).toHaveBeenCalledWith({ reviewedAt: FieldValue.delete() });
    update.mockRestore();
  });
});
