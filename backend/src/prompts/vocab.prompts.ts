/**
 * Prompts for Vocab and Kanji lesson generation.
 * Sources: backend/src/lessons/lessons.service.ts, backend/src/gemini/gemini.service.ts
 */

import { levelConstraint, PREFER_SPOKEN_REGISTER } from './fragments';

// ---------------------------------------------------------------------------
// Vocab lesson
// ---------------------------------------------------------------------------

/** Static instructions for vocab lesson generation. Appended to the user message. */
export const VOCAB_INSTRUCTIONS = `
The lesson should be in English. Where you want to use Japanese text for examples, explanations, meanings and readings do so but do not include Romaji.

**Task 1: Metadata Extraction**
* Provide the standard **Kana Reading**.
* Provide a list of **Concise Definitions** (suitable for valid acceptable answers in a quiz).
* Identify the **Part of Speech**.
* Identify the **Conjugation Type** for verbs only (null for all non-verbs).

**Task 2: Lesson Generation**
* Generate detailed explanations for meaning and reading.
* If a word is a "suru noun", include explanations of the meaning of the suru form.
* Generate context examples appropriate for the user's current JLPT level even if the vocabulary itself is more advanced. (Level constraint is injected at call time.)
* Every context example MUST use the target word as a genuinely independent occurrence. Never pick or write a sentence where the word only appears as a bound fragment fused inside a larger, unrelated compound (jukugo) that has its own distinct meaning — e.g. do not use 三月 (March) to exemplify the number 三, or 学校 (school) to exemplify 学. If the target word forms a real compound with a related, compositional meaning, that compound may appear, but the target word's own reading and meaning must still be recoverable as a distinct unit within it — when in doubt, prefer a sentence where the word stands entirely alone.
* ${PREFER_SPOKEN_REGISTER}
* Give each context example a short \`usage\` label (a few English words) naming the usage or sense of the target word it shows, e.g. "asking why" vs "how come (surprise)". Examples showing the same usage MUST share the identical label. Usages are differences in MEANING, never in grammar: a change of grammatical role is not a new usage. For noun-suru words (nouns that also take する), the noun use and the する-verb use are ONE usage (e.g. 練習 "practice" and 練習する "to practise" share one label), unless the noun also names a distinct thing (e.g. 電話: "a telephone" vs "making a call"; 料理: "a dish / cuisine" vs "cooking"). Genuinely different meanings get different labels (e.g. 掛かる: "takes (time)" vs "costs (money)" vs "hangs"). If the word has more than one distinct usage, the examples should cover them.
* Analyze component Kanji. If the word is normally or almost always written in kana alone in modern Japanese (e.g. もらう, くれる, いる, ある, すごい, かわいい), set \`kanaOnly\` to true and \`component_kanji\` to an empty array — do not include the kanji breakdown even if kanji exist for it. Otherwise set \`kanaOnly\` to false.
* Do not explain what "rendaku" means.

**Constraints:**
For the \`partOfSpeech\` property, select one of:
* noun, proper-noun, noun-suru, i-adjective, na-adjective, transitive-verb, intransitive-verb, adverb, counter, prefix, suffix, conjunction, particle

For the \`conjugationType\` property (verbs only):
* MUST be one of: godan, ichidan, irregular
* MUST be null for all non-verbs (nouns, adjectives, adverbs, etc.)

Do not explain the terms "kun'yomi" or "on'yomi", never use the term "sino-japanese"

**Response Schema:**
You MUST return a valid JSON object matching this schema:
{
  "type": "Vocab",
  "vocab": "The canonical Japanese word",
  "reading": "The canonical kana reading (e.g. ぜったい)",
  "definitions": ["definition 1", "definition 2"],
  "partOfSpeech": "The selected part of speech string",
  "conjugationType": "godan | ichidan | irregular | null — null for all non-verbs",

  "meaning_explanation": "A detailed explanation of the word's meaning and nuance.",
  "reading_explanation": "An explanation of the reading (e.g., nuance, rendaku).",

  "context_examples": [
    { "sentence": "Japanese sentence with Furigana in brackets e.g. 明日[あした]", "translation": "English translation.", "usage": "Short label for the usage/sense shown" }
  ],
  "kanaOnly": "true | false — true if this word is normally written in kana alone (see Task 2); when true, component_kanji MUST be an empty array",
  "component_kanji": [
    {
      "kanji": "Single Kanji",
      "reading": "Reading in this word",
      "meaning": "Core meaning",
      "onyomi": ["on1"],
      "kunyomi": ["kun1"]
    }
  ]
}`;

