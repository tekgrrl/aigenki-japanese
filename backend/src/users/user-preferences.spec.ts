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

  it('returns preferences with the level filled in: N5 when it was never set', async () => {
    await db.collection('users').doc('u1').set({ preferences: { audioFirstExperiment: true } });
    expect(await users.getPreferences('u1')).toEqual({ audioFirstExperiment: true, jlptLevel: 'N5' });
    expect(await users.getPreferences('nobody')).toEqual({ jlptLevel: 'N5' });
  });

  it("gives the user's level, or N5 when they never chose one", async () => {
    await db.collection('users').doc('u1').set({ preferences: { jlptLevel: 'N4' } });
    await db.collection('users').doc('u2').set({ preferences: {} });
    expect(await users.getJlptLevel('u1')).toBe('N4');
    expect(await users.getJlptLevel('u2')).toBe('N5');
    expect(await users.getJlptLevel('nobody')).toBe('N5');
  });

  it('the level is required: it can be changed but not cleared or set to nonsense', async () => {
    await users.updatePreferences('u1', { jlptLevel: 'N3' });
    expect(await users.getJlptLevel('u1')).toBe('N3');
    await expect(users.updatePreferences('u1', { jlptLevel: null as any })).rejects.toThrow('jlptLevel');
    await expect(users.updatePreferences('u1', { jlptLevel: '' })).rejects.toThrow('jlptLevel');
    await expect(users.updatePreferences('u1', { jlptLevel: 'N6' })).rejects.toThrow('jlptLevel');
    await users.updatePreferences('u1', { showFurigana: true });
    expect(await users.getJlptLevel('u1')).toBe('N3');
  });

  it('a new account starts at N5 and has no admin flag stored (ADMIN_ALL applies when read)', async () => {
    process.env.ADMIN_ALL = 'true';
    const created = await users.findOrCreate('new');
    expect(created.isAdmin).toBe(true);
    const stored = db.store('users').get('new')!;
    expect(stored.preferences).toEqual({ jlptLevel: 'N5' });
    expect(stored.isAdmin).toBeUndefined();
    delete process.env.ADMIN_ALL;
    expect((await users.findOrCreate('new')).isAdmin).toBe(false);
  });

  it('/users/me (findOrCreate) uses the same admin rule as isAdmin()', async () => {
    await db.collection('users').doc('learner').set({ isAdmin: false });
    process.env.ADMIN_ALL = 'true';
    expect((await users.findOrCreate('learner')).isAdmin).toBe(await users.isAdmin('learner'));
    delete process.env.ADMIN_ALL;
    expect((await users.findOrCreate('learner')).isAdmin).toBe(await users.isAdmin('learner'));
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
