import { KnowledgeUnitsService } from './knowledge-units.service';
import { FakeFirestore } from '../testing/fake-firestore';
import { FacetStore } from '../facets/facet-store';

describe('Vocab data.kanji (#332)', () => {
  let db: FakeFirestore;
  let service: KnowledgeUnitsService;
  const ku = (id: string) => db.store('knowledge-units').get(id)!;

  beforeEach(() => {
    db = new FakeFirestore();
    service = new KnowledgeUnitsService(db as any, new FacetStore(db as any));
  });

  it('is set when a Vocab KU is created, and not on other types', async () => {
    const { id } = await service.create({ type: 'Vocab', content: '食べ物', data: { definition: 'food' } });
    const { id: g } = await service.create({ type: 'Grammar', content: '〜で', data: {} });
    expect(ku(id).data).toEqual({ definition: 'food', kanji: ['食', '物'] });
    expect(ku(g).data.kanji).toBeUndefined();
  });

  it('is set by ensureVocab and bulkIngest', async () => {
    const a = await service.ensureVocab('風邪');
    await service.bulkIngest([{ id: 'b', type: 'Vocab', content: 'お寺', data: {} } as any]);
    expect(ku(a).data.kanji).toEqual(['風', '邪']);
    expect(ku('b').data.kanji).toEqual(['寺']);
  });

  it('follows a content edit, and survives the admin editor replacing data', async () => {
    const { id } = await service.create({ type: 'Vocab', content: '食べ物', data: {} });
    await service.update(id, { content: '飲み物' });
    expect(ku(id).data.kanji).toEqual(['飲', '物']);
    await service.update(id, { data: { definition: 'drink' } });
    expect(ku(id).data).toEqual({ definition: 'drink', kanji: ['飲', '物'] });
  });

  it('follows a content edit through bulkUpdate', async () => {
    const { id } = await service.create({ type: 'Vocab', content: '食べ物', data: { definition: 'food' } });
    await service.bulkUpdate([{ id, content: '果物' } as any]);
    expect(ku(id).data).toEqual({ definition: 'food', kanji: ['果', '物'] });
  });

  it('the lookup returns only Vocab KUs using the kanji', async () => {
    await service.create({ type: 'Vocab', content: '食べ物', data: {} });
    await service.create({ type: 'Vocab', content: '食堂', data: {} });
    await service.create({ type: 'Vocab', content: '飲み物', data: {} });
    // A KU whose type changed away from Vocab but still carries data.kanji.
    db.collection('knowledge-units').doc('g').set({ type: 'Grammar', content: '食', data: { kanji: ['食'] } });
    const found = await service.findByKanjiComponent('食');
    expect(found.map(k => k.content).sort()).toEqual(['食べ物', '食堂'].sort());
  });

  it('the backfill fixes missing or stale arrays and is safe to rerun', async () => {
    db.collection('knowledge-units').doc('a').set({ type: 'Vocab', content: '食べ物', data: {} });
    db.collection('knowledge-units').doc('b').set({ type: 'Vocab', content: '果物', data: { kanji: ['食'] } });
    db.collection('knowledge-units').doc('c').set({ type: 'Vocab', content: 'どのぐらい', data: { kanji: [] } });
    expect(await service.backfillVocabKanji()).toEqual({ updated: 2, unchanged: 1 });
    expect(ku('a').data.kanji).toEqual(['食', '物']);
    expect(ku('b').data.kanji).toEqual(['果', '物']);
    expect(await service.backfillVocabKanji()).toEqual({ updated: 0, unchanged: 3 });
  });
});