/** Worked examples for vocab lesson generation. Used in batch processing alongside VOCAB_INSTRUCTIONS. */
export const VOCAB_EXAMPLES = `
**Examples:**

Input: 先生

Output:
{
  "type": "Vocab",
  "vocab": "先生",
  "reading": "せんせい",
  "definitions": ["teacher", "instructor", "master", "doctor"],
  "partOfSpeech": "noun",
  "conjugationType": null,
  "meaning_explanation": "A term used to address or refer to teachers, doctors, lawyers, politicians, and other authority figures or experts. It literally means 'one born before'.",
  "reading_explanation": "Note that 'sei' (せい) is prolonged, so it sounds like 'sensee'. This is a common pronunciation change in Japanese.",
  "context_examples": [
    { "sentence": "田中[たなか]先生[せんせい]は日本語[にほんご]を教[おし]えています。", "translation": "Professor Tanaka teaches Japanese.", "usage": "teacher (title)" }
  ],
  "kanaOnly": false,
  "component_kanji": [
    {
      "kanji": "先",
      "reading": "せん",
      "meaning": "before, ahead, previous",
      "onyomi": ["セン"],
      "kunyomi": ["さき", "ま.ず"]
    },
    {
      "kanji": "生",
      "reading": "せい",
      "meaning": "life, genuine, birth",
      "onyomi": ["セイ", "ショウ"],
      "kunyomi": ["い.きる", "う.む", "お.う", "は.える", "なま"]
    }
  ]
}

Input: 食べる

Output:
{
  "type": "Vocab",
  "vocab": "食べる",
  "reading": "たべる",
  "definitions": ["to eat"],
  "partOfSpeech": "transitive-verb",
  "conjugationType": "ichidan",
  "meaning_explanation": "The standard verb for 'to eat'. It is a transitive verb, so it takes an object marked by 'o' (を).",
  "reading_explanation": "The reading 'ta' comes from the kanji 食 and 'beru' is okurigana.",
  "context_examples": [
    { "sentence": "朝[あさ]ごはんにパンを食[た]べました。", "translation": "I ate bread for breakfast.", "usage": "to eat" }
  ],
  "kanaOnly": false,
  "component_kanji": [
    {
      "kanji": "食",
      "reading": "た",
      "meaning": "eat, food",
      "onyomi": ["ショク", "ジキ"],
      "kunyomi": ["く.う", "た.べる", "は.む"]
    }
  ]
}

Input: 有名

Output:
{
  "type": "Vocab",
  "vocab": "有名",
  "reading": "ゆうめい",
  "definitions": ["famous", "fame"],
  "partOfSpeech": "na-adjective",
  "conjugationType": null,
  "meaning_explanation": "Describes something or someone that has a name widely known. It is a Na-adjective, so you use 'na' to modify nouns (e.g. 有名のな人 - famous person).",
  "reading_explanation": "Standard on'yomi readings. 'Yuu' (有) + 'Mei' (名).",
  "context_examples": [
    { "sentence": "彼[かれ]は有名[ゆうめい]な歌手[かしゅ]です。", "translation": "He is a famous singer.", "usage": "famous" }
  ],
  "kanaOnly": false,
  "component_kanji": [
    {
      "kanji": "有",
      "reading": "ゆう",
      "meaning": "possess, have, exist",
      "onyomi": ["ユウ", "ウ"],
      "kunyomi": ["あ.る"]
    },
     {
      "kanji": "名",
      "reading": "めい",
      "meaning": "name, noted, distinguished",
      "onyomi": ["メイ", "ミョウ"],
      "kunyomi": ["な"]
    }
  ]
}

Input: 勉強する

Output:
{
  "type": "Vocab",
  "vocab": "勉強する",
  "reading": "べんきょうする",
  "definitions": ["to study", "to work hard"],
  "partOfSpeech": "noun-suru",
  "conjugationType": "irregular",
  "meaning_explanation": "The primary verb for 'to study'. It is composed of the noun 'Benkyou' (study) and the auxiliary verb 'suru' (to do).",
  "reading_explanation": "Ben (勉) + Kyou (強) + Suru. Note that 'strong' (強) is usually read 'kyo' as a standalone on'yomi, but here it is 'kyou'.",
  "context_examples": [
    { "sentence": "毎日[まいにち]日本語[にほんご]を勉強[べんきょう]します。", "translation": "I study Japanese every day.", "usage": "to study" }
  ],
  "kanaOnly": false,
  "component_kanji": [
    {
      "kanji": "勉",
      "reading": "べん",
      "meaning": "exertion, endeavour, encourage",
      "onyomi": ["ベン"],
      "kunyomi": ["つと.める"]
    },
     {
      "kanji": "強",
      "reading": "きょう",
      "meaning": "strong",
      "onyomi": ["キョウ", "ゴウ"],
      "kunyomi": ["つよ.い", "つよ.まる", "つよ.める", "し.いる"]
    }
  ]
}

Input: 日本

Output:
{
  "type": "Vocab",
  "vocab": "日本",
  "reading": "にほん",
  "definitions": ["Japan"],
  "partOfSpeech": "proper-noun",
  "conjugationType": null,
  "meaning_explanation": "The country of Japan. Literally 'sun origin' (Land of the Rising Sun).",
  "reading_explanation": "Usually read 'Nihon', but sometimes 'Nippon' (more formal or emphatic).",
  "context_examples": [
    { "sentence": "日本[にほん]に行[い]きたいです。", "translation": "I want to go to Japan.", "usage": "Japan (the country)" }
  ],
  "kanaOnly": false,
  "component_kanji": [
    {
      "kanji": "日",
      "reading": "に",
      "meaning": "day, sun, Japan",
      "onyomi": ["ニチ", "ジツ"],
      "kunyomi": ["ひ", "か"]
    },
     {
      "kanji": "本",
      "reading": "ほん",
      "meaning": "book, present, main, origin, true, real",
      "onyomi": ["ホン"],
      "kunyomi": ["もと"]
    }
  ]
}

Input: くれる

Output:
{
  "type": "Vocab",
  "vocab": "くれる",
  "reading": "くれる",
  "definitions": ["to give (to me/us)", "to do for me/us"],
  "partOfSpeech": "transitive-verb",
  "conjugationType": "ichidan",
  "meaning_explanation": "Used when someone gives something to the speaker (or someone in the speaker's in-group). Always written in kana in modern Japanese — the kanji 呉れる exists but is essentially never used.",
  "reading_explanation": "No kanji reading to explain — this word is written entirely in kana.",
  "context_examples": [
    { "sentence": "友達[ともだち]がプレゼントをくれました。", "translation": "My friend gave me a present.", "usage": "someone gives (to me)" }
  ],
  "kanaOnly": true,
  "component_kanji": []
}
`;

