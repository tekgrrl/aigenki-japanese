/**
 * Prompts for scenario generation and roleplay chat.
 * Source: backend/src/scenarios/scenarios.service.ts
 */

import { GenerateScenarioDto, ImportScenarioDto, Scenario } from '../types/scenario';
import { GrammarSection } from '../types/grammar-section';
import { FRAGMENT_CONTRACT, ACCEPTED_ALTERNATIVES_DEF } from './fragments';
import { DEFAULT_JLPT_LEVEL } from './curriculum';

// ---------------------------------------------------------------------------
// Role allowlists
// (Copied from scenarios.service.ts — Phase 2 will flip the import direction)
// ---------------------------------------------------------------------------

export const ALLOWED_USER_ROLES = [
  'Traveller', 'Customer', 'Guest', 'Student', 'Patient', 'Me', 'Passenger',
  'Software Engineer', 'Pedestrian', 'Diner', 'Driver', 'Japanophile',
  '客', '私', '旅行者', '学生', '患者', '乗客', 'プログラマー', '歩行者', 'ダイナー', 'ドライバー'
];

export const ALLOWED_AI_ROLES = [
  'Teacher', 'Sensei', 'Staff', 'Clerk', 'Shopkeeper', 'Manager', 'Doctor', 'Nurse', 'Police', 'Officer', 'Station Attendant',
  'Colleague', 'Pedestrian', 'Server', 'Receptionist',
  '先生', '店員', '医者', '看護師', '警察', '駅員', '係員', '受付',
];

// ---------------------------------------------------------------------------
// Scenario generation response schema
// ---------------------------------------------------------------------------

/**
 * Enforced via Gemini's `responseSchema` on both scenario-generation prompts
 * (architect + import). `dialogue[].speakerRole` is `required` + `enum` here
 * so the model can no longer omit it — the prompt text alone wasn't enough to
 * guarantee it, which let scenarios reach the fuzzy speaker-name-matching
 * fallback in `getInitialChatHistory` (the bug GitHub #213 was meant to retire).
 */
export const SCENARIO_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    description: { type: 'STRING' },
    setting: {
      type: 'OBJECT',
      properties: {
        location: { type: 'STRING' },
        participants: { type: 'ARRAY', items: { type: 'STRING' } },
        goal: { type: 'STRING' },
        timeOfDay: { type: 'STRING' },
        visualPrompt: { type: 'STRING' },
      },
      required: ['location', 'participants', 'goal', 'timeOfDay', 'visualPrompt'],
    },
    roles: {
      type: 'OBJECT',
      properties: {
        user: { type: 'STRING' },
        ai: { type: 'STRING' },
      },
      required: ['user', 'ai'],
    },
    dialogue: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          speaker: { type: 'STRING' },
          speakerRole: { type: 'STRING', enum: ['user', 'ai'] },
          text: { type: 'STRING' },
          translation: { type: 'STRING' },
        },
        required: ['speaker', 'speakerRole', 'text', 'translation'],
      },
    },
    extractedKUs: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          content: { type: 'STRING' },
          reading: { type: 'STRING' },
          meaning: { type: 'STRING' },
          type: { type: 'STRING', enum: ['vocab', 'kanji'] },
          jlptLevel: { type: 'STRING', enum: ['N5', 'N4', 'N3', 'N2', 'N1'] },
        },
        required: ['content', 'reading', 'meaning', 'jlptLevel'],
      },
    },
    grammarMatches: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          kuId: { type: 'STRING' },
          exampleFromConversation: {
            type: 'OBJECT',
            properties: {
              japanese: { type: 'STRING' },
              english: { type: 'STRING' },
              fragments: { type: 'ARRAY', items: { type: 'STRING' } },
              accepted_alternatives: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['japanese', 'english', 'fragments', 'accepted_alternatives'],
          },
        },
        required: ['kuId', 'exampleFromConversation'],
      },
    },
  },
  required: ['title', 'description', 'setting', 'roles', 'dialogue', 'extractedKUs', 'grammarMatches'],
};

// ---------------------------------------------------------------------------
// Scenario architect prompt
// ---------------------------------------------------------------------------

