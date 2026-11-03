"use client";

import { useEffect, useRef, useState } from "react";
import { fetchChoices, pictureUrl, shuffle, type PictureRef } from "@/lib/pictures";

interface Props {
  kuId: string;
  /** Spoken form (TTS input). No Japanese is ever shown on this card. */
  reading: string;
  /** English meaning, revealed after the pick. */
  meaning?: string;
  /** The word's approved pictures (one per usage); one is chosen at random as the answer. */
  pictures: PictureRef[];
  onSpeak: (text: string) => void;
  /** Omitted in practice mode (end-of-lesson quick check): nothing is recorded. */
  onResult?: (result: "pass" | "fail") => Promise<void> | void;
  onAdvance: () => void;
  /** "dark" on the review screen, "paper" in Start Learning. */
  tone?: "dark" | "paper";
}

/**
 * Audio-first vocab (#246): hear the word, pick its picture from four. Every round also
 * re-pairs sound and image (the right picture is highlighted and the word replays), so
 * the card is reinforcement as much as a test.
 */
export default function PictureChoiceCard({ kuId, reading, meaning, pictures, onSpeak, onResult, onAdvance, tone = "dark" }: Props) {
  const [target] = useState<PictureRef>(() => pictures[Math.floor(Math.random() * pictures.length)]);
  const [options, setOptions] = useState<PictureRef[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Load distractors, then play the word.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one round per mount (the card is keyed by item)
  useEffect(() => {
    let cancelled = false;
    fetchChoices(kuId, 3).then((distractors) => {
      if (cancelled) return;
      setOptions(shuffle([{ ...target, kuId }, ...distractors]));
      onSpeak(reading);
    });
    return () => {
      cancelled = true;
    };
  }, [kuId]);

  useEffect(() => {
    if (picked) setTimeout(() => nextRef.current?.focus(), 50);
  }, [picked]);

  const pick = async (option: PictureRef) => {
    if (picked) return;
    setPicked(option.id);
    onSpeak(reading); // re-pair the sound with the (now highlighted) picture
    await onResult?.(option.id === target.id ? "pass" : "fail");
  };

  // Keyboard: 1–4 to pick, Enter for next once picked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!options || picked) return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) pick(options[n - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const correct = picked === target.id;
  const text = tone === "dark" ? "text-gray-200" : "text-shodo-ink";
  const subtle = tone === "dark" ? "text-gray-400" : "text-shodo-ink-faint";

  return (
    <div className={`flex flex-col items-center gap-5 ${text}`}>
      <div className="flex items-center gap-3">
        <span className={`text-sm ${subtle}`}>Which picture is this word?</span>
        <button
          type="button"
          onClick={() => onSpeak(reading)}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold active:scale-95 transition-transform"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4.018 14L14.41 9 4.018 4v10z" />
          </svg>
          Play again
        </button>
      </div>

      {!options ? (
        <p className={`text-sm ${subtle}`}>Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 w-full max-w-xl">
          {options.map((option, i) => {
            const isTarget = option.id === target.id;
            const isPicked = option.id === picked;
            const ring = !picked
              ? "ring-2 ring-transparent hover:ring-blue-400"
              : isTarget
                ? "ring-4 ring-green-500"
                : isPicked
                  ? "ring-4 ring-red-500 opacity-60"
                  : "opacity-40";
            return (
              <button
                key={option.id}
                type="button"
                disabled={!!picked}
                onClick={() => pick(option)}
                aria-label={`Picture ${i + 1}`}
                className={`relative rounded-xl overflow-hidden bg-[#f9f7f2] transition ${ring}`}
              >
                {/* biome-ignore lint/performance/noImgElement: backend-served card images */}
                <img src={pictureUrl(option)} alt="" className="w-full aspect-square object-cover" />
                <span className="absolute top-1.5 left-2 text-xs font-semibold text-gray-500">{i + 1}</span>
              </button>
            );
          })}
        </div>
      )}

      {picked && (
        <div className="flex flex-col items-center gap-3">
          <p className={`text-lg font-semibold ${correct ? "text-green-500" : "text-red-400"}`}>
            {correct ? "Correct" : "Not quite: it's the highlighted picture"}
          </p>
          {meaning && <p className={`text-sm ${subtle}`}>{meaning}</p>}
          <button
            ref={nextRef}
            type="button"
            onClick={onAdvance}
            className={`px-6 py-2.5 rounded-lg font-semibold ${tone === "dark" ? "bg-gray-200 text-gray-900" : "bg-shodo-ink text-shodo-paper"}`}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
