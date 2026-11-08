import { KnowledgeUnitsService } from './knowledge-units.service';
import { FakeFirestore } from '../testing/fake-firestore';

function setup() {
  const db = new FakeFirestore();
  const kus = db.store('knowledge-units');
  kus.set('wk-1', { type: 'Vocab', content: 'いぬ', data: { jlptLevel: 'N5' } });
  kus.set('a', { type: 'Vocab', content: 'あめ', data: { jlptLevel: 'N5' } });
  kus.set('b', { type: 'Vocab', content: 'こいぬ', data: { jlptLevel: 'N4' } });
  kus.set('g', { type: 'Grammar', content: '～まで', data: { jlptLevel: 'N5', scenarioReady: true } });
  db.store('pictures').set('p', { kuId: 'wk-1', status: 'approved' });
  db.store('pictures').set('r', { kuId: 'a', status: 'rejected' });
  const service = new (KnowledgeUnitsService as any)(db) as KnowledgeUnitsService;
  return { service };
}

describe('KnowledgeUnitsService.browse', () => {
  it('filters without a query, sorts by content, and includes wk-* KUs', async () => {
    const { service } = setup();
    const r = await service.browse({ type: 'Vocab', jlptLevel: 'N5' });
    expect(r.items.map(k => k.content)).toEqual(['あめ', 'いぬ']);
    expect(r.total).toBe(2);
  });

  it('ranks prefix matches first for a query', async () => {
    const { service } = setup();
    const r = await service.browse({ q: 'いぬ' });
    expect(r.items.map(k => k.content)).toEqual(['いぬ', 'こいぬ']);
  });

  it('pages, clamping out-of-range pages, and reports the total', async () => {
    const { service } = setup();
    const r = await service.browse({ pageSize: 1, page: 9 });
    expect(r).toMatchObject({ total: 4, page: 4, pageSize: 1 });
    expect(r.items).toHaveLength(1);
  });

  it('flags KUs with an approved picture only', async () => {
    const { service } = setup();
    const r = await service.browse({ type: 'Vocab' });
    expect(Object.fromEntries(r.items.map(k => [k.content, k.hasPicture]))).toEqual({ あめ: false, いぬ: true, こいぬ: false });
  });
});
