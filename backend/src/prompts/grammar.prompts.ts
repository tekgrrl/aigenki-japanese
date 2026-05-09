/**
 * Prompts for Grammar lesson generation.
 * Source: backend/src/lessons/lessons.service.ts
 */

import { GrammarKnowledgeUnit } from '../types';
import { USER_TARGET_LEVEL } from './fragments';

// ---------------------------------------------------------------------------
// Grammar lesson instructions (static)
// ---------------------------------------------------------------------------

/** Static schema and rules appended to every grammar lesson user message. */
export const GRAMMAR_INSTRUCTIONS = `
The lesson should be in English. The use of Romaji anywhere in the lesson is forbidden.

Generate a complete grammar lesson matching this JSON schema exactly:
{
  "type": "Grammar",
  "pattern": "The grammar pattern (e.g. ～をお願いします)",
  "title": "Human-readable name (e.g. Making Requests with ～をお願いします)",
  "jlptLevel": "One of: N5, N4, N3, N2, N1",
  "meaning": "One-line summary of what this pattern expresses",
  "formation": "How to form it (e.g. noun + をお願いします)",
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
- When provided ALWAYS copy 'Example from context' data VERBATIM into examples[0], including its exact fragments and accepted_alternatives
- examples[1] and examples[2] MUST use completely different Japanese sentences with their own unique fragments
- fragments must be the Japanese sentence split into meaningful chunks for sentence-assembly drills — each example must have different fragments matching its own sentence
- NEVER copy fragments from one example to another
- ${USER_TARGET_LEVEL}
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
  return `You are an expert Japanese grammar tutor. Generate a lesson for the grammar pattern: ${ku.content}

Pattern title: ${ku.data.title}
Corpus context: ${ku.data.corpusNotes ?? ''}
Example from context (USE AS examples[0] VERBATIM):
  japanese: ${ctxExample?.japanese ?? ''}
  english: ${ctxExample?.english ?? ''}
  fragments: ${JSON.stringify(ctxExample?.fragments ?? [])}
  accepted_alternatives: ${JSON.stringify(ctxExample?.accepted_alternatives ?? [])}

${GRAMMAR_INSTRUCTIONS}`;
}