/**
 * Builds the full prompt for generating a new scenario.
 * Source: scenarios.service.ts:buildArchitectPrompt (private method, extracted verbatim)
 */
export function buildArchitectPrompt(
  dto: GenerateScenarioDto,
  excludedVocab: string[] = [],
  excludedGrammar: string[] = [],
  grammarSection: GrammarSection | null = null,
): string {
  const contextExampleDirective = dto.sourceType === 'context-example' && dto.sourceContextSentence && dto.targetVocab
    ? `\n**Context Example Constraints:**\n- You MUST create a roleplay scenario where the user MUST use the target vocab ('${dto.targetVocab}') in a situation matching the following sentence: '${dto.sourceContextSentence}'.\n- The scenario goal MUST involve using this word in context.\n`
    : '';

  const grammarPatternDirective = dto.sourceType === 'grammar-pattern' && grammarSection
    ? `\n**Grammar Pattern Constraints (critical):**\n- This scenario exists to give the learner practice with the pattern "${grammarSection.pattern}". Rule: ${grammarSection.explanation}\n- The dialogue MUST naturally demonstrate this pattern at least once — a real, idiomatic use in context, not a token mention. Do not force it into an awkward line just to check a box; build the scene so it's the natural thing to say.\n- Reference examples written by the learner's own tutor, for tone/register only — do NOT copy them verbatim into the dialogue:\n${grammarSection.examples.slice(0, 3).map(ex => `  - ${ex.japanese} (${ex.english})`).join('\n')}\n`
    : '';

  const exclusionDirective = (excludedVocab.length > 0 || excludedGrammar.length > 0)
    ? `\n**Excluded content (critical):** The learner explicitly said they don't want to see these right now. NEVER use them anywhere in the dialogue, Target Words, or grammarMatches, even as incidental content:\n- Vocab: ${excludedVocab.join('、') || 'none'}\n- Grammar: ${excludedGrammar.join('、') || 'none'}\n`
    : '';

  return `
You are an expert Japanese language curriculum designer.
Create a "Genki-style" learning scenario for an ADULT traveler/expat (not a student).

**Parameters:**
- Target Level: ${dto.difficulty}
- Theme/Setting: ${dto.theme || 'A common situation for an adult living in Japan'}${contextExampleDirective}${grammarPatternDirective}${exclusionDirective}

**Requirements:**
1. **Dialogue:** Create a natural, realistic dialogue (6-12 lines). Use a mix of polite and casual forms appropriate for the setting.
2. **Vocabulary:** STRICTLY LIMIT vocabulary to ${dto.difficulty} level. Introduce exactly 3-5 "Target Words" required for the specific goal.
3. **Grammar Matches:** Call \`get_grammar_patterns("${dto.difficulty}")\` to see the available grammar pool. Identify 1-2 patterns from those results that naturally appear in your dialogue. For each, provide a short example sentence taken directly from the conversation (with fragments for the typing exercise). If no patterns from the pool fit the dialogue, return an empty \`grammarMatches\` array.
4. **Visual Context:** Provide a descriptive prompt that could be used to generate an image of the scene.
5. **Role Constraints:**
${dto.userRole && dto.aiRole
      ? `   - **User Role:** ${dto.userRole}\n   - **AI Role:** ${dto.aiRole}\n   - Use these exact terms for the 'roles' object and 'participants' array.`
      : dto.userRole
        ? `   - **User Role:** ${dto.userRole} — use this exact term for the user in the 'roles' object and 'participants' array.\n   - **Partner Roles:** ${ALLOWED_AI_ROLES.join(', ')}\n   - Choose an appropriate partner role from the list above for this scenario.`
        : `   - **User Roles:** ${ALLOWED_USER_ROLES.join(', ')}\n   - **Partner Roles:** ${ALLOWED_AI_ROLES.join(', ')}\n   - Use these exact terms (or their Japanese equivalents provided in the list) for the 'roles' object and 'participants' array.`
    }
6. **Data Formatting (CRITICAL):**
   - \`title\`, \`description\` and all \`setting\` object fields should be in English
   - **NO ROMAJI**. Never include Romaji in any field — including grammar explanations. Write Japanese words in Japanese script (e.g. です, の) not romanised text (e.g. 'desu', 'no').
   - **\`dialogue[].speakerRole\` is REQUIRED on every line and MUST be either \`"user"\` or \`"ai"\`.** Set it based on who is actually speaking, independent of whatever name or language you chose for the \`speaker\` field on that same line (e.g. if \`speaker\` is "店員", a Japanese label, and that character is one of your AI role(s), \`speakerRole\` is still \`"ai"\`).
   - **Extracted KUs:**
     - \`content\`: Japanese text ONLY (e.g., "本屋"). No readings or definitions in this field.
     - \`reading\`: Kana reading ONLY (e.g., "ほんや"). No Romaji.
     - \`meaning\`: English definition ONLY.
     - \`jlptLevel\`: JLPT level hint for this word (e.g., "N4"). MUST be one of: N5, N4, N3, N2, N1. Use your best judgement for the level of each individual word.
   - For \`grammarMatches\`:
     - \`kuId\`: The exact kuId returned by \`get_grammar_patterns\`. Never invent an ID.
     - \`exampleFromConversation\`: A sentence taken from your dialogue that demonstrates the pattern. Fragments must follow the fragment contract below.

**Output Schema (Return ONLY raw JSON):**
{
  "title": "Scenario Title",
  "description": "Brief context (e.g. 'You are at a convenience store...')",
  "setting": {
    "location": "Specific location",
    "participants": ["Role A", "Role B"],
    "goal": "What the user needs to achieve",
    "timeOfDay": "Morning/Evening/etc",
    "visualPrompt": "Detailed visual description of the scene for an image generator"
  },
  "roles": {
    "user": "EXACT_NAME_OF_USER_ROLE_FROM_PARTICIPANTS_ARRAY",
    "ai": "EXACT_NAME_OF_AI_ROLE_FROM_PARTICIPANTS_ARRAY"
  },
  "dialogue": [
    {
      "speaker": "EXACT_NAME_FROM_PARTICIPANTS_ARRAY",
      "speakerRole": "user or ai — MUST exactly match who is actually speaking this line, regardless of what name/language you used for 'speaker'",
      "text": "Japanese text",
      "translation": "English translation"
    }
  ],
  "extractedKUs": [
    {
      "content": "本屋",
      "reading": "ほんや",
      "meaning": "Bookstore",
      "type": "vocab",
      "jlptLevel": "N4"
    }
  ],
  "grammarMatches": [
    {
      "kuId": "exact-ku-id-from-tool",
      "exampleFromConversation": {
        "japanese": "Sentence from the dialogue in Japanese only, no furigana or Romaji",
        "english": "English translation of the example",
        "fragments": ["minimal", "meaningful", "chunks", "of", "the", "sentence"],
        "accepted_alternatives": ["array of valid re-orderings or omittable-particle variants, or empty array"]
      }
    }
  ]
}

**Grammar Match Fragments Rules:**
- ${FRAGMENT_CONTRACT}
- ${ACCEPTED_ALTERNATIVES_DEF}
`;
}

