/**
 * Prompts for picture cards: a text-free illustration that anchors a Vocab word's
 * meaning to its sound (audio-first vocab, #246). Two steps — a text model writes a
 * scene brief (the judgement: cast or not, background or not), then an image model
 * renders it inside a fixed house style with the Fude / Suzuri cast. A third call
 * checks the result for leaked text. Tuned against 8 test words on 2026-11-02.
 */

import type { PictureBrief, PictureStyle } from '../types';

export type { PictureBrief, PictureStyle };

export const PICTURE_BRIEF_SCHEMA = {
  type: 'OBJECT',
  properties: {
    picturable: { type: 'BOOLEAN' },
    includeCast: { type: 'BOOLEAN' },
    background: { type: 'STRING' },
    scene: { type: 'STRING' },
    // Only when picturable is false: shown to the admin so they know why.
    reason: { type: 'STRING' },
  },
  required: ['picturable', 'includeCast', 'background', 'scene'],
};

/** Input to the brief step. `note` is an admin instruction that takes precedence. */
export interface PictureBriefInput {
  word: string;
  reading: string;
  usage: string;
  definition: string;
  sentence: string;
  translation: string;
  note?: string;
}

export function buildPictureBriefMessage(w: PictureBriefInput): string {
  const reading = w.reading && w.reading !== w.word ? ` (${w.reading})` : '';
  const meaning = w.usage && w.usage !== w.definition ? `${w.usage} — ${w.definition}` : w.definition || w.usage;
  const example = w.sentence ? `\nExample sentence: ${w.sentence} — ${w.translation}` : '';
  return `You are designing a single illustration that helps a learner remember a Japanese
word by its meaning, without any text. The picture will be shown alongside spoken
audio of the word${w.sentence ? ' and an example sentence' : ''}.

Word: ${w.word}${reading}
Meaning / usage to depict: ${meaning}${example}

Decide:
- picturable: false ONLY for particles, grammatical endings and pure function words.
  Everything else, including abstract nouns and adverbs of time or manner, is
  picturable: show a situation in which the meaning is evident (e.g. "beforehand":
  someone getting things ready the night before, with a cue that the event is later).
- includeCast: true only if the meaning needs someone doing or feeling something
  (actions, feelings, adjectives describing reactions, social situations). False for
  objects, places, animals and things.
- When includeCast is true, the person in the scene is "Fude" (a young woman); the
  little inkstone mascot "Suzuri" may join only if it helps. No other people unless
  the meaning needs them.
- background: "none" unless a background element is part of the meaning (time of
  day for timing words, a recognisable place for place words, weather for weather
  words). If needed, name at most two simple elements.
- For place words, show one or two iconic elements of the place, not the whole place.
- Avoid objects that normally carry writing or logos (signs, ticket gates, display
  boards, shop fronts, packaging, vehicle destination boards, app icons). Screens are
  blank or a soft abstract colour.
- scene: one or two sentences describing exactly what is shown. The subject must be
  the obvious focus. Use modern, everyday Japan (modern kitchens, streets, trains,
  phones), not traditional or historical settings, unless the word itself is
  traditional.
- For adjectives, show the quality through contrast or a reaction, not just an
  object that has it.
- Make the scene point to THIS word, not a more concrete neighbour (e.g. for
  "practice", show repetition and effort, not a performance).

${noteBlock(w.note)}
Return JSON only:
{"picturable": bool, "includeCast": bool, "background": "none" | string,
 "scene": string,
 "reason": string (only when picturable is false: one short sentence saying why)}`;
}

function noteBlock(note?: string): string {
  return note?.trim()
    ? `\nEDITOR'S NOTE (follow it; where it conflicts with the guidance above, the note wins):\n${note.trim()}\n`
    : '';
}

/**
 * Brief for a free-standing picture (not tied to any word): the editor's description
 * is the subject. Same rules and output as a word brief.
 */
export function buildFreePictureBriefMessage(description: string): string {
  return `You are designing a single text-free illustration for a Japanese learning app,
from an editor's description.

Description: ${description.trim()}

Decide:
- picturable: true unless the description cannot be drawn without text.
- includeCast: true only if the description involves Fude (a young woman) or Suzuri
  (a little inkstone mascot), or needs a person and nobody else is specified.
- background: "none" unless the description needs a setting; then at most two simple
  elements.
- Avoid objects that normally carry writing or logos.
- scene: one or two sentences describing exactly what is shown.

Return JSON only:
{"picturable": bool, "includeCast": bool, "background": "none" | string,
 "scene": string,
 "reason": string (only when picturable is false: one short sentence saying why)}`;
}

