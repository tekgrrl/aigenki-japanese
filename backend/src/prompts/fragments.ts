/**
 * Shared prompt fragments for use across the prompt library.
 *
 * Unified text fragments used across the prompt library.
 * Import and interpolate these constants instead of repeating literal text.
 */

export const NO_ROMAJI =
  `Do not include Romaji anywhere in your response.`;

export function levelConstraint(jlptLevel: string): string {
  return `LEVEL CONSTRAINT (critical): every word in the example sentences — not just the grammar structure — MUST be at or below JLPT ${jlptLevel}. The ONLY exception is the specific target vocabulary/pattern being taught; everything else in the sentence must be ordinary, well-known JLPT ${jlptLevel}-or-below vocabulary. If a natural example would require a more advanced word, choose a different example scenario rather than reaching for it — do not compromise on this to make the sentence more natural or interesting.`;
}

export const JSON_ONLY_OUTPUT =
  `Return ONLY a valid JSON object. Do NOT output any text before or after it. Do NOT use markdown code blocks or backticks.`;

/**
 * Register guidance for any Japanese sentence a learner will read or hear.
 * Used wherever the AI generates example/context sentences: grammar examples,
 * vocab context_examples, concept naturalExample/examples.
 */
export const PREFER_SPOKEN_REGISTER =
  `NATURAL SPOKEN REGISTER (critical): favor the form an actual native speaker would say in conversation over a ` +
  `grammatically valid but stiff/bookish alternative. The most common failure mode is past-tense negation: ` +
  `〜くありませんでした for i-adjectives (e.g. 寒くありませんでした, "it was not cold") and 〜ではありませんでした ` +
  `for na-adjectives/nouns (e.g. 学生ではありませんでした, "was not a student") are grammatically correct but read as ` +
  `formal written Japanese, not natural spoken Japanese — even in polite speech, natural spoken Japanese uses ` +
  `〜くなかったです and 〜じゃなかったです instead (e.g. 寒くなかったです, 学生じゃなかったです). Apply the same ` +
  `judgment generally: when a grammatically valid form is rarely used in real conversation in favor of a more ` +
  `natural spoken alternative, use the natural one — unless the pattern being taught IS specifically that form.`;

/**
 * Guards against an ambiguous fill-in-the-blank question — used wherever a quiz
 * question might contain a '[____]' blank, even if that isn't the primary format
 * being requested (models sometimes reach for a blank unprompted, e.g. to test a
 * conjugated form within an otherwise full-sentence question type).
 */
export const BLANK_DISAMBIGUATION_GUARD =
  `BLANK DISAMBIGUATION (critical): if the 'question' text contains a '[____]' blank anywhere — whether or not the ` +
  `question format you were asked to produce is itself a fill-in-the-blank style — the 'context' field MUST be ` +
  `populated with enough information to uniquely determine the intended answer. A bare sentence with a blank is ` +
  `rarely enough on its own: e.g. "The child [____] bread now." could correctly be completed by 食べた (ate), 買った ` +
  `(bought), あげた (gave), and more. Context must say something like "the target word means 'to eat'" to rule ` +
  `those out. This applies regardless of part of speech — verbs are at least as prone to this ambiguity as nouns.`;

/**
 * Contract for sentence-assembly fragment arrays.
 * Used in: concept naturalExample, grammar lesson examples, scenario grammarNotes.
 */
export const FRAGMENT_CONTRACT =
  `The 'fragments' array MUST split the sentence into minimal grammatical chunks. ` +
  `When concatenated in order, the strings in 'fragments' MUST perfectly reconstruct the 'japanese' string. ` +
  `ALWAYS group particles with their preceding nouns. ` +
  `NEVER split inside a word. ` +
  `There MUST be at least 4 fragments — a 2- or 3-piece split is a guess, not an exercise; if the sentence is too short to split into 4 meaningful chunks, write a longer sentence. ` +
  `The grammar pattern being practised MUST be split out into its own fragment(s), separate from the content words around it, so that assembling the sentence means rebuilding the pattern's structure ` +
  `(e.g. for 〜の中で〜が一番: ["クラスの中で", "田中さんが", "一番", "背が高いです。"] — NOT ["クラスの中で", "田中さんが", "一番背が高いです。"]). ` +
  `NEVER include Romaji or furigana in fragments.`;

/**
 * Definition of the accepted_alternatives field.
 * Used alongside FRAGMENT_CONTRACT wherever sentence-assembly facets are generated.
 */
export const ACCEPTED_ALTERNATIVES_DEF =
  `'accepted_alternatives': a JSON array of STRINGS — never an array of arrays. Each string is one other ordering ` +
  `of the EXACT same fragments, concatenated back into a single grammatically correct sentence ` +
  `(e.g. if fragments are ["今、", "テレビを", "見ています。"], a valid entry is the STRING "テレビを今、見ています。", ` +
  `NOT the array ["テレビを", "今、", "見ています。"]). Do NOT include rephrased sentences or sentences using different words. ` +
  `Provide an empty array if none exist.`;
