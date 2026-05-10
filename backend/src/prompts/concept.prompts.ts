/**
 * Prompts for grammar Concept page generation.
 * Source: backend/src/concepts/concepts.service.ts
 */

import { NO_ROMAJI, USER_TARGET_LEVEL, FRAGMENT_CONTRACT, ACCEPTED_ALTERNATIVES_DEF } from './fragments';

/**
 * Builds the full prompt for generating a ConceptKnowledgeUnit page.
 * Source: concepts.service.ts CONCEPT_PROMPT function
 */
export function buildConceptPrompt(topic: string, notes?: string): string {
  return `You are a kind and thoughtful Japanese language teacher with decades of experience. Generate an educational grammar concept introduction page for the following topic: "${topic}".

Write for an English-speaking learner at any level. Use Japanese text for all examples — do not include Romaji anywhere.

**Content Guidelines:**

1. 'overview': Define the concept strictly in terms of how Japanese works — do not reference English grammar rules, relative pronouns, or words like "who", "which", or "that". Use your judegement on how much detail to provide to land the concept, but be thoughtful of the learner's experience. 

2. 'mechanics': Break the grammar down by the learner's communicative intent, not just structural formulas. Each mechanic must contain:
   - 'goalTitle': An action-oriented title describing what the learner wants to express (e.g., "Describe a noun using a habitual or future action").
   - 'englishIntent': A short English example of what the learner wants to say that triggers this rule.
   - 'rule': The exact structural rule to achieve this in Japanese.
   - 'simpleExample': A sentence fragment showing ONLY the noun and its modifier (e.g., "待っている友達"). DO NOT make it a full sentence by adding です or だ. The 'english' translation MUST be a highly literal, structural translation (e.g., "waiting friend"). Include 'japanese', 'english', and 'highlight' (the verbatim adjectival clause substring from 'japanese' — must appear exactly as written).
   - 'naturalExample': A complete, natural Japanese sentence that MUST directly incorporate the exact fragment generated in the 'simpleExample'. Provide the 'japanese' text, an 'english' translation, a 'fragments' array, and an 'accepted_alternatives' array.
       * The 'fragments' array MUST split the 'japanese' sentence into 4 to 7 logical syntactic blocks (e.g., ["あそこで", "本を", "読んでいる", "人は", "私の兄です"]).
       * ${FRAGMENT_CONTRACT}
       * ${ACCEPTED_ALTERNATIVES_DEF}

3. 'examples': Provide exactly 3 practical, everyday example sentences covering the concept. No more, no less.

4. 'japanese': Write the sentence with furigana in bracket notation — attach the reading in square brackets immediately after each kanji or kanji compound, e.g. 彼[かれ]は学生[がくせい]です。 Pure kana and punctuation need no brackets.

5. 'targetGrammar': The specific Japanese substring that represents the grammar concept, written as plain Japanese text (no furigana brackets). It must appear verbatim in the plain text of 'japanese' after stripping all bracket annotations.

**Constraints:**
- ${USER_TARGET_LEVEL}
- Do not explain meta-linguistic terms (e.g. do not define what a "particle" is).
- ${NO_ROMAJI}

**Response Schema:**
You MUST return a valid JSON object matching this schema exactly:
{
  "type": "Concept",
  "content": "The topic being introduced.",
  "relatedUnits": [],
  "data": {
    "title": "<Human-readable title>",
    "reading": "<Kana reading of the core concept — e.g. 'まい' for 枚, 'をおねがいします' for ～をお願いします. Omit if the title contains no kanji or kana that need a reading.>",
    "overview": "<Multi-sentence introduction, soft maximum is four sentence but you can use more for more complex concepts>",
    "mechanics": [
      {
        "goalTitle": "<Action-oriented title, e.g. Describe a noun using a habitual or future action>",
        "englishIntent": "<English example of what the learner wants to say, e.g. 'I want to say: the person who eats sushi'>",
        "rule": "<Structural rule, e.g. [Verb (plain form)] + [Noun]>",
        "simpleExample": {
          "japanese": "<Minimal Japanese sentence>",
          "english": "<English translation>",
          "highlight": "<Verbatim adjectival clause substring from japanese>"
        },
        "naturalExample": {
          "japanese": "<Natural everyday Japanese sentence>",
          "english": "<English translation>",
          "highlight": "<Verbatim adjectival clause substring from japanese>",
          "fragments": ["<chunk 1>", "<chunk 2>", "..."],
          "accepted_alternatives": ["<alternative ordering 1 joined>", "..."]
        }
      }
    ],
    "examples": [
      {
        "japanese": "<Full Japanese sentence with furigana in bracket notation, e.g. 彼[かれ]は学生[がくせい]ではありません。>",
        "english": "<Natural English translation>",
        "targetGrammar": "<Plain-text substring representing the concept — must appear verbatim in japanese after stripping bracket annotations>"
      }
    ]
  }
}${notes ? `\n\n**Additional notes from the teacher:**\n${notes}` : ''}`;
}
