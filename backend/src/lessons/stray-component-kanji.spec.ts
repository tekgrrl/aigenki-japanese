import { dropStrayComponentKanji } from './lessons.service';
import { Lesson, VocabLesson } from '../types';

const kanji = (k: string) => ({ kanji: k, reading: '', meaning: '' });
const vocab = (word: string, components: string[]): VocabLesson => ({
  type: 'Vocab', vocab: word, reading: '', definitions: [], partOfSpeech: 'noun',
  meaning_explanation: '', reading_explanation: '', component_kanji: components.map(kanji),
});

describe('dropStrayComponentKanji', () => {
  it('drops a kanji the kana word does not contain (こう → 斯)', () => {
    const out = dropStrayComponentKanji(vocab('こう', ['斯'])) as VocabLesson;
    expect(out.component_kanji).toEqual([]);
  });

  it('keeps the real kanji of a mixed word and drops the kana part\'s kanji (今どき → 今, not 時)', () => {
    const out = dropStrayComponentKanji(vocab('今どき', ['今', '時'])) as VocabLesson;
    expect(out.component_kanji!.map(k => k.kanji)).toEqual(['今']);
  });

  it('drops a multi-character entry not in the word (コーヒー → 珈琲)', () => {
    const out = dropStrayComponentKanji(vocab('コーヒー', ['珈琲'])) as VocabLesson;
    expect(out.component_kanji).toEqual([]);
  });

  it('returns the same object when nothing is stray', () => {
    const lesson = vocab('食べる', ['食']);
    expect(dropStrayComponentKanji(lesson)).toBe(lesson);
  });

  it('leaves non-Vocab lessons and lessons without component_kanji alone', () => {
    const grammar = { type: 'Grammar', pattern: 'ます' } as unknown as Lesson;
    expect(dropStrayComponentKanji(grammar)).toBe(grammar);
    const bare = { ...vocab('こう', []), component_kanji: undefined };
    expect(dropStrayComponentKanji(bare)).toBe(bare);
  });
});
