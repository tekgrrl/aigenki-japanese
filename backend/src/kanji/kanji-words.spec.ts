import { KanjiService } from './kanji.service';
import { FakeFirestore } from '../testing/fake-firestore';

describe('KanjiService.getWordsUsing (words on kanji reviews)', () => {
  let db: FakeFirestore;
  let words: any[];
  let service: KanjiService;
  const vocab = (id: string, content: string, definition: string, jlptLevel?: string) =>
    ({ id, type: 'Vocab', content, data: { definition, ...(jlptLevel ? { jlptLevel } : {}) } });

  beforeEach(() => {
    db = new FakeFirestore();
    words = [];
    const kus = { findByKanjiComponent: jest.fn(async () => words) };
    const config = { get: () => '' };
    service = new KanjiService(config as any, kus as any, {} as any, db as any);
  });

  const enroll = (uid: string, kuId: string) => db.collection('users').doc(uid).collection('user-kus').doc().set({ kuId });

  it('puts the review\'s own word first, then the user\'s words, then lowest JLPT level', async () => {
    words = [
      vocab('n3', '台風', 'typhoon', 'N3'),
      vocab('n5', '風', 'wind', 'N5'), // the kanji itself as a word: excluded
      vocab('mine', '風呂', 'bath', 'N4'),
      vocab('from', '風邪', 'cold (illness)', 'N4'),
      vocab('n5b', '洋風', 'Western style', 'N5'),
    ];
    await enroll('u1', 'mine');
    const out = await service.getWordsUsing('u1', '風', 'from');
    expect(out.map(w => w.content)).toEqual(['風邪', '風呂', '洋風']);
  });

  it('shows the first sense only and skips stub words without a definition', async () => {
    words = [vocab('a', '西洋', ''), vocab('b', '洋服', 'Western clothes; clothing'), vocab('c', '太平洋', 'Pacific Ocean, the Pacific')];
    const out = await service.getWordsUsing('u1', '洋');
    expect(out).toEqual([
      { kuId: 'b', content: '洋服', meaning: 'Western clothes' },
      { kuId: 'c', content: '太平洋', meaning: 'Pacific Ocean' },
    ]);
  });

  it('returns at most three, and finds enrolled words beyond the first 30 candidates', async () => {
    words = Array.from({ length: 40 }, (_, i) => vocab(`w${i}`, `食${i}`, `m${i}`, 'N3'));
    await enroll('u1', 'w35');
    const out = await service.getWordsUsing('u1', '食');
    expect(out).toHaveLength(3);
    expect(out[0].kuId).toBe('w35');
  });
});
