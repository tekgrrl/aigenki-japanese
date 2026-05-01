/**
 * Prompts for Vocab and Kanji lesson generation.
 * Sources: backend/src/lessons/lessons.service.ts, backend/src/gemini/gemini.service.ts
 */

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
* Generate context examples that are no more complex that JLPT N4 even if the vocabulary itself is more advanced.
* Analyze component Kanji.
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
    { "sentence": "Japanese sentence with Furigana in brackets e.g. 明日[あした]", "translation": "English translation." }
  ],
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
    { "sentence": "田中[たなか]先生[せんせい]は日本語[にほんご]を教[おし]えています。", "translation": "Professor Tanaka teaches Japanese." }
  ],
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
    { "sentence": "朝[あさ]ごはんにパンを食[た]べました。", "translation": "I ate bread for breakfast." }
  ],
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
    { "sentence": "彼[かれ]は有名[ゆうめい]な歌手[かしゅ]です。", "translation": "He is a famous singer." }
  ],
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
    { "sentence": "毎日[まいにち]日本語[にほんご]を勉強[べんきょう]します。", "translation": "I study Japanese every day." }
  ],
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
    { "sentence": "日本[にほん]に行[い]きたいです。", "translation": "I want to go to Japan." }
  ],
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
export function buildVocabLessonMessage(content: string, useCached: boolean): string {
  if (useCached) {
    return `Generate a lesson for the Japanese word: ${content}`;
  }
  return `You are an expert Japanese tutor. You will be asked to generate a lesson for the Japanese word: ${content}.
${VOCAB_INSTRUCTIONS}`;
}

/**
 * Builds the system instruction string loaded into Gemini context cache for batch processing.
 * Combines VOCAB_INSTRUCTIONS and VOCAB_EXAMPLES so individual batch requests can be short.
 * Source: lessons.service.ts:processBatch
 */
export function buildVocabCacheContext(): string {
  return `You are an expert Japanese tutor. You will be asked to generate a lesson for a Japanese word.\n${VOCAB_INSTRUCTIONS}\n\n${VOCAB_EXAMPLES}`;
}

// ---------------------------------------------------------------------------
// Kanji lesson
// ---------------------------------------------------------------------------

/** Full prompt for generating a Kanji lesson. Source: lessons.service.ts:generateLesson */
export function buildKanjiLessonPrompt(content: string): string {
  return `You are an expert Japanese tutor. You will be asked to generate a lesson for the Japanese Kanji: ${content}.

The lesson should be in English. Where you want to use Japanese text for examples, explanations, meanings and readings do so but do not include Romaji.

**Task 1: Detailed breakdown**
* Provide the **Meanings**, **On'yomi**, **Kun'yomi** readings.
* Identify the **Radical** (character, meaning).
* **Stroke Count**.

**Task 2: Mnemonics**
* Generate a **Meaning Mnemonic**.
* Generate a **Reading Mnemonic**.

**Task 3: Related Vocabulary**
* Provide 3-5 related vocabulary words (Content + Reading).

**Response Schema:**
You MUST return a valid JSON object matching this schema:
{
  "type": "Kanji",
  "kanji": "The Kanji character",
  "meaning": "Core meaning(s)",
  "onyomi": ["reading (katakana)"],
  "kunyomi": ["reading (hiragana)"],
  "strokeCount": 0,
  "strokeImages": [],
  "radical": {
    "character": "Radical char",
    "meaning": "Radical meaning",
    "image": "",
    "animation": []
  },
  "mnemonic_meaning": "Story...",
  "mnemonic_reading": "Story...",
  "relatedVocab": [
    { "id": "", "content": "Word", "reading": "Reading" }
  ]
}`;
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
