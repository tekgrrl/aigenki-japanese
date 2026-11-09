import { ReviewsService } from './reviews.service';
import { FakeFirestore } from '../testing/fake-firestore';
import { FacetStore } from '../facets/facet-store';

const usages = ['dark', 'gloom', 'unfam'].map(id => ({ id, label: id, meaning: id, acceptedAnswers: [] }));

/** ReviewsService with a Vocab meaning card at `srsStage`, and stubs for the post-update side effects. */
function setup(srsStage: number, provenUsageIds: string[] = [], lessonUsages = usages) {
  const db = new FakeFirestore();
  db.store('lessons').set('k', { type: 'Vocab', vocab: '暗い', definitions: ['dark'], usages: lessonUsages });
  db.store('users/u/review-facets').set('f', {
    kuId: 'k', facetType: 'Content-to-Definition', srsStage, provenUsageIds, nextReviewAt: new Date(0), consecutiveFailures: 0,
  });
  const quiet = new Proxy({}, { get: () => jest.fn().mockResolvedValue(undefined) }) as any;
  const service = new ReviewsService(db as any, new FacetStore(db as any), quiet, quiet, quiet, quiet, quiet, quiet, quiet, quiet, quiet, quiet, quiet, quiet);
  const facet = () => db.store('users/u/review-facets').get('f')!;
  return { service, facet };
}

describe('updateFacetSrs: the Vocab meaning card', () => {
  it('holds the stage until every usage is proven, then moves up and clears the record', async () => {
    const { service, facet } = setup(2);
    let r = await service.updateFacetSrs('u', 'f', 'pass', 'dark');
    expect(r).toMatchObject({ newStage: 2, provenUsageIds: ['dark'], totalUsages: 3, outcome: 'hold' });
    await service.updateFacetSrs('u', 'f', 'pass', 'gloom');
    r = await service.updateFacetSrs('u', 'f', 'pass', 'unfam');
    expect(r).toMatchObject({ newStage: 3, provenUsageIds: [], outcome: 'promote' });
    expect(facet().srsStage).toBe(3);
  });

  it('a held pass reschedules at the current stage interval', async () => {
    const { service, facet } = setup(2);
    await service.updateFacetSrs('u', 'f', 'pass', 'dark');
    expect(new Date(facet().nextReviewAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('a held pass at stage 0 waits the stage-0 interval instead of coming straight back', async () => {
    const { service, facet } = setup(0);
    await service.updateFacetSrs('u', 'f', 'pass', 'dark');
    expect(new Date(facet().nextReviewAt).getTime()).toBeGreaterThan(Date.now() + 60_000);
  });

  it('a wrong answer with nothing proven is a normal fail', async () => {
    const { service, facet } = setup(4);
    const r = await service.updateFacetSrs('u', 'f', 'fail');
    expect(r).toMatchObject({ newStage: 2, outcome: 'fail' });
    expect(facet().consecutiveFailures).toBe(1);
  });

  it('a wrong answer after a usage is proven keeps the stage and record, and waits the stage interval', async () => {
    const { service, facet } = setup(4, ['dark']);
    const r = await service.updateFacetSrs('u', 'f', 'fail');
    expect(r).toMatchObject({ newStage: 4, outcome: 'free-fail', provenUsageIds: ['dark'] });
    expect(facet()).toMatchObject({ srsStage: 4, provenUsageIds: ['dark'], consecutiveFailures: 0 });
    expect(new Date(facet().nextReviewAt).getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000);
  });

  it('a one-usage word moves up on any pass, as before', async () => {
    const { service } = setup(2, [], [usages[0]]);
    const r = await service.updateFacetSrs('u', 'f', 'pass');
    expect(r).toMatchObject({ newStage: 3, outcome: 'promote' });
  });
});
