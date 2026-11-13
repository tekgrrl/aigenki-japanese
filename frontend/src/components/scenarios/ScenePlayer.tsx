"use client";

/**
 * The scenario's play-through: the script, played line by line with audio (Play / Pause / Replay),
 * the current line highlighted. Each line's audio comes from POST /api/audio/speak; the next line
 * is fetched while the current one plays.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { stripFurigana } from "@/lib/furigana";
import type { ScenarioDialogueLine } from "@/types/scenario";

interface Props {
  dialogue: ScenarioDialogueLine[];
  /** The learner's role, so their lines sit on the other side. */
  userRole?: string;
  title?: string;
}

export default function ScenePlayer({ dialogue, userRole, title = "Script" }: Props) {
  const [current, setCurrent] = useState<number | null>(null); // line being played (or paused on)
  const [playing, setPlaying] = useState(false);
  const [showTranslations, setShowTranslations] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<number, Promise<string | null>>()); // line → object URL, fetched once
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const runId = useRef(0); // bumps on pause/replay so a stale playback chain stops

  const urlFor = useCallback((i: number) => {
    if (!urls.current.has(i)) {
      urls.current.set(i, (async () => {
        try {
          const res = await apiFetch("/api/audio/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: stripFurigana(dialogue[i].text) }), // TTS mustn't read the [readings]
          });
          return res.ok ? URL.createObjectURL(await res.blob()) : null;
        } catch {
          return null;
        }
      })());
    }
    return urls.current.get(i)!;
  }, [dialogue]);

  useEffect(() => () => {
    runId.current++;
    audioRef.current?.pause();
    urls.current.forEach(p => p.then(u => u && URL.revokeObjectURL(u)));
  }, []);

  const playFrom = useCallback(async (start: number) => {
    const run = ++runId.current;
    setPlaying(true);
    for (let i = start; i < dialogue.length; i++) {
      setCurrent(i);
      lineRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const url = await urlFor(i);
      if (run !== runId.current) return; // paused, replayed or unmounted while it loaded
      if (i + 1 < dialogue.length) void urlFor(i + 1);
      if (!url) continue; // no audio for this line: move on
      const audio = new Audio(url);
      audioRef.current = audio;
      await new Promise<void>(resolve => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.onpause = () => { if (!audio.ended) resolve(); };
        audio.play().catch(() => resolve());
      });
      if (run !== runId.current) return;
    }
    setPlaying(false);
    setCurrent(null);
  }, [dialogue.length, urlFor]);

  const pause = () => {
    runId.current++;
    audioRef.current?.pause();
    setPlaying(false);
  };

  return (
    <section className="space-y-6">
      <div className="flex justify-between items-center gap-4">
        <h2 className="text-xl font-bold text-slate-800">{title}</h2>
        <div className="flex items-center gap-3">
          {playing ? (
            <button onClick={pause} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded bg-shodo-ink text-shodo-paper">
              <Pause size={14} /> Pause
            </button>
          ) : (
            <button onClick={() => playFrom(current ?? 0)} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded bg-shodo-ink text-shodo-paper">
              <Play size={14} /> {current === null ? "Watch the scene" : "Resume"}
            </button>
          )}
          {current !== null && (
            <button onClick={() => { pause(); playFrom(0); }} title="Start again" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
              <RotateCcw size={14} /> Replay
            </button>
          )}
          <button
            onClick={() => setShowTranslations(!showTranslations)}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            {showTranslations ? "Hide Translations" : "Show Translations"}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {dialogue.map((line, idx) => {
          const isUser = line.speakerRole ? line.speakerRole === "user" : line.speaker === userRole;
          const isCurrent = idx === current;
          return (
            <div
              key={idx}
              ref={el => { lineRefs.current[idx] = el; }}
              onClick={() => { pause(); playFrom(idx); }}
              title="Play from this line"
              className={`p-4 rounded-xl cursor-pointer transition-shadow ${
                isUser ? "bg-indigo-50 border border-indigo-100 ml-12" : "bg-white border border-slate-200 mr-12"
              } ${isCurrent ? "ring-2 ring-shodo-ink shadow-md" : ""}`}
            >
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">{line.speaker}</div>
              <p className="text-lg font-medium text-slate-900 leading-relaxed">{line.text}</p>
              {showTranslations && (
                <p className="text-slate-500 mt-1 text-sm border-t border-slate-100 pt-1">{line.translation}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
