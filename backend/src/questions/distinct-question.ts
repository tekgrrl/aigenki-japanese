/** Keeps a newly generated AI question from repeating one the word already has. */

export interface QuestionText {
  question: string;
  answer: string;
}

/** The kana and kanji in a text (Japanese only, no spacing or punctuation). */
const japaneseIn = (text: string): string =>
  (text.match(/[぀-ヿ㐀-鿿々]/g) ?? []).join('');

/**
 * Two questions are the same when they want the same answer and quote the same Japanese.
 * Wording around them doesn't count: "Correct the error… complete, corrected Japanese sentence"
 * and "…complete corrected sentence" with the same quoted sentence are one question, and two
 * English sentences to translate into the same Japanese are one question too.
 */
export function sameQuestion(a: QuestionText, b: QuestionText): boolean {
  return japaneseIn(a.answer) === japaneseIn(b.answer)
    && japaneseIn(a.answer) !== ''
    && japaneseIn(a.question) === japaneseIn(b.question);
}

/** How many of the word's existing questions are listed for Gemini to avoid (newest first). */
export const MAX_AVOID = 10;

/**
 * The note sent with a generation request listing the word's existing questions, so Gemini writes
 * a different one. Empty when there are none.
 */
export function alreadyUsedNote(existing: QuestionText[]): string {
  if (existing.length === 0) return '';
  const lines = existing.slice(0, MAX_AVOID).map(q => `- ${q.question} → ${q.answer}`);
  return `These questions already exist for this item. Write a different question, with a different answer sentence:\n${lines.join('\n')}`;
}
