import { Timestamp } from 'firebase-admin/firestore';
import { FakeFirestore } from '../testing/fake-firestore';
import { UserKnowledgeUnitsService } from './user-knowledge-units.service';

describe('UserKnowledgeUnitsService.findAllAsKUs', () => {
  it('projects each item\'s source and enrolment time for the Lessons view', async () => {
    const db = new FakeFirestore();
    await db.collection('knowledge-units').doc('k1').set({ type: 'Vocab', content: '駅' });
    await db.collection('knowledge-units').doc('k2').set({ type: 'Vocab', content: '電車' });
    const ukus = db.collection('users').doc('u1').collection('user-kus');
    const enrolled = Timestamp.fromMillis(Date.UTC(2026, 10, 13, 9, 0));
    await ukus.doc('a').set({ kuId: 'k1', status: 'learning', facet_count: 0, createdAt: enrolled, source: { type: 'scenario', id: 's1' } });
    await ukus.doc('b').set({ kuId: 'k2', status: 'reviewing', facet_count: 2 });

    const none = {} as any;
    const service = new UserKnowledgeUnitsService(db as any, none, none, none, none);
    const items = (await service.findAllAsKUs('u1')) as any[];

    expect(items.find(i => i.id === 'k1')).toMatchObject({
      ukuStatus: 'learning', ukuSource: { type: 'scenario', id: 's1' }, ukuCreatedAt: '2026-11-13T09:00:00.000Z',
    });
    expect(items.find(i => i.id === 'k2')).toMatchObject({ ukuStatus: 'reviewing', ukuSource: null, ukuCreatedAt: null });
  });
});
