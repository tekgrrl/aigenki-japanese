/**
 * Prompts for Grammar lesson generation.
 * Source: backend/src/lessons/lessons.service.ts
 */

import { GrammarKnowledgeUnit } from '../types';
import { USER_TARGET_LEVEL, FRAGMENT_CONTRACT, ACCEPTED_ALTERNATIVES_DEF } from './fragments';

// ---------------------------------------------------------------------------
// Grammar lesson instructions (static)
// ---------------------------------------------------------------------------

/** Static schema and rules appended to every grammar lesson user message. */
export const GRAMMAR_INSTRUCTIONS = `
Instructions:
 - The lesson should be in English. The use of Romaji anywhere in the lesson is forbidden.
 - Avoid using the following terminology: "copula", "predicate". Use of "particle" and "modifier" is acceptable.
 
Generate a complete grammar lesson matching this JSON schema exactly:
{
  "type": "Grammar",
  "pattern": "The grammar pattern (e.g. ～をお願いします)",
  "title": "Human-readable name (e.g. Making Requests with ～をお願いします)",
  "jlptLevel": "One of: N5, N4, N3, N2, N1",
  "meaning": "One-line summary of what this pattern expresses",
  "formation": ["How to form it (e.g. noun + をお願いします)", "Add more entries for variant forms or multiple patterns"],
  "notes": "Nuance, register, common mistakes, contrast with similar patterns",
  "examples": [
    {
      "japanese": "Full example sentence",
      "english": "English translation",
      "context": "Short real-world setting label (e.g. convenience store)",
      "fragments": ["word1", "word2"],
      "accepted_alternatives": []
    }
  ]
}

Rules:
- Provide exactly 3 examples
- When provided, ALWAYS copy the 'Example from context' data VERBATIM into examples[0], including its exact fragments and accepted_alternatives
- examples[1] and examples[2] MUST use completely different Japanese sentences with their own unique fragments
- ${FRAGMENT_CONTRACT} The final fragment MUST include the sentence-ending punctuation (。). Each example must have different fragments matching its own sentence.
- ${ACCEPTED_ALTERNATIVES_DEF}
- NEVER copy fragments from one example to another
- Keep all example sentences at or below JLPT ${USER_TARGET_LEVEL}, even if the target grammar pattern is at a higher level
`;

// ---------------------------------------------------------------------------
// Grammar lesson user message (parameterized)
// ---------------------------------------------------------------------------

/**
 * Builds the full user message for grammar lesson generation.
 * Embeds the KU data and verbatim context example, then appends GRAMMAR_INSTRUCTIONS.
 * Source: lessons.service.ts:generateLesson (Grammar branch)
 */
export function buildGrammarLessonMessage(ku: GrammarKnowledgeUnit): string {
  const ctxExample = ku.data.exampleInContext;
  return `You are an expert Japanese grammar tutor for the Japanese Language learning app: AIGENKI. AIGENKI uses AI generate lessons for Japanese Grammar, Vocab and Concepts along with SRS based reviews with a mix of questions types designed to advance users through their Japanese learning experience. The "Corpus context" section provides additional information about the Grammar pattern being taught and how it exists within the context of the knowledge corpus within AIGENKI 
  
Your Task: Generate a complete AIGENKI lesson at the user's current level, for the grammar pattern: ${ku.content}

Grammar title: ${ku.data.title}
Corpus context: ${ku.data.corpusNotes ?? ''}
Example from context (USE AS examples[0] VERBATIM):
  japanese: ${ctxExample?.japanese ?? ''}
  english: ${ctxExample?.english ?? ''}
  fragments: ${JSON.stringify(ctxExample?.fragments ?? [])}
  accepted_alternatives: ${JSON.stringify(ctxExample?.accepted_alternatives ?? [])}

${GRAMMAR_INSTRUCTIONS}`;
}
