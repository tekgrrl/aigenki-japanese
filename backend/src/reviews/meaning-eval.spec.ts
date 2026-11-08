import { ReviewsService } from './reviews.service';
import { FakeFirestore } from '../testing/fake-firestore';

const kurai = {
  type: 'Vocab',
  vocab: '暗い',
  definitions: ['dark'],
  usages: [
    { id: 'dark', label: 'dark (lacking light)', meaning: 'dark', acceptedAnswers: ['dim'] },
    { id: 'unfam', label: 'unfamiliar with', meaning: 'unfamiliar with', acceptedAnswers: ['ignorant of'] },
  ],
};

function makeService(ai: { result: 'pass' | 'fail'; usageId?: string; misspelled?: boolean } = { result: 'fail' }) {
  const db = new FakeFirestore();
  db.store('lessons').set('k', structuredClone(kurai));
  const gemini = { evaluateAnswer: jest.fn().mockResolvedValue({ explanation: '', ...ai }) };
  const none = {} as any;
  const service = new ReviewsService(db as any, gemini as any, none, none, none, none, none, none, none, none, none);
  return { service, gemini, db };
}

const evaluate = (service: ReviewsService, answer: string) =>
  service.evaluateAnswer('u', answer, ['dark'], '暗い', '暗い', '', 'k', 'Content-to-Definition', 'f');

describe('evaluateAnswer: the Vocab meaning card', () => {
  it('matches any usage locally and says which', async () => {
    const { service, gemini } = makeService();
    const out = await evaluate(service, 'Ignorant of');
    expect(out).toMatchObject({ result: 'pass', usageId: 'unfam' });
    expect(gemini.evaluateAnswer).not.toHaveBeenCalled();
  });

  it('asks the AI with the usage ids when nothing matches, and remembers the accepted answer on that usage', async () => {
    const { service, gemini, db } = makeService({ result: 'pass', usageId: 'unfam' });
    const out = await evaluate(service, 'clueless about');
    expect(out).toMatchObject({ result: 'pass', usageId: 'unfam', addedAlternative: 'clueless about' });
    expect(gemini.evaluateAnswer.mock.calls[0][4]).toEqual(['dark', 'unfam']);
    expect(db.store('lessons').get('k')!.usages[1].acceptedAnswers).toEqual(['ignorant of', 'clueless about']);
  });

  it('a pass forgiven as a misspelling counts but is not stored', async () => {
    const { service, db } = makeService({ result: 'pass', usageId: 'dark', misspelled: true } as any);
    const out = await evaluate(service, 'drak');
    expect(out).toMatchObject({ result: 'pass', usageId: 'dark' });
    expect(out).not.toHaveProperty('addedAlternative');
    expect(db.store('lessons').get('k')!.usages[0].acceptedAnswers).toEqual(['dim']);
  });

  it('a pass with no matching usage proves nothing and stores nothing', async () => {
    const { service, db } = makeService({ result: 'pass', usageId: 'none' });
    const out = await evaluate(service, 'shady');
    expect(out.result).toBe('pass');
    expect(out).not.toHaveProperty('usageId');
    expect(db.store('lessons').get('k')!.usages).toEqual(kurai.usages);
  });

  it('uses the old path for a lesson without usages', async () => {
    const { service, gemini, db } = makeService();
    db.store('lessons').set('k', { type: 'Vocab', vocab: '暗い', definitions: ['dark'] });
    const out = await evaluate(service, 'dark');
    expect(out).toMatchObject({ result: 'pass' });
    expect(gemini.evaluateAnswer).not.toHaveBeenCalled();
  });
});
