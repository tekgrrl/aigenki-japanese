/**
 * Prompts for answer and scenario evaluation.
 * Sources: backend/src/reviews/reviews.service.ts, backend/src/gemini/gemini.service.ts
 */

// ---------------------------------------------------------------------------
// Answer evaluator
// ---------------------------------------------------------------------------

/**
 * Builds the system prompt for evaluating a user's answer against expected answers.
 * Source: reviews.service.ts:evaluateAnswer
 *
 * Note: userAnswer and expectedAnswers are also passed separately as the user message
 * by GeminiService.evaluateAnswer — they appear here for full context framing.
 */
export function buildAnswerEvaluatorPrompt(
  question: string | undefined,
  topic: string | undefined,
  expectedAnswers: string[],
  userAnswer: string,
): string {
  return `You are a Japanese Language Learning evaluator. A user is being quizzed.
- The question was: "${question || 'N/A'}"
- The topic was: "${topic || 'N/A'}"
- The expected answer(s) are: "${JSON.stringify(expectedAnswers)}"
- The user's answer is: "${userAnswer}"

Your task is to evaluate if the user's answer is correct.
1.  Read the "expected answer(s)". This may be a single answer (e.g., "Family") or a comma-separated list of possible correct answers (e.g., "ドク, トク, よむ").
2.  Compare the user's answer to the list. The user is correct if their answer is *any one* of the items in the list.
3.  If you feel that the answer is correct but not in the list, return a pass with an explanation.
4.  Be lenient with hiragana vs katakana (e.g., if expected is "ドク" and user typed "どく", it's a pass).
5.  Be lenient with extra punctuation or whitespace.
6.  Provide your evaluation ONLY as a valid JSON object with the following schema:
{
  "result": "pass" | "fail",
  "explanation": "A brief, one-sentence explanation for *why* the user passed or failed, referencing their answer."
}
Example for a pass: {"result": "pass", "explanation": "Correct! よむ is one of the kun'yomi readings."}
Example for a fail: {"result": "fail", "explanation": "Incorrect. The expected readings were ドク, トク, or よむ."}
`;
}

/**
 * Evaluator for the Vocab meaning card: the learner saw the bare word and may give the meaning
 * of ANY of its usages. Returns pass/fail plus which usage the answer matched.
 * Source: reviews.service.ts:evaluateAnswer (Vocab Content-to-Definition)
 */
export function buildMeaningEvaluatorPrompt(
  word: string,
  usages: { id: string; label: string; meaning: string; acceptedAnswers: string[] }[],
  userAnswer: string,
): string {
  const list = usages
    .map(u => `- id "${u.id}": ${u.label ? `${u.label}: ` : ''}"${u.meaning}"${u.acceptedAnswers.length ? ` (also: ${u.acceptedAnswers.map(a => `"${a}"`).join(', ')})` : ''}`)
    .join('\n');
  return `You are a Japanese Language Learning evaluator. The learner was shown the Japanese word 「${word}」 on its own and asked what it means.
The word's usages (senses) are:
${list}

The learner's answer is: "${userAnswer}"

Rules:
1. The answer is correct if it gives the meaning of ANY ONE of the usages above. It does not need to match the wording: a synonym or natural paraphrase of one usage's meaning is a pass (e.g. "not knowledgeable about" for "unfamiliar with").
2. Set "usageId" to the id of the usage the answer means. If it passes but fits two usages, pick the closer one.
3. A meaning the word genuinely has but that is NOT in the list above is still a pass; set "usageId" to "none".
4. A wrong meaning, a meaning of a different word, or an answer too vague to identify a sense (e.g. "a thing") is a fail; set "usageId" to "none".
5. Be lenient with spelling mistakes that leave the word recognisable, with "to" before verbs, and with articles ("a", "the"). If the answer passes ONLY because you forgave a misspelling (e.g. "bu" or "beautifull"), set "misspelled" to true; otherwise false. Grammatical variants ("to wait" vs "wait") are not misspellings.
6. Provide your evaluation ONLY as a valid JSON object:
{
  "result": "pass" | "fail",
  "explanation": "A brief, one-sentence explanation referencing the learner's answer.",
  "usageId": "the matched usage id, or none",
  "misspelled": true | false
}
Example (word 暗い, answer "clueless about"): {"result": "pass", "explanation": "Correct! \"Clueless about\" fits the sense \"unfamiliar with\".", "usageId": "<the id of unfamiliar with>", "misspelled": false}
Example (word 暗い, answer "bright"): {"result": "fail", "explanation": "Incorrect. 暗い means dark, gloomy, or unfamiliar with; \"bright\" is the opposite.", "usageId": "none", "misspelled": false}
`;
}

// ---------------------------------------------------------------------------
// Scenario evaluator
// ---------------------------------------------------------------------------

export type ScenarioEvalContext = {
  title: string;
  goal: string;
  difficulty: string;
  userRole?: string;
  aiRole?: string;
  isObjectiveMet: boolean;
};

/**
 * Builds the full evaluation prompt for a completed roleplay scenario.
 * Includes history formatting logic (previously inline in GeminiService.evaluateScenario).
 * Source: gemini.service.ts:evaluateScenario
 */
export function buildScenarioEvaluatorPrompt(
  chatHistory: { speaker: string; text: string }[],
  context: ScenarioEvalContext,
): string {
  const historyText = chatHistory.map((m) => {
    const isUser = m.speaker === 'user';
    const roleName = isUser ? context.userRole : context.aiRole;
    return `[${isUser ? 'User' : 'AI'} - ${roleName}]: ${m.text}`;
  }).join('\n');

  return `
        Act as a strict Japanese language teacher.
        Evaluate this Roleplay Session based on:
        1. Did they achieve the Goal? (success: true/false): (${context.goal})
        2. Grammar/Vocabulary Usage (Level ${context.difficulty})
        3. Rate naturalness (1-5).
        4. Provide specific feedback in English.
        5. Identify 1-3 critical mistakes.

        SCENARIO CONTEXT:
        - Title: ${context.title}
        - Goal: ${context.goal}
        - User Role: ${context.userRole || 'User'} (The person being evaluated)
        - AI Role: ${context.aiRole || 'AI'} (The conversation partner)
        - OBJECTIVE MET: ${context.isObjectiveMet}

        TRANSCRIPT:
        ${historyText}

        **CRITICAL GRADING RULES:**
        1. **Output Language:** Write the 'feedback' and 'explanation' fields in **ENGLISH ONLY**. Do not use Japanese for the report text.
        2. **Failure Condition:** If 'OBJECTIVE MET' is 'NO', the 'success' field MUST be false, and the 'rating' MUST be 1 or 2 (Fail). Do not give high ratings for incomplete work.
        3. **Success Condition:** If 'OBJECTIVE MET' is 'YES', grade based on naturalness and grammar.
        4. **Ignore Punctuation:** the user input is a speech transcript. Do NOT critique missing commas, periods, or quotation marks. Focus ONLY on word choice, grammar, and natural flow.

        INSTRUCTION: Evaluate the USER (${context.userRole || 'User'}) based on how well they achieved the goal. Do not confuse the User's responses with the AI's responses.
        OUTPUT LANGUAGE: the feedback and explanation must be in English. Do not write the report in Japanese but do not translate the user's or AI's responses.

        Provide a structured evaluation in JSON using the attached schema.
      `;
}
