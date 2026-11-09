import { ReviewOutcomeService, GradedReview } from './review-outcome.service';
import { FakeFirestore } from '../testing/fake-firestore';
import { TutorContextService } from '../tutor-context/tutor-context.service';
import { DailyPlanService } from '../daily-plan/daily-plan.service';
import { FacetStore } from '../facets/facet-store';

/** ReviewOutcomeService with mocked collaborators; calls are logged in order to check sequencing. */
function setup(ku: Record<string, any> = { type: 'Vocab', content: '川', data: {} }) {
  const calls: string[] = [];
  const log = (name: string, impl: (...a: any[]) => any = () => undefined) =>
    jest.fn(async (...args: any[]) => { calls.push(`${name}(${args.slice(1).join(',')})`); return impl(...args); });
  const deps = {
    learningProgress: { recomputeAndCache: log('recompute') },
    reviewProgress: { checkAndAdvanceStage: log('advance') },
    ukus: { findByKuId: log('findUku', () => null) },
    scenarios: { checkAndSetVocabReady: log('vocabReady') },
    kus: { findOne: log('findKu', () => ({ id: 'k', ...ku })) },
    tutorContext: { updateLeech: log('leech') },
    dailyPlan: { recordPromotion: log('promotion') },
    flash: { start: log('flash') },
  };
  const service = new ReviewOutcomeService(
    deps.learningProgress as any, deps.reviewProgress as any, deps.ukus as any, deps.scenarios as any,
    deps.kus as any, deps.tutorContext as any, deps.dailyPlan as any, deps.flash as any,
  );
  return { service, calls, deps };
}

const graded = (over: Partial<GradedReview> = {}): GradedReview => ({
  result: 'pass', facetId: 'f', facetType: 'Content-to-Definition', kuId: 'k',
  prevStage: 1, newStage: 2, prevConsecutiveFailures: 0, newConsecutiveFailures: 0, ...over,
});

describe('ReviewOutcomeService.onGraded', () => {
  it('advances the sequence before recomputing status (F-001), then the component kanji', async () => {
    const { service, calls } = setup();
    await service.onGraded('u', graded({ targetKuId: 'kanji' }));
    expect(calls.slice(0, 3)).toEqual(['advance(k)', 'recompute(k)', 'recompute(kanji)']);
  });

  it('only recomputes when the stage did not move up', async () => {
    const { service, calls } = setup();
    await service.onGraded('u', graded({ result: 'fail', newStage: 0 }));
    expect(calls).toEqual(['recompute(k)']);
  });

  it('a failing step does not skip the later ones: leech failure still records the promotion', async () => {
    const { service, deps } = setup();
    deps.tutorContext.updateLeech.mockRejectedValueOnce(new Error('contention'));
    deps.learningProgress.recomputeAndCache.mockRejectedValueOnce(new Error('boom'));
    await service.onGraded('u', graded({ prevConsecutiveFailures: 2 }));
    expect(deps.tutorContext.updateLeech).toHaveBeenCalled();
    expect(deps.dailyPlan.recordPromotion).toHaveBeenCalled();
  });

  it('picture-choice: no KU read, no tutor context, no daily plan', async () => {
    const { service, deps } = setup();
    await service.onGraded('u', graded({ facetType: 'picture-choice', newConsecutiveFailures: 3 }));
    expect(deps.kus.findOne).not.toHaveBeenCalled();
    expect(deps.tutorContext.updateLeech).not.toHaveBeenCalled();
    expect(deps.dailyPlan.recordPromotion).not.toHaveBeenCalled();
  });

  it('no leech change and no promotion: no KU read', async () => {
    const { service, deps } = setup();
    await service.onGraded('u', graded({ result: 'fail', newStage: 0, newConsecutiveFailures: 1 }));
    expect(deps.kus.findOne).not.toHaveBeenCalled();
  });

  it('Grammar crossing an SRS level without a Flash chain: promotion plus a scenario opportunity', async () => {
    const { service, deps } = setup({ type: 'Grammar', content: 'て-form', data: {} });
    await service.onGraded('u', graded({ prevStage: 3, newStage: 4 }));
    const [, , opportunity] = deps.dailyPlan.recordPromotion.mock.calls[0];
    expect(opportunity).toMatchObject({ kuId: 'k', type: 'Grammar' });
    expect(deps.flash.start).not.toHaveBeenCalled();
  });

  it('scenarioReady Grammar promoted to stage 3: Flash chain, no opportunity', async () => {
    const { service, deps } = setup({ type: 'Grammar', content: 'て-form', data: { scenarioReady: true } });
    await service.onGraded('u', graded({ prevStage: 2, newStage: 3 }));
    expect(deps.dailyPlan.recordPromotion.mock.calls[0][2]).toBeUndefined();
    expect(deps.flash.start).toHaveBeenCalledWith('u', 'k');
  });
});

describe('TutorContextService.updateLeech', () => {
  it('adds to leechVocab and weakGrammarPoints for Grammar, and removes one facet type again', async () => {
    const db = new FakeFirestore();
    await db.collection('users').doc('u').set({ tutorContext: { leechVocab: [{ content: 'て', facetTypes: ['sentence-assembly'] }] } });
    const tc = new TutorContextService(db as any, {} as any, {} as any);
    await tc.updateLeech('u', 'て', 'AI-Generated-Question', 'add', true);
    let ctx = db.store('users').get('u')!.tutorContext;
    expect(ctx.leechVocab).toEqual([{ content: 'て', facetTypes: ['sentence-assembly', 'AI-Generated-Question'] }]);
    expect(ctx.weakGrammarPoints).toEqual([{ content: 'て', facetTypes: ['AI-Generated-Question'] }]);
    await tc.updateLeech('u', 'て', 'AI-Generated-Question', 'remove', true);
    ctx = db.store('users').get('u')!.tutorContext;
    expect(ctx.leechVocab).toEqual([{ content: 'て', facetTypes: ['sentence-assembly'] }]);
    expect(ctx.weakGrammarPoints).toEqual([]);
  });
});

describe('DailyPlanService.recordPromotion', () => {
  // FakeFirestore clones docs on read, which strips Timestamp methods, so age pruning isn't covered here.
  it('writes the promotion and the opportunity in one go', async () => {
    const db = new FakeFirestore();
    await db.collection('users').doc('u').set({ stats: {} });
    const plan = new DailyPlanService(db as any, new FacetStore(db as any));
    await plan.recordPromotion('u', { kuId: 'k', content: 'て', type: 'Grammar', srsStage: 4 }, { kuId: 'k', content: 'て', type: 'Grammar', newLevel: 'Kaisho' });
    const stats = db.store('users').get('u')!.stats;
    expect(stats.recentlyPromoted).toEqual([expect.objectContaining({ kuId: 'k', srsStage: 4 })]);
    expect(stats.scenarioOpportunities).toEqual([expect.objectContaining({ kuId: 'k', newLevel: 'Kaisho' })]);
  });

  it('leaves scenarioOpportunities alone without an opportunity', async () => {
    const db = new FakeFirestore();
    await db.collection('users').doc('u').set({ stats: { scenarioOpportunities: [{ kuId: 'x' }] } });
    const plan = new DailyPlanService(db as any, new FacetStore(db as any));
    await plan.recordPromotion('u', { kuId: 'k', content: 'て', type: 'Grammar', srsStage: 2 });
    expect(db.store('users').get('u')!.stats.scenarioOpportunities).toEqual([{ kuId: 'x' }]);
  });
});
