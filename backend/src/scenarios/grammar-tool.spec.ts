import { ScenarioKnowledgeService } from './scenario-knowledge.service';
import { FakeFirestore } from '../testing/fake-firestore';
import { UserService } from '../users/user.service';

describe('get_grammar_patterns (scenario generation tool)', () => {
  async function setup() {
    const db = new FakeFirestore();
    const none = {} as any;
    const svc = new ScenarioKnowledgeService(db as any, none, none, none, new UserService(db as any));
    const kus = db.collection('knowledge-units');
    await kus.doc('g-flag-false').set({ type: 'Grammar', content: 'A', data: { jlptLevel: 'N5' } });
    await kus.doc('g-no-flag').set({ type: 'Grammar', content: 'B', data: { jlptLevel: 'N5' } });
    await kus.doc('g-above').set({ type: 'Grammar', content: 'C', data: { jlptLevel: 'N5' } });
    await kus.doc('g-n4').set({ type: 'Grammar', content: 'D', data: { jlptLevel: 'N4' } });
    const ukus = db.collection('users').doc('u1').collection('user-kus');
    await ukus.doc('1').set({ kuId: 'g-flag-false', aboveLevel: false });
    await ukus.doc('2').set({ kuId: 'g-no-flag' }); // older enrolment, or the flag isn't written yet
    await ukus.doc('3').set({ kuId: 'g-above', aboveLevel: true });
    await ukus.doc('4').set({ kuId: 'g-n4', aboveLevel: false });
    const tool = svc.buildGrammarToolHandlers('u1').get_grammar_patterns;
    return { tool, db };
  }

  it('includes enrolments with no aboveLevel field, leaves out above-level ones and other levels', async () => {
    const { tool } = await setup();
    const { patterns } = await tool({ jlptLevel: 'N5' });
    expect(patterns.map((p: any) => p.kuId).sort()).toEqual(['g-flag-false', 'g-no-flag']);
  });

  it("uses the learner's level when the model doesn't pass one (N5 if never chosen)", async () => {
    const { tool, db } = await setup();
    expect((await tool({})).patterns.map((p: any) => p.kuId).sort()).toEqual(['g-flag-false', 'g-no-flag']);
    await db.collection('users').doc('u1').set({ preferences: { jlptLevel: 'N4' } });
    expect((await tool({})).patterns.map((p: any) => p.kuId)).toEqual(['g-n4']);
  });
});
