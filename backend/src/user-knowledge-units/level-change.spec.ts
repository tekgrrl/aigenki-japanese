import { FakeFirestore } from '../testing/fake-firestore';
import { FacetStore } from '../facets/facet-store';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { UserService } from '../users/user.service';
import { StatsService } from '../stats/stats.service';
import { UserKnowledgeUnitsService } from './user-knowledge-units.service';

describe('level change: recomputeAboveLevel + rebuildAllowedGrammarKuIds', () => {
  async function setup() {
    const db = new FakeFirestore();
    const kus = new KnowledgeUnitsService(db as any, new FacetStore(db as any));
    const users = new UserService(db as any);
    const stats = new StatsService(db as any, new FacetStore(db as any), kus, users);
    const ukuService = new UserKnowledgeUnitsService(db as any, stats, users, kus);
    const ku = db.collection('knowledge-units');
    await ku.doc('g5').set({ type: 'Grammar', content: 'です', data: { jlptLevel: 'N5' } });
    await ku.doc('g3').set({ type: 'Grammar', content: 'ようにする', data: { jlptLevel: 'N3' } });
    await ku.doc('v4').set({ type: 'Vocab', content: '経験', data: { jlptLevel: 'N4' } });
    const ukus = db.collection('users').doc('u1').collection('user-kus');
    // Enrolled while no level was stored: nothing counted as above level.
    await ukus.doc('a').set({ kuId: 'g5', aboveLevel: false });
    await ukus.doc('b').set({ kuId: 'g3', aboveLevel: false });
    await ukus.doc('c').set({ kuId: 'v4' }); // older enrolment with no flag
    await db.collection('users').doc('u1').set({ tutorContext: { allowedGrammarKuIds: ['g5', 'g3'], leechVocab: [] } });
    const flags = () => Object.fromEntries([...db.store('users/u1/user-kus').values()].map(d => [d.kuId, d.aboveLevel]));
    const allowed = () => db.store('users').get('u1')!.tutorContext.allowedGrammarKuIds;
    return { db, ukuService, stats, users, flags, allowed };
  }

  it('at N5: N4 and N3 items become above level, the flagless one gets a flag, N3 grammar leaves allowed grammar', async () => {
    const { ukuService, stats, users, flags, allowed, db } = await setup();
    await users.updatePreferences('u1', { jlptLevel: 'N5' });
    expect(await ukuService.recomputeAboveLevel('u1', 'N5')).toBe(2);
    expect(flags()).toEqual({ g5: false, g3: true, v4: true });
    await stats.rebuildAllowedGrammarKuIds('u1');
    expect(allowed()).toEqual(['g5']);
    expect(db.store('users').get('u1')!.tutorContext.leechVocab).toEqual([]); // siblings kept
  });

  it('at N3: nothing is above level and both grammar points are allowed', async () => {
    const { ukuService, stats, users, flags, allowed } = await setup();
    await users.updatePreferences('u1', { jlptLevel: 'N3' });
    await ukuService.recomputeAboveLevel('u1', 'N3');
    expect(flags()).toEqual({ g5: false, g3: false, v4: false });
    await stats.rebuildAllowedGrammarKuIds('u1');
    expect([...allowed()].sort()).toEqual(['g3', 'g5']);
  });
});