// ---------------------------------------------------------------------------
// Scenario chat system prompt
// ---------------------------------------------------------------------------

/**
 * Builds the system prompt for a single roleplay chat turn.
 * Source: scenarios.service.ts:handleChat
 *
 * @param scenario - The current scenario document.
 * @param aiRole - The AI's role name (pre-resolved by the service).
 * @param userRole - The user's role name (pre-resolved by the service).
 * @param referenceScript - The formatted dialogue reference string (pre-formatted by the service).
 * @param historyLines - The formatted chat history string (pre-formatted by the service).
 */
export function buildChatSystemPrompt(
  scenario: Scenario,
  aiRoles: string | string[],
  userRole: string,
  referenceScript: string,
  historyLines: string,
  excludedVocab: string[] = [],
  excludedGrammar: string[] = [],
): string {
  const rolesArray = Array.isArray(aiRoles) ? aiRoles : [aiRoles];
  const multiRole = rolesArray.length > 1;
  const roleLabel = multiRole ? rolesArray.join(', ') : rolesArray[0];
  const exclusionInstruction = (excludedVocab.length > 0 || excludedGrammar.length > 0)
    ? `\n      13. EXCLUDED CONTENT (critical): The learner explicitly said they don't want to see these right now — NEVER use them, even in passing: Vocab: ${excludedVocab.join('、') || 'none'}. Grammar: ${excludedGrammar.join('、') || 'none'}.`
    : '';

  return `
      You are a roleplay partner in a Japanese immersion scenario.
      **Scenario Context:**
      - Title: ${scenario.title}
      - Setting: ${scenario.setting.location}
      - Your Role(s): ${roleLabel}
      - User Role: ${userRole}
      - Goal: ${scenario.setting.goal}
      - Difficulty: ${scenario.difficultyLevel}
${scenario.simulationBrief ? `
      **EXTENDED SITUATION (this role play goes beyond the script):**
      ${scenario.simulationBrief}
      Bring this in naturally once the conversation is under way. It should stretch the learner, not catch them out: give them room to respond, and help them through it if they struggle.
` : ''}
      **REFERENCE SCRIPT (PLOT OUTLINE):**
      ${referenceScript}

      **PREVIOUS CHAT HISTORY:**
      ${historyLines}

      **INSTRUCTIONS:**
      1. You are acting out the role(s) of ${roleLabel}.${multiRole ? `\n      1a. Each response should come from ONE character. Pick the most appropriate character to respond based on context and the reference script.` : ''}
      2. Use the 'REFERENCE SCRIPT' as your guide for the conversation flow.
      3. You must ensure key events/questions from the script occur.
      4. Speak ONLY in Japanese appropriate for the setting and your role.
      5. Engage the user to help them achieve the goal.
      6. Do NOT repeat greetings if they have already been said (check 'PREVIOUS CHAT HISTORY').
      7. Only ask for *missing* details.
      8. Reply naturally to the User's last message.
      9. If the user makes a mistake (grammar/vocab), reply naturally but include a short "correction" in the JSON.
      10. Keep responses concise (1-2 sentences).
      11. CHECK GOAL: If the user has explicitly and successfully achieved the goal ("${scenario.setting.goal}") during this turn, set 'sceneFinished' to true in your JSON response. Otherwise false.
      12. Set 'speaker' in your JSON response to the exact role name of the character speaking (one of: ${rolesArray.join(', ')}).${exclusionInstruction}
    `;
}

