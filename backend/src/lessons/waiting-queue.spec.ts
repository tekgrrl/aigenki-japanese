import { LessonsService } from './lessons.service';
import { FakeFirestore } from '../testing/fake-firestore';
import { FacetStore } from '../facets/facet-store';

const UID = 'u1';
const at = (seconds: number) => ({ seconds, nanoseconds: 0 });

function setup() {
  const db = new FakeFirestore();
  const service = new LessonsService(db as any, new FacetStore(db as any), {} as any, {} as any, {} as any, {} as any);
  const uku = (kuId: string, status: string, createdMs: number) =>
    db.collection('users').doc(UID).collection('user-kus').doc(kuId).set({ kuId, status, createdAt: at(createdMs) });
  const ku = (id: string, type: string, content: string) =>
    db.collection('knowledge-units').doc(id).set({ type, content, data: { jlptLevel: 'N5' } });
  return { db, service, uku, ku };
}

describe('getQueue: Start Learning services the waiting queue first', () => {
  it('returns only the waiting (status learning) KUs, oldest first, with no type quotas', async () => {
    const { service, uku, ku } = setup();
    for (const [id, type] of [['g1', 'Grammar'], ['g2', 'Grammar'], ['g3', 'Grammar'], ['g4', 'Grammar'], ['v1', 'Vocab'], ['c1', 'Vocab']] as const) await ku(id, type, id);
    await uku('v1', 'learning', 3);
    await uku('g1', 'learning', 1);
    await uku('g2', 'learning', 2);
    await uku('g3', 'learning', 4);
    await uku('g4', 'learning', 5);
    await uku('c1', 'reviewing', 0); // already learned: not waiting
    const q = await service.getQueue(UID);
    expect(q.map(i => i.kuId)).toEqual(['g1', 'g2', 'v1', 'g3', 'g4']);
  });

  it('ignores a stale learning status on a word that already has facets (by kuId or source.id)', async () => {
    const { db, service, uku, ku } = setup();
    for (const id of ['v1', 'v2', 'v3']) await ku(id, 'Vocab', id);
    await uku('v1', 'learning', 1);
    await uku('v2', 'learning', 2);
    await uku('v3', 'learning', 3);
    const facets = db.collection('users').doc(UID).collection('review-facets');
    await facets.doc('f1').set({ kuId: 'k1', source: { id: 'v1' } }); // kanji-component facet of v1
    await facets.doc('f2').set({ kuId: 'v2' });
    expect((await service.getQueue(UID)).map(i => i.kuId)).toEqual(['v3']);
  });

  it('serves at most 10 waiting items, oldest first', async () => {
    const { service, uku, ku } = setup();
    for (let i = 0; i < 12; i++) { await ku(`v${i}`, 'Vocab', `v${i}`); await uku(`v${i}`, 'learning', 100 - i); }
    const q = await service.getQueue(UID);
    expect(q).toHaveLength(10);
    expect(q[0].kuId).toBe('v11');
  });

  it('a long run of deleted KUs does not hide newer waiting words', async () => {
    const { service, uku, ku } = setup();
    for (let i = 0; i < 60; i++) await uku(`gone${i}`, 'learning', i);
    await ku('v1', 'Vocab', '川');
    await uku('v1', 'learning', 100);
    expect((await service.getQueue(UID)).map(i => i.kuId)).toEqual(['v1']);
  });

  it('skips a waiting UKU whose KU was deleted', async () => {
    const { service, uku, ku } = setup();
    await ku('v1', 'Vocab', '川');
    await uku('v1', 'learning', 1);
    await uku('gone', 'learning', 2);
    expect(await service.getQueue(UID)).toEqual([{ kuId: 'v1', content: '川', type: 'Vocab' }]);
  });
});
