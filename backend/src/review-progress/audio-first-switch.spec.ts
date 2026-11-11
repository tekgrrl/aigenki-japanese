import { BadRequestException } from '@nestjs/common';
import { ReviewProgressService } from './review-progress.service';
import { SequenceResetService, canOwnKanjiFacet } from './sequence-reset.service';
import { FakeFirestore } from '../testing/fake-firestore';
import { FacetStore } from '../facets/facet-store';
import { UserService } from '../users/user.service';

const UID = 'u1';
const WORD = 'word1';
const KANJI = 'kanji1';

/** SequenceResetService (over a real ReviewProgressService) on a fake Firestore, with in-memory KU and UKU stand-ins. */
function setup() {
  const db = new FakeFirestore();
  const kus: Record<string, any> = { [WORD]: { id: WORD, type: 'Vocab', content: '川' }, [KANJI]: { id: KANJI, type: 'Kanji', content: '川' } };
  const ukus = new Map<string, any>();
  const knowledgeUnits = { findOneById: jest.fn(async (id: string) => kus[id] ?? null) };
  const userKus = {
    findByKuId: jest.fn(async (_uid: string, kuId: string) => ukus.get(kuId) ?? null),
    update: jest.fn(async (_uid: string, kuId: string, data: any) => ukus.set(kuId, { ...ukus.get(kuId), ...data })),
    remove: jest.fn(async (_uid: string, kuId: string) => ukus.delete(kuId)),
  };
  const learningProgress = { recomputeAndCache: jest.fn() };
  const tutorContext = { removeFromTutorVocab: jest.fn() };
  const facetStore = new FacetStore(db as any);
  const reviewProgress = new ReviewProgressService(db as any, facetStore, knowledgeUnits as any, {} as any, userKus as any, learningProgress as any, new UserService(db as any));
  const service = new SequenceResetService(db as any, facetStore, knowledgeUnits as any, {} as any, userKus as any, learningProgress as any, tutorContext as any, reviewProgress);

  const facets = db.collection('users').doc(UID).collection('review-facets');
  const ukuCol = db.collection('users').doc(UID).collection('user-kus');
  const seed = async () => {
    await db.collection('users').doc(UID).set({ preferences: { audioFirstExperiment: true } });
    ukus.set(WORD, { kuId: WORD, currentStage: 2, facet_count: 3 });
    ukus.set(KANJI, { kuId: KANJI, source: { type: 'lesson', id: WORD } });
    await ukuCol.doc(WORD).set({ kuId: WORD });
    await ukuCol.doc(KANJI).set({ kuId: KANJI });
    await db.collection('knowledge-units').doc(WORD).set({ type: 'Vocab', content: '川', data: { kanji: ['川'] } });
    await facets.doc('f1').set({ kuId: WORD, source: { id: WORD }, facetType: 'Content-to-Definition' });
    await facets.doc('f2').set({ kuId: KANJI, source: { id: WORD }, facetType: 'Kanji-Component-Meaning', data: { content: '川' } });
    for (const [i, kuId] of [WORD, 'p2', 'p3', 'p4'].entries()) {
      await db.collection('pictures').doc(`pic${i}`).set({ kuId, status: 'approved', file: `${kuId}.png`, usage: 'u' });
    }
  };
  /** A second enrolled default-sequence word that also contains 川. */
  const shareKanji = async () => {
    await db.collection('knowledge-units').doc('word2').set({ type: 'Vocab', content: '小川', data: { kanji: ['小', '川'] } });
    await ukuCol.doc('word2').set({ kuId: 'word2', createdAt: { seconds: 5 } });
    ukus.set('word2', { kuId: 'word2', facet_count: 4 });
  };
  return { db, service, reviewProgress, ukus, facets, ukuCol, seed, tutorContext, shareKanji, learningProgress };
}