// ---------------------------------------------------------------------------
// Live-chat knowledge extraction prompt
// ---------------------------------------------------------------------------

/**
 * Builds the prompt for mining new vocab/grammar from what the user actually
 * said during a live 'simulate' roleplay — as opposed to buildArchitectPrompt,
 * which extracts from the AI's own pre-scripted dialogue.
 *
 * @param scenario - The completed scenario document.
 * @param userLines - The user's own chatHistory turns, verbatim (never the AI's lines).
 * @param corrections - The evaluation's corrections[] — things the user got wrong, so they
 *                       must be EXCLUDED from credit (a correction proves the user did NOT
 *                       produce that form correctly themselves).
 */
export function buildLiveExtractionPrompt(
  scenario: Scenario,
  userLines: string[],
  corrections: { original: string; correction: string; explanation: string }[],
): string {
  const userLinesBlock = userLines.length > 0
    ? userLines.map((line, i) => `${i + 1}. ${line}`).join('\n')
    : '(no user lines)';

  const correctionsBlock = corrections.length > 0
    ? corrections.map(c => `- User said/wrote: "${c.original}" → should have been: "${c.correction}" (${c.explanation})`).join('\n')
    : '(none — the user made no flagged mistakes this session)';

  return `
You are a Japanese language curriculum assistant. A learner just finished a LIVE roleplay conversation (not a scripted one) at level ${scenario.difficultyLevel}, titled "${scenario.title}".

**What the learner actually said (their own turns, verbatim, in order):**
${userLinesBlock}

**Mistakes the learner was corrected on this session (EXCLUDE these — they prove the learner did NOT produce this form correctly themselves):**
${correctionsBlock}

**Your task:**
Identify vocabulary and grammar the learner correctly and independently produced in their own lines above — real evidence of what they can actually use, not what the AI said to them. This is being used to update their personal knowledge tracking, so precision matters more than coverage.

**Requirements:**
1. **Vocabulary:** Extract 0-8 vocab words the learner used correctly and independently. Do NOT include anything from the corrections list above. Do NOT extract vocabulary that only appeared in the AI's lines. If nothing qualifies, return an empty array — do not force matches.
2. **Grammar:** Call \`get_grammar_patterns("${scenario.difficultyLevel}")\` to see the pool of grammar patterns this learner is already enrolled in. Identify 0-3 patterns from those results that the learner actually used correctly in their own lines above (not merely patterns the AI used). For each, provide the learner's own sentence as the example (with fragments for the typing exercise). If none of the pool's patterns were used correctly by the learner, return an empty \`grammarMatches\` array — do not force matches.
3. **Data Formatting (CRITICAL):**
   - **NO ROMAJI**. Write Japanese words in Japanese script only.
   - \`kuId\` in \`grammarMatches\` MUST be the exact id returned by \`get_grammar_patterns\`. Never invent an ID.
   - \`exampleFromConversation.japanese\` MUST be the learner's own words from the "What the learner actually said" block above, not a rewritten or idealized version.

**Output Schema (Return ONLY raw JSON):**
{
  "extractedKUs": [
    {
      "content": "Japanese text only",
      "reading": "Kana reading only",
      "meaning": "English definition",
      "type": "vocab",
      "jlptLevel": "N4"
    }
  ],
  "grammarMatches": [
    {
      "kuId": "exact-ku-id-from-tool",
      "exampleFromConversation": {
        "japanese": "The learner's own sentence, verbatim",
        "english": "English translation",
        "fragments": ["minimal", "meaningful", "chunks"],
        "accepted_alternatives": ["array of valid re-orderings, or empty array"]
      }
    }
  ]
}

**Grammar Match Fragments Rules:**
- ${FRAGMENT_CONTRACT}
- ${ACCEPTED_ALTERNATIVES_DEF}
`;
}

