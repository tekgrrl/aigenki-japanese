import { FakeFirestore } from '../testing/fake-firestore';
import { UserService, jlptLevelOf } from './user.service';

describe('UserService preferences and admin', () => {
  let db: FakeFirestore;
  let users: UserService;
  const savedAdminAll = process.env.ADMIN_ALL;

  beforeEach(() => {
    db = new FakeFirestore();
    users = new UserService(db as any);
    delete process.env.ADMIN_ALL;
  });
  afterAll(() => {
    if (savedAdminAll === undefined) delete process.env.ADMIN_ALL;
    else process.env.ADMIN_ALL = savedAdminAll;
  });

  it('returns preferences as stored, with unset fields left unset', async () => {
    await db.collection('users').doc('u1').set({ preferences: { audioFirstExperiment: true } });
    expect(await users.getPreferences('u1')).toEqual({ audioFirstExperiment: true });
    expect(await users.getPreferences('nobody')).toEqual({});
  });

  it("gives the user's level, or N5 when they never chose one", async () => {
    await db.collection('users').doc('u1').set({ preferences: { jlptLevel: 'N4' } });
    await db.collection('users').doc('u2').set({ preferences: {} });
    expect(await users.getJlptLevel('u1')).toBe('N4');
    expect(await users.getJlptLevel('u2')).toBe('N5');
    expect(await users.getJlptLevel('nobody')).toBe('N5');
  });

  it('jlptLevelOf applies the same default to an already-read user doc', () => {
    expect(jlptLevelOf({ preferences: { jlptLevel: 'N3' } })).toBe('N3');
    expect(jlptLevelOf(undefined)).toBe('N5');
  });

  it('isAdmin: only isAdmin: true on the doc, unless ADMIN_ALL makes everyone admin', async () => {
    await db.collection('users').doc('admin').set({ isAdmin: true });
    await db.collection('users').doc('learner').set({ isAdmin: false });
    expect(await users.isAdmin('admin')).toBe(true);
    expect(await users.isAdmin('learner')).toBe(false);
    expect(await users.isAdmin('nobody')).toBe(false);
    process.env.ADMIN_ALL = 'true';
    expect(await users.isAdmin('learner')).toBe(true);
  });
});
