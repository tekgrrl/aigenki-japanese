/**
 * Prompts for AI-generated quiz question generation.
 * Source: backend/src/questions/questions.service.ts
 */

import { ConceptKnowledgeUnit } from '../types';
import { NO_ROMAJI, JSON_ONLY_OUTPUT } from './fragments';

export type ConceptMechanic = ConceptKnowledgeUnit['data']['mechanics'][number];

// ---------------------------------------------------------------------------
// Vocab questions (verbs and adjectives)
// ---------------------------------------------------------------------------

export const VOCAB_QUESTION_OPTIONS: Record<string, string> = {
  'conjugation': 'if the word is a verb, conjugate the verb to a specific form e.g.: Give the past potential form of the verb in question',
  'particle': "Match up the Vocab in question with a particle to give a particular meaning in a sentence that you specify, you can represent the particle with a blank '[____]'",
  'translation': 'Create a sentence in English for the user to translate into Japanese. The English sentence must naturally force the use of the Target Input.',
  'fill-in-the-blank': "A context-based, fill-in-the-blank style question with a single blank '[____]'",
};

export type VocabQuestionType = keyof typeof VOCAB_QUESTION_OPTIONS;

/**
 * Builds the system prompt for vocab/grammar AI question generation.
 * Source: questions.service.ts:generateVocabQuestion
 *
 * @param questionType - One of the VOCAB_QUESTION_OPTIONS keys, randomly selected at call time.
 */
export function buildVocabQuestionPrompt(questionType: VocabQuestionType): string {
  return `You are an expert Japanese tutor and quiz generator.
You will be prompted with a single piece of Japanese vocabulary or grammar (the 'topic') and an optional reading and meaning.
Your task is to create a single, context-based question to test the user's understanding of that word or grammar concept.

FIRST: Call get_user_level to retrieve the learner's JLPT level and cumulative grammar schema before writing anything.

THEN generate a question of the following form:
${VOCAB_QUESTION_OPTIONS[questionType]}

Rules:
1.  The question must directly test the provided 'topic'.
2.  For fill-in-the-blank questions, use '[____]' for the blank, exactly once, and the answer must be the single word/particle that fits the blank.
3.  ${NO_ROMAJI}
4.  The context field MUST be used for any fill-in-the-blank question that tests a noun or adjective, providing a hint to differentiate the answer from common synonyms.
5.  Ensure the generated question and any accepted answers make grammatical sense.
6.  If a reading and/or meaning are provided, generate a question where the topic matches those specific constraints only — do not test alternative readings.
7.  For verb and adjective questions where the answer is a conjugated form, include valid politeness-level alternatives (plain form and polite 〜ます form) in accepted_alternatives unless the question specifically constrains the form.
8.  LEVEL CONSTRAINT (critical): Use ONLY grammar patterns listed in the cumulative schema returned by get_user_level for the surrounding sentence. The target word itself may be more advanced — that is the point — but every other word and grammatical structure in the question must come from the learner's known schema.
9.  Ambiguity prevention: if synonyms could fit the blank, use the context field to pin the exact meaning of the target word.
10. If the question requires verb conjugation and the answer is not the base form, provide enough context to make the expected form unambiguous.`;
}

/**
 * Builds the user message for vocab/grammar AI question generation.
 * Source: questions.service.ts:generateVocabQuestion
 */
export function buildVocabQuestionUserMessage(
  topic: string,
  reading?: string,
  meaning?: string,
): string {
  let msg = `Topic: ${topic}`;
  if (reading) msg += `\nReading: ${reading}`;
  if (meaning) msg += `\nMeaning: ${meaning}`;
  return msg;
}

// ---------------------------------------------------------------------------
// Noun questions
// ---------------------------------------------------------------------------

export const NOUN_QUESTION_OPTIONS: Record<string, string> = {
  'noun-particle': 'noun + particle fill-in-the-blank',
  'translation': 'Create a sentence in English for the user to translate into Japanese. The English sentence must naturally force the use of the Target Input.',
};

export type NounQuestionType = keyof typeof NOUN_QUESTION_OPTIONS;

/**
 * System prompt for noun + particle fill-in-the-blank questions.
 * The blank encompasses <noun><particle> so the user must supply both the word and
 * its grammatically correct particle for the specific context.
 * accepted_alternatives is always empty — the sentence uniquely determines the particle.
 * Pass NOUN_PARTICLE_FEW_SHOT_TURNS as fewShotTurns to generateQuestionAI.
 */
