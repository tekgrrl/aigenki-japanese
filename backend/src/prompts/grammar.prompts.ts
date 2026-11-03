/**
 * Prompts for Grammar lesson generation.
 * Source: backend/src/lessons/lessons.service.ts
 */

import { GrammarKnowledgeUnit } from '../types';
import { levelConstraint, FRAGMENT_CONTRACT, ACCEPTED_ALTERNATIVES_DEF, PREFER_SPOKEN_REGISTER } from './fragments';

// ---------------------------------------------------------------------------
// Grammar lesson instructions (static)
// ---------------------------------------------------------------------------

/** Builds schema and rules for grammar lesson generation, scoped to the user's JLPT level. */
export function buildGrammarInstructions(jlptLevel: string): string {
  return `
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
  "formation": ["How to form it (e.g. noun + をお願いします)", "One entry per variant form or sub-pattern — NEVER combine multiple variants into a single string, even with a newline"],
  "notes": "Nuance, register, common mistakes, contrast with similar patterns",
  "examples": [
    {
      "japanese": "Full example sentence",
      "english": "English translation",
      "context": "Short real-world setting label (e.g. convenience store)",
      "fragments": ["word1", "word2"],
      "accepted_alternatives": [],
      "learnableTerms": [
        { "term": "dictionary-form word from this sentence", "surfaceForm": "the exact inflected form as it literally appears in the sentence/fragments (e.g. 行きました, not 行く)", "reading": "kana reading of the dictionary form", "meaning": "short English meaning" }
      ]
    }
  ]
}

Rules:
- Provide exactly 3 examples
- When provided, ALWAYS copy the 'Example from context' data VERBATIM into examples[0], including its exact fragments and accepted_alternatives — learnableTerms is the one exception: generate it fresh for examples[0] too, since it isn't part of the original context data
- examples[1] and examples[2] MUST use completely different Japanese sentences with their own unique fragments
- If the pattern bundles multiple related words/forms (e.g. "よく / あまり / ぜんぜん + verb"), examples[1] and examples[2] MUST each use a different one of those words so all of them get exercised across the lesson, not just one repeated
- ${FRAGMENT_CONTRACT} The final fragment MUST include the sentence-ending punctuation (。). Each example must have different fragments matching its own sentence.
- ${ACCEPTED_ALTERNATIVES_DEF}
- ${PREFER_SPOKEN_REGISTER}
- NEVER copy fragments from one example to another
- LEARNABLE TERMS: for each example, list every standalone vocabulary word in that sentence that's substantial enough to be worth learning on its own. \`term\` MUST be the plain dictionary form (e.g. 買う, not 買った), since that's what gets searched/learned — but \`surfaceForm\` MUST be the exact inflected string as it literally appears in the sentence/fragments, since that's used to match the word back to its fragment. For unconjugated words (nouns, etc.) surfaceForm and term will be identical. EXCLUDE: the grammar pattern being taught (that's already the lesson's own subject), proper nouns/names, and function words (particles, copula). If a sentence has no such words beyond the pattern itself, return an empty array — do not force entries.
- ${levelConstraint(jlptLevel)}
`;
}

// ---------------------------------------------------------------------------
// Grammar lesson user message (parameterized)
// ---------------------------------------------------------------------------

/**
 * Builds the full user message for grammar lesson generation.
 * Embeds the KU data and verbatim context example, then appends GRAMMAR_INSTRUCTIONS.
 * Source: lessons.service.ts:generateLesson (Grammar branch)
 */
export function buildGrammarLessonMessage(ku: GrammarKnowledgeUnit, jlptLevel: string): string {
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

${buildGrammarInstructions(jlptLevel)}`;
}

/**
 * Adds reading annotations to existing Grammar example sentences (lazy backfill: grammar
 * lessons were generated without furigana). Output must keep every character of the input.
 */
export function buildFuriganaMessage(sentences: string[]): string {
  return `Add furigana readings to each Japanese sentence below.

Format: put the hiragana reading in square brackets directly after each kanji word, e.g.
明日[あした]、学校[がっこう]へ行[い]きます。 Okurigana stays outside the brackets
(食[た]べます, not 食べ[たべ]ます). Use the reading that fits this sentence.

Rules:
- Copy every character of the sentence exactly, in order. Only insert [reading] annotations.
- Annotate every kanji. Never annotate kana, punctuation, numbers or Latin letters.
- Readings are hiragana only.
- A sentence with no kanji is returned unchanged.

Return JSON: {"annotated": [one string per input sentence, same order]}

Sentences:
${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}
