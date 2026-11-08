import { LessonsService } from './lessons.service';
import { FakeFirestore } from '../testing/fake-firestore';

const lesson = () => ({
  type: 'Vocab',
  vocab: '子供',
  definitions: ['child', 'children', 'kid', 'brat'],
  context_examples: [
    { sentence: '子供が遊んでいる。', translation: 'Children are playing.', usage: 'young person' },
    { sentence: '子供が二人います。', translation: 'I have two kids.', usage: "one's offspring" },
  ],
});
const merged = { usages: [{ label: 'child', meaning: 'child', acceptedAnswers: ['children', 'kid'] }], exampleUsages: [0, 0], setAside: [] };

function setup(raw: unknown) {
  const db = new FakeFirestore();
  db.store('lessons').set('k', lesson());
  const gemini = { buildExampleUsages: jest.fn().mockResolvedValue(raw) };
  const none = {} as any;
  const service = new LessonsService(db as any, gemini as any, none, none, none);
  return { service, gemini, db };
}

describe('buildVocabUsages', () => {
  it('only labels with a picture are fixed, so others can be merged', async () => {
    const { service, gemini, db } = setup(merged);
    db.store('pictures').set('p', { kuId: 'k', status: 'approved', subject: { kind: 'ku-usage', kuId: 'k', usage: 'Young Person' } });
    db.store('pictures').set('r', { kuId: 'k', status: 'rejected', subject: { kind: 'ku-usage', kuId: 'k', usage: "one's offspring" } });
    await service.buildVocabUsages('k');
    expect(gemini.buildExampleUsages.mock.calls[0][3]).toEqual(['young person', null]);
  });

  it('merges unpictured labels and sets aside a definition no usage covers', async () => {
    const { service, db } = setup(merged);
    const r = await service.buildVocabUsages('k');
    expect(r.saved).toBe(true);
    const l = db.store('lessons').get('k')!;
    expect(l.usages.map((u: any) => u.meaning)).toEqual(['child']);
    expect(l.usageSetAside).toEqual(['brat']);
    expect(r.built?.usages[0].id).toBe(l.usages[0].id);
  });

  it('remembers a rejected build and skips lazy retries until the examples change', async () => {
    const twoSame = { usages: [{ label: 'a', meaning: 'child', acceptedAnswers: [] }, { label: 'b', meaning: 'child', acceptedAnswers: [] }], exampleUsages: [0, 1], setAside: [] };
    const { service, gemini, db } = setup(twoSame);
    expect((await service.buildVocabUsages('k')).saved).toBe(false);
    await service.buildVocabUsages('k');
    expect(gemini.buildExampleUsages).toHaveBeenCalledTimes(1);
    await service.buildVocabUsages('k', true);
    expect(gemini.buildExampleUsages).toHaveBeenCalledTimes(2);
    db.store('lessons').set('k', { ...db.store('lessons').get('k')!, context_examples: [{ sentence: '新しい', translation: 'new' }] });
    await service.buildVocabUsages('k');
    expect(gemini.buildExampleUsages).toHaveBeenCalledTimes(3);
  });

  it('keeps the ids already stored when the write happens', async () => {
    const { service, db } = setup(merged);
    const original = (service as any).saveBuiltUsages.bind(service);
    // Simulate a concurrent build landing between the read and the write.
    jest.spyOn(service as any, 'saveBuiltUsages').mockImplementation(async (...args: any[]) => {
      const l = db.store('lessons').get('k')!;
      db.store('lessons').set('k', { ...l, usages: [{ id: 'keep01', label: 'child', meaning: 'child', acceptedAnswers: [] }] });
      return original(...args);
    });
    await service.buildVocabUsages('k');
    expect(db.store('lessons').get('k')!.usages[0].id).toBe('keep01');
  });
});