// ---------------------------------------------------------------------------
// Manual conversation import prompt
// ---------------------------------------------------------------------------

/**
 * Builds the prompt for structuring a user-provided conversation into a scenario.
 * Preserves the original Japanese verbatim — no corrections or rewrites.
 */
export function buildImportPrompt(dto: ImportScenarioDto): string {
  const aiRoles = dto.aiRoles ?? (dto.aiRole ? [dto.aiRole] : []);
  const aiRoleList = aiRoles.join(', ');
  const participantList = [dto.userRole, ...aiRoles].map(r => `"${r}"`).join(', ');
  const aiRolesJson = aiRoles.length === 1 ? `"${aiRoles[0]}"` : JSON.stringify(aiRoles);

  return `You are a Japanese language curriculum assistant.
A learner has provided a conversation they want to practice. Structure it as a learning scenario.

**Provided Conversation:**
${dto.conversationText}

**Parameters:**
- Learner's Role: ${dto.userRole}
- Partner Role(s): ${aiRoleList}
- Target Level: ${dto.difficulty ?? DEFAULT_JLPT_LEVEL}${dto.sceneNotes ? `\n- Scene Context: ${dto.sceneNotes}` : ''}

**Instructions:**
1. **Dialogue:** Parse the conversation into structured lines.
   - PRESERVE the original Japanese text VERBATIM — do NOT change, correct, or rewrite any Japanese.
   - Identify which lines belong to "${dto.userRole}" and which to the partner role(s) (${aiRoleList}). Use these exact names as the speaker field.
   - If there are multiple partner roles, assign each line to the most appropriate one based on the conversation context.
   - If the conversation uses labels (A/B, names, numbers), map them to the correct role.
   - Add an accurate English translation for each line.
   - Set \`speakerRole\` on every line to \`"user"\` if it's "${dto.userRole}" speaking, or \`"ai"\` if it's one of the partner role(s) speaking — this must be set independent of whatever label the conversation itself used.
2. **Setting:** Infer location, participants, goal, timeOfDay, and visualPrompt from the conversation.${dto.sceneNotes ? ' Use the provided scene context as your primary guide.' : ''}
3. **Vocabulary:** Extract 3-5 key vocabulary items the learner needs to participate in this conversation.
4. **Grammar Matches:** Call \`get_grammar_patterns("${dto.difficulty ?? DEFAULT_JLPT_LEVEL}")\` to see the available grammar pool. Identify 1-3 patterns from those results that appear in the conversation. For each, provide a short example sentence from the conversation (with fragments for the typing exercise). If no patterns from the pool fit, return an empty \`grammarMatches\` array.
5. **Title & Description:** Write a short English title and description for this scenario.

**Data Formatting Rules:**
- \`title\`, \`description\`, and all \`setting\` fields in English.
- **NO ROMAJI**. Never include Romaji in any field — including grammar explanations. Write Japanese words in Japanese script (e.g. です, の) not romanised text (e.g. 'desu', 'no').
- Extracted KUs: \`content\` = Japanese only, \`reading\` = kana only, \`meaning\` = English definition, \`jlptLevel\` = one of N5/N4/N3/N2/N1.
- Grammar match fragments: ${FRAGMENT_CONTRACT}
- ${ACCEPTED_ALTERNATIVES_DEF}
- \`grammarMatches[].kuId\`: Must be an exact kuId returned by \`get_grammar_patterns\`. Never invent IDs.

**Output Schema (Return ONLY raw JSON):**
{
  "title": "Scenario Title",
  "description": "Brief English context",
  "setting": {
    "location": "Specific location",
    "participants": [${participantList}],
    "goal": "What the learner needs to achieve",
    "timeOfDay": "Morning/Afternoon/Evening/etc",
    "visualPrompt": "Detailed visual description of the scene"
  },
  "roles": {
    "user": "${dto.userRole}",
    "ai": ${aiRolesJson}
  },
  "dialogue": [
    { "speaker": "EXACT_ROLE_NAME", "speakerRole": "user or ai", "text": "Japanese text verbatim", "translation": "English translation" }
  ],
  "extractedKUs": [
    { "content": "本屋", "reading": "ほんや", "meaning": "Bookstore", "type": "vocab", "jlptLevel": "N4" }
  ],
  "grammarMatches": [
    {
      "kuId": "exact-ku-id-from-tool",
      "exampleFromConversation": {
        "japanese": "Example sentence from the conversation",
        "english": "English translation",
        "fragments": ["minimal", "chunks"],
        "accepted_alternatives": []
      }
    }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Script words (a pool scenario's secondary Vocab)
// ---------------------------------------------------------------------------

/** Response shape for buildScriptVocabPrompt: the script's other content words. */
export const SCRIPT_VOCAB_SCHEMA = {
  type: 'OBJECT',
  properties: {
    words: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          content: { type: 'STRING' },
          reading: { type: 'STRING' },
          meaning: { type: 'STRING' },
          jlptLevel: { type: 'STRING', enum: ['N5', 'N4', 'N3', 'N2', 'N1'] },
        },
        required: ['content', 'reading', 'meaning', 'jlptLevel'],
      },
    },
  },
  required: ['words'],
};

/**
 * Asks for the content words in a scenario script that aren't already its Key Vocabulary, so a
 * learner can opt in to learning them too. Lines must be plain text (furigana stripped).
 */
export function buildScriptVocabPrompt(lines: string[], keyVocab: string[]): string {
  return `List the vocabulary a Japanese learner would need to understand this conversation.

Conversation:
${lines.map(l => `- ${l}`).join('\n')}

Rules:
- Content words only: nouns, verbs, adjectives, adverbs, set expressions. Leave out particles, grammar endings, person and place names, and numbers.
- Give each word once, in dictionary form (食べました → 食べる), written as a Japanese dictionary would.
- Leave out these words, which are already taught: ${keyVocab.length ? keyVocab.join('、') : '(none)'}.
- reading: hiragana. meaning: a short English gloss for the sense used here. jlptLevel: the word's JLPT level.`;
}
