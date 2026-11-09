import { FakeFirestore } from '../testing/fake-firestore';
import { ADMIN_USER_ID } from '../lib/constants';
import { FacetStore } from './facet-store';

describe('FacetStore', () => {
  let db: FakeFirestore;
  let store: FacetStore;

  beforeEach(() => {
    db = new FakeFirestore();
    store = new FacetStore(db as any);
  });

  it("keeps a learner's facets under users/{uid}/review-facets", async () => {
    await store.newDoc('u1').set({ kuId: 'k1', ...store.ownerTag('u1') });
    expect([...db.store('users/u1/review-facets').values()]).toEqual([{ kuId: 'k1' }]);
    expect(db.store('review-facets').size).toBe(0);
  });

  it("keeps the admin's facets in the shared top-level collection, tagged with userId", async () => {
    await store.newDoc(ADMIN_USER_ID).set({ kuId: 'k1', ...store.ownerTag(ADMIN_USER_ID) });
    expect([...db.store('review-facets').values()]).toEqual([{ kuId: 'k1', userId: ADMIN_USER_ID }]);
  });

  it("reads only the admin's own facets from the shared collection", async () => {
    await db.collection('review-facets').doc('mine').set({ kuId: 'k1', userId: ADMIN_USER_ID });
    await db.collection('review-facets').doc('legacy').set({ kuId: 'k1', userId: 'someone-else' });
    const facets = await store.byKuId(ADMIN_USER_ID, 'k1');
    expect(facets.map(f => f.id)).toEqual(['mine']);
  });

  it("reads a learner's facets by kuId", async () => {
    await db.collection('users').doc('u1').collection('review-facets').doc('a').set({ kuId: 'k1' });
    await db.collection('users').doc('u1').collection('review-facets').doc('b').set({ kuId: 'k2' });
    expect((await store.byKuId('u1', 'k1')).map(f => f.id)).toEqual(['a']);
  });

  it('checks ownership only in the shared collection', () => {
    expect(store.belongsTo(ADMIN_USER_ID, { userId: ADMIN_USER_ID })).toBe(true);
    expect(store.belongsTo(ADMIN_USER_ID, { userId: 'other' })).toBe(false);
    expect(store.belongsTo(ADMIN_USER_ID, undefined)).toBe(false);
    expect(store.belongsTo('u1', undefined)).toBe(true);
  });

  it('gets a facet with its id, or null when it is gone', async () => {
    await db.collection('users').doc('u1').collection('review-facets').doc('f').set({ kuId: 'k1' });
    expect(await store.get('u1', 'f')).toEqual({ id: 'f', kuId: 'k1' });
    expect(await store.get('u1', 'missing')).toBeNull();
  });

  it("won't get another user's facet from the admin's shared collection", async () => {
    await db.collection('review-facets').doc('mine').set({ kuId: 'k1', userId: ADMIN_USER_ID });
    await db.collection('review-facets').doc('theirs').set({ kuId: 'k1', userId: 'someone-else' });
    expect(await store.get(ADMIN_USER_ID, 'mine')).toEqual({ id: 'mine', kuId: 'k1', userId: ADMIN_USER_ID });
    expect(await store.get(ADMIN_USER_ID, 'theirs')).toBeNull();
  });

  it("queries only the admin's own facets, whatever filters are added", async () => {
    await db.collection('review-facets').doc('mine').set({ kuId: 'k1', 'source': { id: 'w' }, userId: ADMIN_USER_ID });
    await db.collection('review-facets').doc('theirs').set({ kuId: 'k1', 'source': { id: 'w' }, userId: 'someone-else' });
    const snap = await store.query(ADMIN_USER_ID).where('source.id', '==', 'w').get();
    expect(snap.docs.map((d: any) => d.id)).toEqual(['mine']);
  });

  it('forKu returns the facets testing a KU and those in its sequence, once each', async () => {
    const col = db.collection('users').doc('u1').collection('review-facets');
    await col.doc('own').set({ kuId: 'word', source: { id: 'word' } });
    await col.doc('kanji').set({ kuId: 'kanji', source: { id: 'word' } });
    await col.doc('other').set({ kuId: 'x', source: { id: 'x' } });
    expect((await store.forKu('u1', 'word')).map(f => f.id).sort()).toEqual(['kanji', 'own']);
    expect((await store.forKu('u1', 'kanji')).map(f => f.id)).toEqual(['kanji']);
  });

  it("records a facet's current question", async () => {
    await db.collection('users').doc('u1').collection('review-facets').doc('f').set({ kuId: 'k1' });
    await store.updateQuestion('u1', 'f', 'q9');
    expect(db.store('users/u1/review-facets').get('f')).toEqual({ kuId: 'k1', currentQuestionId: 'q9' });
  });
});