describe('audioFirstStatus', () => {
  it('is eligible for an enrolled standard word with an approved picture', async () => {
    const { service, seed } = setup();
    await seed();
    expect(await service.audioFirstStatus(UID, WORD)).toEqual({ eligible: true, facetCount: 2 });
  });

  it('counts exactly the facets the switch deletes, including ones matched only by kuId', async () => {
    const { service, seed, facets } = setup();
    await seed();
    await facets.doc('legacy').set({ kuId: WORD, facetType: 'Content-to-Reading' }); // no source
    expect((await service.audioFirstStatus(UID, WORD)).facetCount).toBe(3);
  });

  it.each([
    ['not Vocab', async (s: ReturnType<typeof setup>) => s.service.audioFirstStatus(UID, KANJI), 'Only Vocab'],
    ['not enrolled', async (s: ReturnType<typeof setup>) => { s.ukus.delete(WORD); return s.service.audioFirstStatus(UID, WORD); }, 'Not enrolled'],
    ['already audio-first', async (s: ReturnType<typeof setup>) => { s.ukus.set(WORD, { kuId: WORD, sequenceVariant: 'audio-first' }); return s.service.audioFirstStatus(UID, WORD); }, 'Already audio-first'],
    ['already waiting in lessons', async (s: ReturnType<typeof setup>) => { await s.facets.doc('f1').delete(); await s.facets.doc('f2').delete(); return s.service.audioFirstStatus(UID, WORD); }, 'Already waiting'],
    ['waiting but no usage picture (not "already waiting")', async (s: ReturnType<typeof setup>) => { await s.facets.doc('f1').delete(); await s.facets.doc('f2').delete(); await s.db.collection('pictures').doc('pic0').delete(); return s.service.audioFirstStatus(UID, WORD); }, 'No approved usage picture'],
    ['experiment off', async (s: ReturnType<typeof setup>) => { await s.db.collection('users').doc(UID).set({ preferences: {} }); return s.service.audioFirstStatus(UID, WORD); }, 'experiment is off'],
    ['no approved picture', async (s: ReturnType<typeof setup>) => { await s.db.collection('pictures').doc('pic0').update({ status: 'needs-review' }); return s.service.audioFirstStatus(UID, WORD); }, 'No approved usage picture'],
    ['the only picture is whole-KU', async (s: ReturnType<typeof setup>) => { await s.db.collection('pictures').doc('pic0').update({ subject: { kind: 'ku', kuId: WORD }, usage: '' }); return s.service.audioFirstStatus(UID, WORD); }, 'Only a whole-KU picture'],
    ['too few pictured words', async (s: ReturnType<typeof setup>) => { await s.db.collection('pictures').doc('pic3').delete(); return s.service.audioFirstStatus(UID, WORD); }, 'Fewer than 4'],
  ])('is not eligible when %s', async (_name, run, reason) => {
    const s = setup();
    await s.seed();
    const out = await run(s);
    expect(out.eligible).toBe(false);
    expect(out.reason).toContain(reason);
  });
});

describe('returnToLessonsAsAudioFirst', () => {
  it('deletes the facets, resets the word to stage 0 with no variant, and drops its orphaned kanji', async () => {
    const { service, seed, ukus, db, tutorContext } = setup();
    await seed();
    expect(await service.returnToLessonsAsAudioFirst(UID, WORD)).toEqual({ facetsDeleted: 2 });
    expect(db.store(`users/${UID}/review-facets`).size).toBe(0);
    expect(ukus.get(WORD)).toMatchObject({ status: 'learning', currentStage: 0, facet_count: 0 });
    expect(tutorContext.removeFromTutorVocab).toHaveBeenCalledWith(UID, '川');
    expect(ukus.get(WORD)).toHaveProperty('sequenceVariant'); // FieldValue.delete() sentinel, applied by Firestore
    expect(ukus.has(KANJI)).toBe(false);
  });

  it('hands a shared kanji facet to another enrolled word instead of deleting it', async () => {
    const { service, seed, ukus, db, shareKanji, learningProgress } = setup();
    await seed();
    await shareKanji();
    expect((await service.audioFirstStatus(UID, WORD)).facetCount).toBe(1); // only f1 is deleted
    expect(await service.returnToLessonsAsAudioFirst(UID, WORD)).toEqual({ facetsDeleted: 1 });
    const left = db.store(`users/${UID}/review-facets`);
    expect([...left.keys()]).toEqual(['f2']);
    expect(left.get('f2')!.source.id).toBe('word2');
    expect(ukus.get(KANJI)!.source).toEqual({ type: 'lesson', id: 'word2' }); // kanji UKU kept, re-sourced
    expect(learningProgress.recomputeAndCache).toHaveBeenCalledWith(UID, 'word2');
  });

  it('refuses an ineligible word without touching anything', async () => {
    const { service, seed, db, ukus } = setup();
    await seed();
    ukus.set(WORD, { kuId: WORD, currentStage: 1, sequenceVariant: 'audio-first' });
    await expect(service.returnToLessonsAsAudioFirst(UID, WORD)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.store(`users/${UID}/review-facets`).size).toBe(2);
  });
});