// ---------------------------------------------------------------------------
// Vocab lesson user messages
// ---------------------------------------------------------------------------

/**
 * Builds the user message for single vocab lesson generation.
 * When using a cached context (batch mode), a short message is sufficient because
 * VOCAB_INSTRUCTIONS is already loaded into the cache as the system instruction.
 * Source: lessons.service.ts:generateLesson (Vocab branch)
 */
export function buildVocabLessonMessage(content: string, useCached: boolean, jlptLevel: string): string {
  if (useCached) {
    return `Generate a lesson for the Japanese word: ${content}`;
  }
  return `You are an expert Japanese tutor. You will be asked to generate a lesson for the Japanese word: ${content}.
${VOCAB_INSTRUCTIONS}
${levelConstraint(jlptLevel)}`;
}

/**
 * Builds the system instruction string loaded into Gemini context cache for batch processing.
 * Combines VOCAB_INSTRUCTIONS and VOCAB_EXAMPLES so individual batch requests can be short.
 * Source: lessons.service.ts:processBatch
 */
export function buildVocabCacheContext(jlptLevel: string): string {
  return `You are an expert Japanese tutor. You will be asked to generate a lesson for a Japanese word.\n${VOCAB_INSTRUCTIONS}\n${levelConstraint(jlptLevel)}\n\n${VOCAB_EXAMPLES}`;
}

// ---------------------------------------------------------------------------
// Kanji details (fallback metadata lookup)
// ---------------------------------------------------------------------------

/** System prompt for Kanji Alive-style metadata lookup. Source: gemini.service.ts:generateKanjiDetails */
export function buildKanjiDetailsSystemPrompt(kanji: string): string {
  return `You are a Japanese Kanji expert. Provide metadata for the kanji: ${kanji}.`;
}

/** User message for Kanji Alive-style metadata lookup. Source: gemini.service.ts:generateKanjiDetails */
export function buildKanjiDetailsUserMessage(kanji: string): string {
  return `Generate a valid JSON object matching the Kanji Alive API structure for the character ${kanji}.`;
}

/**
 * Builds a Vocab lesson's usages (senses) from its existing examples and definitions, without
 * rewriting the examples: each usage gets a label, the literal answer a learner would type and
 * other accepted answers, and each example is assigned to one usage.
 * `fixedLabels`: an example's existing label, which MUST be kept verbatim (pictures match on it),
 * or null if it has none. Source: lessons.service.ts:buildVocabUsages
 */
