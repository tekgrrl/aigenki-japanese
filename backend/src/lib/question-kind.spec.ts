import { guessQuestionKind } from './question-kind';

describe('guessQuestionKind', () => {
  it.each([
    ['Correct the error in the following sentence: "学校は九時にからです。"', 'error-correction'],
    ['The following Japanese sentence attempts to say "I have a fever" but contains a grammatical error: "熱をあります。"', 'error-correction'],
    ['Translate the following sentence into Japanese: "Which umbrella is yours?"', 'translation'],
    ['あまり[____]見ません', 'fill-in-the-blank'],
    ['Give the past potential form of 食べる', 'conjugation'],
    ['I am busy, so I cannot go to the party.', 'other'],
  ])('%s → %s', (question, kind) => {
    expect(guessQuestionKind(question)).toBe(kind);
  });
});