describe('canOwnKanjiFacet', () => {
  it.each([
    ['a word at the facet\'s stage', { status: 'reviewing', currentStage: 1 }, 1, true],
    ['a word past it', { status: 'reviewing', currentStage: 3 }, 1, true],
    ['a word below it', { status: 'reviewing', currentStage: 1 }, 2, false],
    ['a word waiting for its lesson', { status: 'learning', currentStage: 0 }, 1, false],
    ['a waiting word with no stage', { status: 'learning' }, 1, false],
    ['a legacy word (no currentStage)', { status: 'reviewing' }, 1, true],
    ['a facet with no stage, word at stage 1', { status: 'reviewing', currentStage: 1 }, undefined, true],
  ])('%s', (_name, uku, stage, expected) => {
    expect(canOwnKanjiFacet(uku, stage as number | undefined)).toBe(expected);
  });
});

describe('kanji hand-off only goes to a word that has reached the stage', () => {
  it('the switch deletes the kanji facet rather than handing it to a word waiting for its lesson', async () => {
    const { service, seed, db, shareKanji, ukuCol } = setup();
    await seed();
    await shareKanji();
    await ukuCol.doc('word2').update({ status: 'learning', currentStage: 0 });
    expect(await service.returnToLessonsAsAudioFirst(UID, WORD)).toEqual({ facetsDeleted: 2 });
    expect(db.store(`users/${UID}/review-facets`).size).toBe(0);
  });

  it('the switch deletes the kanji facet rather than handing it to a word below its stage', async () => {
    const { service, seed, db, shareKanji, ukuCol, facets } = setup();
    await seed();
    await shareKanji();
    await facets.doc('f2').update({ sequenceStage: 2 });
    await ukuCol.doc('word2').update({ status: 'reviewing', currentStage: 1 });
    expect(await service.returnToLessonsAsAudioFirst(UID, WORD)).toEqual({ facetsDeleted: 2 });
    expect(db.store(`users/${UID}/review-facets`).size).toBe(0);
  });
});

describe('resetSequence', () => {
  it('hands a shared kanji facet to another enrolled word before rebuilding', async () => {
    const { service, reviewProgress, seed, db, shareKanji, ukus } = setup();
    await seed();
    await shareKanji();
    jest.spyOn(reviewProgress, 'initializeSequence').mockResolvedValue({ stage: 1, facetsCreated: 1 });
    expect(await service.resetSequence(UID, WORD)).toMatchObject({ facetsDeleted: 1 });
    const left = db.store(`users/${UID}/review-facets`);
    expect([...left.keys()]).toEqual(['f2']);
    expect(left.get('f2')!.source.id).toBe('word2');
    expect(ukus.get(KANJI)!.source).toEqual({ type: 'lesson', id: 'word2' });
  });

  it('clears the old sequence variant when nothing could be rebuilt', async () => {
    const { service, reviewProgress, seed, ukus } = setup();
    await seed();
    ukus.set(WORD, { ...ukus.get(WORD), sequenceVariant: 'audio-first' });
    jest.spyOn(reviewProgress, 'initializeSequence').mockResolvedValue({ stage: 0, facetsCreated: 0 });
    await service.resetSequence(UID, WORD);
    expect(ukus.get(WORD)!.sequenceVariant).not.toBe('audio-first'); // FieldValue.delete() sentinel
  });

  it('keeps the variant initializeSequence wrote when it rebuilt the word', async () => {
    const { service, reviewProgress, seed, ukus } = setup();
    await seed();
    jest.spyOn(reviewProgress, 'initializeSequence').mockImplementation(async (_uid, kuId) => {
      ukus.set(kuId, { ...ukus.get(kuId), sequenceVariant: 'audio-first' });
      return { stage: 1, facetsCreated: 2 };
    });
    await service.resetSequence(UID, WORD);
    expect(ukus.get(WORD)!.sequenceVariant).toBe('audio-first');
  });
});