const CAST_BLOCK = `
CHARACTERS (keep exactly as in the attached reference images):
- Fude (first reference): a young woman with a brown bob and a topknot shaped like a
  calligraphy brush tip, white bristles fading to a black ink tip; pink kimono with a
  green obi.
- Suzuri (second reference): a small rectangular black inkstone with round glasses,
  rosy cheeks, a maroon beret and short stubby arms and legs.
Fude and Suzuri ARE the people in the scene; do not add other people unless the scene
explicitly requires them. Use only the characters the scene needs. Each character
appears at most once, and the brush shape exists only as Fude's topknot: no loose
brushes or extra brush tips.
`;

/** Render presets (PictureStyle is defined in types). */
export const PICTURE_STYLES: Record<PictureStyle, { aspectRatio: string }> = {
  card: { aspectRatio: '1:1' },
  scene: { aspectRatio: '16:9' },
};
export const isPictureStyle = (s: unknown): s is PictureStyle => s === 'card' || s === 'scene';

export function buildPictureImagePrompt(brief: PictureBrief, style: PictureStyle = 'card'): string {
  if (style === 'scene') return buildSceneImagePrompt(brief);
  const bg = brief.background && brief.background.trim().toLowerCase() !== 'none'
    ? `, with only: ${brief.background}, kept simple, minimal and desaturated`
    : '';
  return `A single square illustration (1:1). No panels, no border.

STYLE: soft watercolour with clean, fine ink linework; gentle, warm, slightly muted
palette; friendly chibi-manga proportions; simple shapes; soft shadows.

BACKGROUND: flat plain cream paper (#F9F7F2) filling the whole frame${bg}.
Nothing else in the background. Any background elements form a small, soft vignette
around the subject that fades into the cream paper: never a full-bleed room or a
framed rectangle.

COMPOSITION: the subject is centred and clearly the focus, filling about 60–70% of
the frame, with an even margin on all sides.
${brief.includeCast ? CAST_BLOCK : ''}
SCENE: ${brief.scene}

ABSOLUTELY NO TEXT OF ANY KIND: no letters, words, kana, kanji, numbers, labels,
signs, captions, logos or symbols. Any paper, book, screen, scroll or sign must be
blank. Clocks have hands but no numerals. Calendars, if shown, have blank squares.`;
}

function buildSceneImagePrompt(brief: PictureBrief): string {
  const bg = brief.background && brief.background.trim().toLowerCase() !== 'none' ? brief.background : 'a simple, uncluttered setting';
  return `A single wide illustration (16:9). No panels, no border.

STYLE: soft watercolour with clean, fine ink linework; gentle, warm, slightly muted
palette; friendly chibi-manga proportions; simple shapes; soft shadows.

SETTING: ${bg}. A soft, desaturated watercolour background that fades gently towards
cream paper (#F9F7F2) at the edges. Keep it calm and uncluttered: a few clear,
recognisable elements, not a busy, detailed room.

COMPOSITION: an establishing view of the scene, with any people at a comfortable
middle distance and the important elements easy to read at a glance.
${brief.includeCast ? CAST_BLOCK : ''}
SCENE: ${brief.scene}

ABSOLUTELY NO TEXT OF ANY KIND: no letters, words, kana, kanji, numbers, labels,
signs, captions, logos or symbols. Signs, menus, price tags, screens, noren and
posters must be blank or plain colour. Clocks have hands but no numerals.`;
}

export const PICTURE_TEXT_CHECK_PROMPT =
  'Does this image contain any writing of any kind: letters, words, kana, kanji, numbers, labels, signs, captions, logos or symbols that read as text (including fake or illegible text)? Answer with JSON {"hasText": boolean, "where": string}.';

export const PICTURE_TEXT_CHECK_SCHEMA = {
  type: 'OBJECT',
  properties: { hasText: { type: 'BOOLEAN' }, where: { type: 'STRING' } },
  required: ['hasText', 'where'],
};
