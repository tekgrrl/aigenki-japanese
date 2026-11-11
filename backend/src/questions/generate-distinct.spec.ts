import { QuestionsService } from './questions.service';
import { FakeFirestore } from '../testing/fake-firestore';
import { FacetStore } from '../facets/facet-store';

const KU = 'kara';
const OLD = { question: 'Correct the error: "学校は九時にからです。"', answer: '学校は九時からです。' };

async function setup() {
  const db = new FakeFirestore();
  const service = new QuestionsService(db as any, {} as any, new FacetStore(db as any), {} as any, {} as any);
  await db.collection('questions').doc('q1').set({ kuId: KU, createdAt: '2026-11-11T12:21:17.000Z', data: OLD });
  await db.collection('questions').doc('other').set({ kuId: 'someone-else', createdAt: '2026-11-11T12:00:00.000Z', data: { question: 'X', answer: 'ほか' } });
  const generateDistinct = (generate: (note: string) => Promise<any>) => (service as any).generateDistinct(KU, '{N}から', generate);
  return { generateDistinct };
}

describe('QuestionsService.generateDistinct', () => {
  it("sends the word's existing questions with the request, and keeps a new question", async () => {
    const { generateDistinct } = await setup();
    const generate = jest.fn().mockResolvedValue({ question: 'Translate: "The shop opens at ten."', answer: '店は十時からです。' });
    expect(await generateDistinct(generate)).toEqual({ question: 'Translate: "The shop opens at ten."', answer: '店は十時からです。' });
    expect(generate).toHaveBeenCalledTimes(1);
    const note = generate.mock.calls[0][0] as string;
    expect(note).toContain(OLD.question);
    expect(note).not.toContain('ほか'); // another word's question
  });

  it('retries once when Gemini repeats an existing question, naming the repeat', async () => {
    const { generateDistinct } = await setup();
    const repeat = { question: 'Correct the error and give the complete corrected sentence: "学校は九時にからです。"', answer: '学校は九時からです。' };
    const fresh = { question: 'Correct the error: "銀行は十時にからです。"', answer: '銀行は十時からです。' };
    const generate = jest.fn().mockResolvedValueOnce(repeat).mockResolvedValueOnce(fresh);
    expect(await generateDistinct(generate)).toEqual(fresh);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0]).toContain('Your previous attempt repeated this one');
  });

  it('saves the retry even if it repeats again (a card needs a question), without a third call', async () => {
    const { generateDistinct } = await setup();
    const generate = jest.fn().mockResolvedValue(OLD);
    expect(await generateDistinct(generate)).toEqual(OLD);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