export function buildUsageBuildMessage(
  vocab: string,
  definitions: string[],
  examples: { sentence: string; translation: string }[],
  fixedLabels: (string | null)[],
  partOfSpeech?: string,
): string {
  const list = examples
    .map((e, i) => {
      const label = fixedLabels[i];
      return `${i + 1}. ${e.sentence.replace(/\[[^\]]*\]/g, '')} — ${e.translation}${label ? `  [FIXED LABEL: "${label}"]` : ''}`;
    })
    .join('\n');
  const defs = definitions.map((d, i) => `${i + 1}. ${d}`).join('\n');
  return `You are an expert Japanese lexicographer preparing quiz data for a learner of Japanese.

The word is 「${vocab}」${partOfSpeech ? ` (part of speech: ${partOfSpeech})` : ''}.

Its definitions:
${defs || '(none)'}

Its example sentences:
${list}

Your task: list the word's distinct USAGES (senses) as shown by these examples, and say which usage each example shows. The learner will later be shown the bare word and asked what it means; their typed answer is matched against each usage's "meaning" and "acceptedAnswers".

Rules:
1. A usage is a difference in MEANING, never in grammar: a change of grammatical role is not a new usage. For noun-suru words (nouns that also take する), the noun use and the する-verb use are ONE usage (e.g. 練習 "practice" and 練習する "to practise"), unless the noun also names a distinct thing (e.g. 電話: "a telephone" vs "making a call"; 料理: "a dish / cuisine" vs "cooking"). Genuinely different meanings are different usages (e.g. 掛かる: "takes (time)" vs "costs (money)" vs "hangs").
   Senses that a learner would answer with the SAME English word are ONE usage, even if a Japanese dictionary separates them: the learner's typed answer is the only way to tell usages apart. E.g. 子供 "a young person" and "one's own offspring" are both "child"; 人 "person" and "people" are one usage.
2. Every usage MUST be shown by at least one example. NEVER invent a usage that no example shows.
3. FIXED LABELS: an example marked [FIXED LABEL: "..."] already belongs to the usage with exactly that label. Use that label VERBATIM as the usage's "label" (same spelling, case and punctuation). Examples with the same fixed label share one usage. NEVER rename, merge or split fixed labels.
4. An example without a fixed label goes to the usage it shows, creating a new usage only if no listed usage fits. A new usage's "label" is a few English words naming the sense.
5. "meaning" is the single short English gloss a learner would most naturally type for that usage (e.g. "dark", "unfamiliar with", "to hang"). NEVER a description or a label with slashes.
6. "acceptedAnswers" are the other short glosses a learner might type for the SAME usage. Split a definition that lists several glosses ("dark, gloomy, dim") into separate glosses, and put each where it belongs. For verbs give glosses with "to" ("to hang"); for adjectives and nouns, without. Do not repeat "meaning". NEVER include a gloss that belongs to a different usage.
7. Account for EVERY definition: each gloss in it either appears in some usage's "meaning" or "acceptedAnswers", or the whole definition is copied verbatim into "setAside" because no example shows that sense.
8. "exampleUsages" has exactly ${examples.length} entries, one per example in order: the 0-based index into "usages" of the usage that example shows.
9. English only in "label", "meaning" and "acceptedAnswers". NEVER Romaji. NEVER rewrite the examples.

Example A. 「暗い」, definitions: 1. dark  2. dark, gloomy, dim  3. depressed, cheerless, somber  4. unfamiliar with, ignorant of
Examples: 1. この部屋は暗いですね。 [FIXED LABEL: "dark (lacking light)"]  2. 彼は暗い顔をしています。 [FIXED LABEL: "gloomy / depressed"]  3. コンピューターに暗いので… [FIXED LABEL: "unfamiliar with / ignorant of"]
Output: {"usages": [{"label": "dark (lacking light)", "meaning": "dark", "acceptedAnswers": ["dim"]}, {"label": "gloomy / depressed", "meaning": "gloomy", "acceptedAnswers": ["depressed", "cheerless", "somber"]}, {"label": "unfamiliar with / ignorant of", "meaning": "unfamiliar with", "acceptedAnswers": ["ignorant of"]}], "exampleUsages": [0, 1, 2], "setAside": []}

Example B. 「掛ける」, definitions: 1. to hang (something)  2. to put on (e.g. glasses)  3. to make (a phone call)  4. to spend (time, money)  5. to lock (a door)  6. to sit down
Examples (no fixed labels): 1. 壁に絵を掛けました。  2. 友達に電話を掛けます。  3. どうぞお掛けください。  4. ドアに鍵を掛けてください。
Output: {"usages": [{"label": "hanging something", "meaning": "to hang", "acceptedAnswers": []}, {"label": "making a phone call", "meaning": "to call", "acceptedAnswers": ["to make a phone call", "to make a call"]}, {"label": "sitting down", "meaning": "to sit", "acceptedAnswers": ["to sit down", "to take a seat"]}, {"label": "locking", "meaning": "to lock", "acceptedAnswers": ["to lock a door"]}], "exampleUsages": [0, 1, 2, 3], "setAside": ["to put on (e.g. glasses)", "to spend (time, money)"]}

Return ONLY the JSON object, with no text before or after it.`;
}
