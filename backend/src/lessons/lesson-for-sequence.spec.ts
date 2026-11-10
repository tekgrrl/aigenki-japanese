import { LessonsService } from './lessons.service';
import { FakeFirestore } from '../testing/fake-firestore';
import { UserService } from '../users/user.service';

describe('LessonsService.lessonForSequence', () => {
  function setup() {
    const db = new FakeFirestore();
    const kanjiLesson = { type: 'Kanji', kanji: '川', meaning: 'river', onyomi: ['セン'], kunyomi: ['かわ'] };
    const kanji = { getKanjiDetails: jest.fn().mockResolvedValue(kanjiLesson) };
    const service = new LessonsService(db as any, {} as any, {} as any, {} as any, kanji as any, new UserService(db as any));
    return { db, kanji, kanjiLesson, service };
  }

  it("gives a Kanji its lesson live from Kanji Alive (Kanji lessons are never stored)", async () => {
    const { service, kanji, kanjiLesson } = setup();
    const lesson = await service.lessonForSequence('u1', { id: 'k-river', type: 'Kanji', content: '川' } as any);
    expect(lesson).toEqual(kanjiLesson);
    expect(kanji.getKanjiDetails).toHaveBeenCalledWith('u1', '川', 'k-river');
  });

  it('gives other KUs their stored lesson, or null', async () => {
    const { service, db, kanji } = setup();
    await db.collection('lessons').doc('v1').set({ type: 'Vocab', vocab: '言葉', definitions: ['word'] });
    expect(await service.lessonForSequence('u1', { id: 'v1', type: 'Vocab', content: '言葉' } as any)).toMatchObject({ vocab: '言葉' });
    expect(await service.lessonForSequence('u1', { id: 'none', type: 'Vocab', content: 'x' } as any)).toBeNull();
    expect(kanji.getKanjiDetails).not.toHaveBeenCalled();
  });
});
