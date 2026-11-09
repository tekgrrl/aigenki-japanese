import { LessonsService } from './lessons.service';
import { FakeFirestore } from '../testing/fake-firestore';
import { FacetStore } from '../facets/facet-store';
import { UserService } from '../users/user.service';
import { ADMIN_USER_ID } from '../lib/constants';

describe('LessonsService.updateLesson (learner route, no AdminGuard)', () => {
  const savedAdminAll = process.env.ADMIN_ALL;
  let db: FakeFirestore;
  let service: LessonsService;

  beforeEach(async () => {
    delete process.env.ADMIN_ALL;
    db = new FakeFirestore();
    service = new LessonsService(db as any, new FacetStore(db as any), {} as any, {} as any, {} as any, {} as any, new UserService(db as any));
    await db.collection('lessons').doc('k1').set({ type: 'Vocab', meaning_explanation: 'global text' });
  });
  afterAll(() => {
    if (savedAdminAll === undefined) delete process.env.ADMIN_ALL;
    else process.env.ADMIN_ALL = savedAdminAll;
  });

  it("writes a learner's edit to their own overlay, even if their doc says isAdmin: true", async () => {
    await db.collection('users').doc('learner').set({ isAdmin: true });
    await service.updateLesson('learner', 'k1', 'meaning_explanation', 'my notes');
    expect(db.store('lessons').get('k1')!.meaning_explanation).toBe('global text');
    expect(db.store('users/learner/user-lessons').get('k1')!.meaning_explanation).toBe('my notes');
  });

  it('writes the admin user\'s edit to the global lesson', async () => {
    await service.updateLesson(ADMIN_USER_ID, 'k1', 'meaning_explanation', 'fixed');
    expect(db.store('lessons').get('k1')!.meaning_explanation).toBe('fixed');
  });
});
