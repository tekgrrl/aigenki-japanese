/**
 * The ja-JP Chirp3-HD voices the backend accepts (mirrors CHIRP3_HD_JA_VOICES in
 * backend/src/audio/google-tts.service.ts), with the gender Google lists for each.
 * Used by the pronunciation tool's picker and the scenario Voices panel.
 */
const FEMALE = new Set([
  "Achernar", "Aoede", "Autonoe", "Callirrhoe", "Despina", "Erinome", "Gacrux", "Kore",
  "Laomedeia", "Leda", "Pulcherrima", "Sulafat", "Vindemiatrix", "Zephyr",
]);

const NAMES = [
  "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede", "Autonoe",
  "Callirrhoe", "Charon", "Despina", "Enceladus", "Erinome", "Fenrir",
  "Gacrux", "Iapetus", "Kore", "Laomedeia", "Leda", "Orus", "Puck",
  "Pulcherrima", "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar",
  "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi",
];

export interface VoiceOption {
  /** Short name, e.g. "Kore". */
  label: string;
  /** Full voice name sent to the backend, e.g. "ja-JP-Chirp3-HD-Kore". */
  id: string;
  gender: "female" | "male";
}

export const VOICES: VoiceOption[] = NAMES.map((name) => ({
  label: name,
  id: `ja-JP-Chirp3-HD-${name}`,
  gender: FEMALE.has(name) ? "female" : "male",
}));

/** The app's own voice (the backend's default). */
export const DEFAULT_VOICE = "ja-JP-Chirp3-HD-Orus";

/** Scenario defaults: speakers, in order of first appearance, get these in turn (alternating male/female). */
const SPEAKER_DEFAULTS = ["Orus", "Kore", "Puck", "Aoede", "Charon", "Leda"].map((n) => `ja-JP-Chirp3-HD-${n}`);

/** A scenario's speakers, in order of first appearance in its script. */
export function speakersOf(dialogue: { speaker: string }[] | undefined): string[] {
  return [...new Set((dialogue ?? []).map((l) => l.speaker).filter(Boolean))];
}

/** Each speaker's voice: the saved choice, else a default by order of appearance. */
export function scenarioVoices(dialogue: { speaker: string }[] | undefined, saved?: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    speakersOf(dialogue).map((s, i) => [s, saved?.[s] ?? SPEAKER_DEFAULTS[i % SPEAKER_DEFAULTS.length]]),
  );
}
