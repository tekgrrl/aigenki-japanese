"use client";

/**
 * The scenario's Voices panel: one row per speaker, with a voice dropdown and a ▶ that plays the
 * speaker's first line in that voice. The page saves a change straight away (PUT /scenarios/:id/voices).
 */
import { Volume2 } from "lucide-react";
import { VOICES } from "@/lib/voices";

interface Props {
  /** Speakers in order of first appearance, with each one's current voice. */
  voices: Record<string, string>;
  onChange: (speaker: string, voice: string) => void;
  onSample: (speaker: string) => void;
  /** Shown under the rows when a save failed. */
  error?: string | null;
}

export default function ScenarioVoices({ voices, onChange, onSample, error }: Props) {
  const speakers = Object.keys(voices);
  if (speakers.length === 0) return null;
  return (
    <details className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-medium text-slate-700">Voices</summary>
      <div className="mt-3 space-y-2">
        {speakers.map((speaker) => (
          <div key={speaker} className="flex items-center gap-3">
            <span className="w-40 truncate text-sm font-medium text-slate-700" title={speaker}>{speaker}</span>
            <select
              value={voices[speaker]}
              onChange={(e) => onChange(speaker, e.target.value)}
              className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
            >
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>{v.label} ({v.gender})</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onSample(speaker)}
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              title={`Play ${speaker}'s first line`}
            >
              <Volume2 size={16} />
            </button>
          </div>
        ))}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </details>
  );
}
