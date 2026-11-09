import { ReviewsService } from './reviews.service';
import { FakeFirestore } from '../testing/fake-firestore';
import { FacetStore } from '../facets/facet-store';

/** ReviewsService with only the collaborators evaluateAnswer touches. */
function makeService(kanjiAlive: string[], aiResult: 'pass' | 'fail' = 'fail') {
  const gemini = { evaluateAnswer: jest.fn().mockResolvedValue({ result: aiResult, explanation: '' }) };
  const kanji = { getKanjiAliveMeanings: jest.fn().mockResolvedValue(kanjiAlive) };
  const none = {} as any;
  const fdb = new FakeFirestore();
  const service = new ReviewsService(fdb as any, new FacetStore(fdb as any), gemini as any, none, none, none, none, none, none, none, kanji as any, none, none, none);
  return { service, gemini, kanji };
}

describe('evaluateAnswer: Kanji-Component-Meaning accepts Kanji Alive meanings', () => {
  it('passes locally on a Kanji Alive meaning missing from the facet (会: "meet")', async () => {
    const { service, gemini } = makeService(['meet', 'society']);
    const out = await service.evaluateAnswer('u', 'meet', ['meeting', 'association', 'to meet'], '会', '会', '', 'k', 'Kanji-Component-Meaning');
    expect(out.result).toBe('pass');
    expect(gemini.evaluateAnswer).not.toHaveBeenCalled();
  });

  it('sends the merged list to the AI when nothing matches locally', async () => {
    const { service, gemini } = makeService(['meet', 'society']);
    await service.evaluateAnswer('u', 'gathering', ['meeting'], '会', '会', '', 'k', 'Kanji-Component-Meaning');
    expect(gemini.evaluateAnswer.mock.calls[0][2]).toEqual(['meeting', 'meet', 'society']);
  });

  it('never looks Kanji Alive up when the facet\'s own answers match (川: "river")', async () => {
    const { service, kanji, gemini } = makeService(['river']);
    const out = await service.evaluateAnswer('u', 'river', ['river'], '川', '川', '', 'k', 'Kanji-Component-Meaning');
    expect(out.result).toBe('pass');
    expect(kanji.getKanjiAliveMeanings).not.toHaveBeenCalled();
    expect(gemini.evaluateAnswer).not.toHaveBeenCalled();
  });

  it('leaves other facet types alone', async () => {
    const { service, kanji } = makeService(['meet']);
    const out = await service.evaluateAnswer('u', 'meet', ['meeting'], '会う', '会う', '', 'k', 'Content-to-Definition');
    expect(kanji.getKanjiAliveMeanings).not.toHaveBeenCalled();
    expect(out.result).toBe('fail');
  });
});
