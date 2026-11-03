"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { getEntry, putEntry, historyKey } from "@/lib/pronunciationHistory";

const PAUSE_OPTIONS = [
  { label: "Short", ms: 200 },
  { label: "Medium", ms: 400 },
  { label: "Long", ms: 700 },
];

// Every ja-JP Chirp3-HD voice (confirmed available via listVoices) — mirrors
// CHIRP3_HD_JA_VOICES in backend/src/audio/google-tts.service.ts.
const VOICES = [
  "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede", "Autonoe",
  "Callirrhoe", "Charon", "Despina", "Enceladus", "Erinome", "Fenrir",
  "Gacrux", "Iapetus", "Kore", "Laomedeia", "Leda", "Orus", "Puck",
  "Pulcherrima", "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar",
  "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi",
].map((name) => ({ label: name, id: `ja-JP-Chirp3-HD-${name}` }));

const DEFAULT_VOICE = "ja-JP-Chirp3-HD-Orus";
const VOICE_STORAGE_KEY = "pronounceVoice";

export default function PronouncePage() {
  const [text, setText] = useState("");
  const [pauseMs, setPauseMs] = useState(PAUSE_OPTIONS[1].ms);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [clearLoading, setClearLoading] = useState(false);
  const [pacedLoading, setPacedLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { playBlob } = useAudioPlayer();

  // Read the saved voice preference after mount, not in the initial state,
  // so server and client render the same thing on first paint (matches the
  // loadFurigana()-in-useEffect pattern in AvatarMenu.tsx).
  useEffect(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(VOICE_STORAGE_KEY) : null;
    if (saved) setVoice(saved);
  }, []);

  const handleVoiceChange = (next: string) => {
    setVoice(next);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(VOICE_STORAGE_KEY, next);
    }
  };

  const speak = async (mode: "clear" | "paced") => {
    const trimmedText = text.trim();
    if (!trimmedText) return;
    setError(null);
    const setLoading = mode === "clear" ? setClearLoading : setPacedLoading;

    const key = historyKey(trimmedText, mode, pauseMs, voice);
    const cached = await getEntry(key);
    if (cached) {
      setNote(cached.note);
      await playBlob(new Blob([cached.audioBuffer], { type: cached.mimeType }));
      return;
    }

    setNote(null);
    setLoading(true);

    try {
      const res = await apiFetch("/api/audio/pronounce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "clear"
            ? { text: trimmedText, mode, voice }
            : { text: trimmedText, mode, pauseMs, voice },
        ),
      });

      if (!res.ok) {
        throw new Error(`Server responded ${res.status}`);
      }

      const voiceUsed = res.headers.get("X-Pronounce-Voice");
      const segmentation = res.headers.get("X-Pronounce-Segmentation");

      const notes: string[] = [];
      if (voiceUsed && voiceUsed !== voice) {
        notes.push("used the standard voice (chosen voice was unavailable)");
      }
      if (mode === "paced" && segmentation === "punctuation") {
        notes.push("paused at punctuation only, not word-by-word");
      } else if (mode === "paced" && segmentation === "none") {
        notes.push("couldn't segment this sentence, played without pauses");
      }
      const note = notes.length > 0 ? notes.join("; ") : null;
      setNote(note);

      const blob = await res.blob();
      await playBlob(blob);

      // Fire-and-forget: persistence must never delay or block playback.
      blob.arrayBuffer().then((audioBuffer) => {
        putEntry({
          key,
          text: trimmedText,
          mode,
          pauseMs: mode === "paced" ? pauseMs : undefined,
          voice,
          audioBuffer,
          mimeType: blob.type || "audio/mpeg",
          note,
          voiceUsed,
          createdAt: Date.now(),
        });
      });
    } catch (err) {
      console.error("Pronunciation playback failed", err);
      setError("Couldn't generate audio for that sentence. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="container mx-auto max-w-2xl p-8">
      <header className="mb-8 border-b border-shodo-ink/10 pb-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-4xl font-bold text-shodo-stamp-red mb-2">
            Pronunciation
          </h1>
          <Link
            href="/pronounce/history"
            className="text-sm text-shodo-ink/60 hover:text-shodo-ink transition-colors"
          >
            View history →
          </Link>
        </div>
        <p className="text-xl text-shodo-ink-light">
          Paste or type a Japanese sentence and hear it read clearly.
        </p>
      </header>

      <div className="mb-3 flex items-center gap-2">
        <label htmlFor="voice-select" className="text-sm text-shodo-ink/50">
          Voice
        </label>
        <select
          id="voice-select"
          value={voice}
          onChange={(e) => handleVoiceChange(e.target.value)}
          className="text-sm border border-shodo-ink/20 rounded-md px-2 py-1.5 bg-shodo-paper text-shodo-ink focus:outline-none focus:ring-2 focus:ring-shodo-accent"
        >
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="今日はいい天気ですね"
        rows={4}
        maxLength={500}
        className="w-full p-4 bg-shodo-paper border-2 border-shodo-ink/20 text-shodo-ink text-xl rounded-md focus:outline-none focus:ring-2 focus:ring-shodo-accent focus:border-shodo-accent"
      />

      <button
        onClick={() => speak("clear")}
        disabled={!text.trim() || clearLoading}
        className="mt-4 px-6 py-3 bg-shodo-ink text-shodo-paper rounded-lg font-semibold hover:bg-shodo-ink-light transition-colors disabled:opacity-40"
      >
        {clearLoading ? "Generating…" : "Play clearly"}
      </button>

      <div className="mt-8 pt-6 border-t border-shodo-ink/10">
        <p className="text-sm text-shodo-ink/50 mb-3">
          Experimental — replay with pauses between words, to see if it helps.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={pauseMs}
            onChange={(e) => setPauseMs(Number(e.target.value))}
            className="text-sm border border-shodo-ink/20 rounded-md px-2 py-1.5 bg-shodo-paper text-shodo-ink focus:outline-none focus:ring-2 focus:ring-shodo-accent"
          >
            {PAUSE_OPTIONS.map((opt) => (
              <option key={opt.ms} value={opt.ms}>
                {opt.label} pauses
              </option>
            ))}
          </select>
          <button
            onClick={() => speak("paced")}
            disabled={!text.trim() || pacedLoading}
            className="px-4 py-2 border border-shodo-ink/15 text-shodo-ink/60 rounded-lg text-sm font-medium hover:bg-shodo-ink/5 transition-colors disabled:opacity-40"
          >
            {pacedLoading ? "Generating…" : "Play with pauses"}
          </button>
        </div>
      </div>

      {note && <p className="mt-4 text-sm text-shodo-ink/50">{note}</p>}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </main>
  );
}
