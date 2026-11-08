import { QuestionsService } from './questions.service';
import { FakeFirestore } from '../testing/fake-firestore';

const usages = [
  { id: 'dark', label: 'dark (lacking light)', meaning: 'dark', acceptedAnswers: [] },
  { id: 'unfam', label: 'unfamiliar with', meaning: 'unfamiliar with', acceptedAnswers: [] },
];
const question = (id: string, usageId?: string) => ({
  id, kuId: 'k', rank: 50, rejectionCount: 0, ...(usageId ? { usageId } : {}),
  data: { question: `q-${id}`, answer: '暗い', difficulty: 'JLPT-N5' },
});

function setup(lessonUsages = usages) {
  const db = new FakeFirestore();
  db.store('lessons').set('k', { type: 'Vocab', vocab: '暗い', definitions: ['dark'], usages: lessonUsages });
  db.store('questions').set('qDark', question('qDark', 'dark'));
  db.store('questions').set('qOld', question('qOld'));
  const gemini = { generateWithTools: jest.fn().mockResolvedValue({ question: 'new', answer: '暗い' }) };
  const kus = { findOne: jest.fn().mockResolvedValue({ type: 'Vocab', content: '暗い', data: { reading: 'くらい', definition: 'dark, gloomy' } }) };
  const service = new QuestionsService(db as any, gemini as any, {} as any, kus as any, {} as any);
  return { service, gemini, db };
}

describe('selectQuestion for a usage', () => {
  it('reuses a question written for that usage', async () => {
    const { service, gemini } = setup();
    const r = await service.selectQuestion('u', 'k', '', '暗い', 'dark');
    expect(r).toMatchObject({ questionId: 'qDark', usageId: 'dark' });
    expect(gemini.generateWithTools).not.toHaveBeenCalled();
  });

  it('generates a question for a usage that has none, asking about that usage and storing it', async () => {
    const { service, gemini, db } = setup();
    const r = await service.selectQuestion('u', 'k', '', '暗い', 'unfam');
    expect(r.usageId).toBe('unfam');
    expect(gemini.generateWithTools.mock.calls[0][0]).toContain('Meaning: unfamiliar with');
    expect(db.store('questions').get(r.questionId)!.usageId).toBe('unfam');
  });

  it('a one-usage word can reuse an older question with no usage', async () => {
    const { service, db, gemini } = setup([usages[0]]);
    db.store('questions').delete('qDark');
    const r = await service.selectQuestion('u', 'k', '', '暗い', 'dark');
    expect(r.questionId).toBe('qOld');
    expect(gemini.generateWithTools).not.toHaveBeenCalled();
  });

  it('without a usage, any suitable question will do (Grammar, Concept, old Vocab cards)', async () => {
    const { service } = setup();
    const r = await service.selectQuestion('u', 'k', '', '暗い');
    expect(['qDark', 'qOld']).toContain(r.questionId);
  });
});
