import { KnowledgeUnitsService } from './knowledge-units.service';
import { FakeFirestore } from '../testing/fake-firestore';
import { FacetStore } from '../facets/facet-store';

describe('KnowledgeUnitsService.cascadeDelete', () => {
  it("deletes the KU's facets, including its kanji-component cards (source.id), and leaves other words'", async () => {
    const db = new FakeFirestore();
    const service = new KnowledgeUnitsService(db as any, new FacetStore(db as any));
    await db.collection('knowledge-units').doc('word').set({ type: 'Vocab', content: '食べ物' });
    const facets = db.collection('users').doc('u1').collection('review-facets');
    await facets.doc('meaning').set({ kuId: 'word', source: { id: 'word' } });
    await facets.doc('kanji-card').set({ kuId: 'kanji-食', source: { id: 'word' } });
    await facets.doc('other-word').set({ kuId: 'kanji-食', source: { id: 'other' } });

    const { deleted } = await service.cascadeDelete('u1', 'word');

    expect(deleted['review-facets']).toBe(2);
    expect([...db.store('users/u1/review-facets').keys()]).toEqual(['other-word']);
  });
});
