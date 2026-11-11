/**
 * Best guess at an older question's kind from its text, for questions saved before `kind` was
 * stored (QuestionItem.kind). Display only (the admin Questions page): never written back.
 * Names match the prompt option keys where one fits.
 */
export function guessQuestionKind(question: string): string {
  if (/correct|fix|mistake|error|wrong|間違/i.test(question)) return 'error-correction';
  if (/translate|in japanese|into japanese/i.test(question)) return 'translation';
  if (/\[_+\]|＿|___/.test(question)) return 'fill-in-the-blank';
  if (/conjugat|form of/i.test(question)) return 'conjugation';
  return 'other';
}