export function buildNounParticleQuestionPrompt(): string {
  return `You are an expert Japanese tutor and quiz generator.
You will be given a Japanese noun (the 'topic') with its reading and meaning.
Your task is to write a single Japanese sentence that uses that noun with a specific particle, then blank out the noun+particle pair together so the user must supply both.

FIRST: Call get_user_level to retrieve the learner's JLPT level and cumulative grammar schema.

Rules:
1. The blank '[____]' replaces the noun AND its particle together — e.g. the answer might be 図書館で, 駅から, 友達と, 歯を.
2. The 'context' field MUST follow this exact format: "Specify [English label] as [semantic role]" — where the semantic role describes the particle's function precisely enough that only one particle is correct.
3. 'accepted_alternatives' MUST always be an empty array. The sentence structure uniquely determines the correct particle.
4. Do NOT use は or が as the particle. Use action particles only: を, に, で, から, へ, と, まで.
5. LEVEL CONSTRAINT: Use ONLY vocabulary and grammar from the cumulative schema returned by get_user_level for the surrounding sentence.
6. ${NO_ROMAJI}`;
}

/** Few-shot conversation turns for noun+particle questions.
 *  Pass to generateQuestionAI as the fewShotTurns argument.
 *  Each pair is a (user message, model JSON response) that demonstrates the expected format.
 */
export const NOUN_PARTICLE_FEW_SHOT_TURNS: Array<{ user: string; model: string }> = [
  {
    user: 'Topic: 図書館\nReading: としょかん\nMeaning: library',
    model: '{"question":"週末はよく[____]本を読みます。","context":"Specify the library as the place where reading happens","answer":"図書館で","accepted_alternatives":[]}',
  },
  {
    user: 'Topic: 駅\nReading: えき\nMeaning: train station',
    model: '{"question":"毎朝[____]歩いて会社に向かいます。","context":"Specify the train station as the starting point of the walk","answer":"駅から","accepted_alternatives":[]}',
  },
  {
    user: 'Topic: 友達\nReading: ともだち\nMeaning: friend',
    model: '{"question":"昨日[____]映画を見に行きました。","context":"Specify the friend as the person you went with","answer":"友達と","accepted_alternatives":[]}',
  },
  {
    user: 'Topic: 音楽\nReading: おんがく\nMeaning: music',
    model: '{"question":"毎朝シャワーを浴びながら[____]聴きます。","context":"Specify music as the thing being listened to","answer":"音楽を","accepted_alternatives":[]}',
  },
  {
    user: 'Topic: 学校\nReading: がっこう\nMeaning: school',
    model: '{"question":"明日は早く[____]行かなければなりません。","context":"Specify the school as the destination","answer":"学校に","accepted_alternatives":[]}',
  },
];

// ---------------------------------------------------------------------------
// Concept mechanic questions
// ---------------------------------------------------------------------------

export const CONCEPT_QUESTION_OPTIONS: Record<string, string> = {
  'error-correction': 'Present a complete Japanese sentence that attempts to use the grammatical rule but contains a specific syntax, particle, or conjugation error related to that rule. Ask the user to correct the error and provide the fully corrected Japanese sentence. Provide the intended English meaning as context.',
  'novel-translation': 'Create a completely new English sentence that naturally forces the use of the grammatical rule. Ask the user to translate it into Japanese. Ensure the vocabulary used is very simple (JLPT N5 level) so the user is only challenged by the grammar structure, not the vocabulary.',
};

export type ConceptQuestionType = keyof typeof CONCEPT_QUESTION_OPTIONS;

/**
 * Builds the system prompt for concept mechanic question generation.
 * The user message for this prompt is an empty string (all context is in the system prompt).
 * Source: questions.service.ts:generateConceptQuestion
 *
 * @param mechanic - The specific mechanic being tested.
 * @param questionType - One of the CONCEPT_QUESTION_OPTIONS keys, randomly selected at call time.
 */
export function buildConceptQuestionPrompt(
  mechanic: ConceptMechanic,
  questionType: ConceptQuestionType,
): string {
  return `You are an expert Japanese tutor.
You are testing the user on a specific grammatical mechanic.
Rule Name: ${mechanic.goalTitle}
Structural Rule: ${mechanic.rule}
Example Application: ${mechanic.simpleExample.japanese} (${mechanic.simpleExample.english})

FIRST: Call get_user_level to retrieve the learner's JLPT level and cumulative grammar schema.

THEN generate a question using this format:
${CONCEPT_QUESTION_OPTIONS[questionType]}

Rules:
1. The answer MUST require the user to apply the provided Structural Rule.
2. The 'question' field MUST be written entirely in English. Any Japanese sentence shown to the user must be embedded inline as a quoted string — never write the instruction itself in Japanese.
3. ${NO_ROMAJI}
4. For fill-in-the-blank, the blank must encapsulate the conjugated rule application.
5. LEVEL CONSTRAINT (critical): Use ONLY vocabulary and grammar patterns from the cumulative schema returned by get_user_level for the surrounding sentence. The mechanic being tested is the exception — everything else must be within the learner's known schema.`;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Picks a random key from a question options map. */
export function pickRandomQuestionType<T extends string>(options: Record<T, string>): T {
  const keys = Object.keys(options) as T[];
  return keys[Math.floor(Math.random() * keys.length)];
}
