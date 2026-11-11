import { alreadyUsedNote, sameQuestion, MAX_AVOID } from './distinct-question';

describe('sameQuestion', () => {
  it('treats reworded instructions around the same quoted sentence and answer as the same', () => {
    expect(sameQuestion(
      { question: 'Correct the error in the following sentence and provide the complete, corrected Japanese sentence: "学校は九時にからです。"', answer: '学校は九時からです。' },
      { question: 'Correct the error in the following sentence and provide the complete corrected sentence: "学校は九時にからです。"', answer: '学校は 九時から です' },
    )).toBe(true);
  });

  it('treats two English sentences translating to the same Japanese as the same', () => {
    expect(sameQuestion(
      { question: 'Translate: "Do you have water?"', answer: '水はありますか。' },
      { question: 'Translate into Japanese (asking a server): "Do you have water?"', answer: '水はありますか' },
    )).toBe(true);
  });

  it('keeps questions apart when the quoted sentence or the answer differs', () => {
    expect(sameQuestion(
      { question: 'Correct: "学校は九時にからです。"', answer: '学校は九時からです。' },
      { question: 'Correct: "銀行は九時までからです。"', answer: '銀行は九時からです。' },
    )).toBe(false);
    expect(sameQuestion(
      { question: 'Translate: "School starts at nine."', answer: '学校は九時からです。' },
      { question: 'Translate: "The bank opens at ten."', answer: '銀行は十時からです。' },
    )).toBe(false);
  });

  it('never matches answers with no Japanese in them', () => {
    expect(sameQuestion({ question: 'What does 高い mean?', answer: 'expensive' }, { question: 'What does 高い mean?', answer: 'tall' })).toBe(false);
  });
});

describe('alreadyUsedNote', () => {
  it('is empty with nothing to avoid, and lists at most MAX_AVOID questions', () => {
    expect(alreadyUsedNote([])).toBe('');
    const many = Array.from({ length: MAX_AVOID + 3 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));
    const note = alreadyUsedNote(many);
    expect(note.split('\n').filter(l => l.startsWith('- '))).toHaveLength(MAX_AVOID);
    expect(note).toContain('- Q0 → A0');
  });
});
