"use client";

import { useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { VocabLesson, KanjiLesson, GrammarLesson, Lesson } from "@/types";
import { apiFetch } from "@/lib/api-client";
import { normalizeFormation } from "@/lib/grammar-lesson";
import { FuriganaText } from "@/components/FuriganaText";
import GrammarPatternDisplay from "@/components/lessons/GrammarPatternDisplay";

export interface QueueItem {
  kuId: string;
  content: string;
  type: string;
}

export interface LoadedItem {
  item: QueueItem;
  lesson: Lesson;
}

export function slideCount(loaded: LoadedItem): number {
  const { item, lesson } = loaded;
  if (item.type === "Vocab" && lesson.type === "Vocab") {
    const vl = lesson as VocabLesson;
    const hasKanji = !vl.kanaOnly && (vl.component_kanji?.length ?? 0) > 0;
    return 3 + (hasKanji ? 1 : 0) + ((vl.context_examples?.length ?? 0) > 0 ? 1 : 0);
  }
  if (item.type === "Kanji") return 4;
  if (item.type === "Grammar" && lesson.type === "Grammar") {
    const gl = lesson as GrammarLesson;
    return 2 + (gl.notes ? 1 : 0) + (gl.examples?.length ?? 0);
  }
  return 1;
}

const LESSON_TIMEOUT_MS = 75_000;

export async function fetchLesson(item: QueueItem, signal: AbortSignal): Promise<Lesson> {
  if (item.type === "Kanji") {
    const res = await apiFetch(
      `/api/kanji/details?char=${encodeURIComponent(item.content)}&kuId=${item.kuId}`,
      { signal },
    );
    if (!res.ok) throw new Error("Failed to fetch kanji lesson");
    return res.json();
  }
  const res = await apiFetch("/api/lessons/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kuId: item.kuId }),
    signal,
  });
  if (!res.ok) throw new Error("Failed to generate lesson");
  return res.json();
}

export async function fetchLessonWithRetry(item: QueueItem): Promise<Lesson> {
  try {
    return await fetchLesson(item, AbortSignal.timeout(LESSON_TIMEOUT_MS));
  } catch (e) {
    console.warn(`[lesson-slides] lesson fetch failed for ${item.content}, retrying…`, e);
    return await fetchLesson(item, AbortSignal.timeout(LESSON_TIMEOUT_MS));
  }
}

// ─── Audio ──────────────────────────────────────────────────────────────────

export function useLessonAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCache = useRef<Record<string, string>>({});

  const playAudio = useCallback(async (text: string) => {
    if (audioCache.current[text]) {
      if (audioRef.current) { audioRef.current.src = audioCache.current[text]; audioRef.current.play(); }
      return;
    }
    try {
      const res = await apiFetch("/api/audio/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        audioCache.current[text] = url;
        if (audioRef.current) { audioRef.current.src = url; audioRef.current.play(); }
      }
    } catch { /* non-critical */ }
  }, []);

  return { audioRef, playAudio };
}

// ─── Slide renderers ────────────────────────────────────────────────────────

function VocabWordSlide({ loaded, onAudio }: { loaded: LoadedItem; onAudio: (text: string) => void }) {
  const vl = loaded.lesson as VocabLesson;
  useEffect(() => { onAudio(vl.reading); }, []);
  return (
    <div className="w-full flex flex-col items-center justify-center gap-6 text-center">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">New Vocabulary</span>
      <div className="text-8xl font-bold text-shodo-ink leading-none">{loaded.item.content}</div>
      <div className="flex items-center gap-3">
        <span className="text-3xl text-shodo-ink-light">{vl.reading}</span>
        <button
          onClick={() => onAudio(vl.reading)}
          className="text-shodo-ink-faint hover:text-shodo-accent transition-colors"
          title="Play audio"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
        </button>
      </div>
      <span className="text-sm text-shodo-ink-faint capitalize">{(vl.partOfSpeech ?? "").replace(/-/g, " ")}</span>
    </div>
  );
}

function VocabKanjiSlide({ loaded }: { loaded: LoadedItem }) {
  const vl = loaded.lesson as VocabLesson;
  const kanji = vl.component_kanji ?? [];
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">Building Blocks</span>

      <div className="flex justify-center">
        <div className="px-10 py-4 rounded-xl bg-shodo-paper-dark border border-shodo-ink/10">
          <span className="text-5xl font-bold text-shodo-ink">{loaded.item.content}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-shodo-ink/10" />
        <span className="text-xs text-shodo-ink-faint uppercase tracking-widest">made of</span>
        <div className="flex-1 h-px bg-shodo-ink/10" />
      </div>

      <div className="space-y-3">
        {kanji.map((k, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 rounded-lg bg-shodo-paper-dark">
            <span className="text-4xl font-bold text-shodo-stamp-red w-14 text-center shrink-0">{k.kanji}</span>
            <div className="w-px self-stretch bg-shodo-ink/10" />
            <div className="flex flex-col gap-0.5">
              <span className="text-lg text-shodo-ink font-medium">{k.meaning}</span>
              <span className="text-sm text-shodo-ink-faint">{k.reading}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VocabMeaningSlide({ loaded }: { loaded: LoadedItem }) {
  const vl = loaded.lesson as VocabLesson;
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">Meaning</span>
      <div className="text-4xl font-bold text-shodo-ink">{loaded.item.content}</div>
      <p className="text-lg text-shodo-ink-light leading-relaxed">{vl.meaning_explanation}</p>
    </div>
  );
}

function VocabDefinitionsSlide({ loaded }: { loaded: LoadedItem }) {
  const vl = loaded.lesson as VocabLesson;
  const defs = vl.definitions?.length ? vl.definitions : vl.definition ? [vl.definition] : [];
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">Definitions</span>
      <div className="text-4xl font-bold text-shodo-ink">{loaded.item.content}</div>
      <ul className="space-y-3">
        {defs.map((d, i) => (
          <li key={i} className="flex items-start gap-3 text-lg text-shodo-ink-light">
            <span className="text-shodo-ink-faint text-sm mt-1 w-5 shrink-0">{i + 1}.</span>
            {d}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VocabExampleSlide({ loaded }: { loaded: LoadedItem }) {
  const vl = loaded.lesson as VocabLesson;
  const ex = vl.context_examples?.[0];
  if (!ex) return null;
  const stripped = (s: string) => s.replace(/\[[^\]]*\]/g, "").trim();
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">Example</span>
      {/* content is server-generated lesson data, not user input */}
      <p className="text-3xl text-shodo-ink leading-relaxed"><FuriganaText text={ex.sentence} /></p>
      <p className="text-xl text-shodo-ink-light">{stripped(ex.translation)}</p>
    </div>
  );
}

function KanjiCharacterSlide({ loaded }: { loaded: LoadedItem }) {
  const kl = loaded.lesson as KanjiLesson;
  return (
    <div className="w-full flex flex-col items-center justify-center gap-6 text-center">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">New Kanji</span>
      <div className="text-9xl font-bold text-shodo-stamp-red leading-none">{loaded.item.content}</div>
      <div className="text-2xl text-shodo-ink-light">{kl.meaning}</div>
      <div className="text-sm text-shodo-ink-faint">{kl.strokeCount} strokes</div>
    </div>
  );
}

function KanjiExampleWordsSlide({ loaded }: { loaded: LoadedItem }) {
  const kl = loaded.lesson as KanjiLesson;
  const examples = kl.exampleWords ?? [];
  const playExampleAudio = (url?: string) => {
    if (url) new Audio(url).play();
  };
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">Seen In</span>
      <div className="text-5xl font-bold text-shodo-stamp-red">{loaded.item.content}</div>
      {examples.length > 0 ? (
        <ul className="space-y-3">
          {examples.map((ex, i) => (
            <li key={i} className="flex items-center justify-between gap-3">
              <div>
                <span className="text-2xl text-shodo-ink">{ex.japanese}</span>
                <span className="ml-3 text-lg text-shodo-ink-light">{ex.meaning}</span>
              </div>
              {ex.audioUrl && (
                <button
                  onClick={() => playExampleAudio(ex.audioUrl)}
                  className="text-shodo-ink-faint hover:text-shodo-accent transition-colors shrink-0"
                  title="Play audio"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-shodo-ink-faint">No example words found.</p>
      )}
    </div>
  );
}

function KanjiReadingsSlide({ loaded }: { loaded: LoadedItem }) {
  const kl = loaded.lesson as KanjiLesson;
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">Readings</span>
      <div className="text-5xl font-bold text-shodo-stamp-red">{loaded.item.content}</div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-shodo-ink-faint mb-2">On'yomi</div>
          <div className="text-xl text-shodo-ink">{kl.onyomi.join("、") || "—"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-shodo-ink-faint mb-2">Kun'yomi</div>
          <div className="text-xl text-shodo-ink">{kl.kunyomi.join("、") || "—"}</div>
        </div>
      </div>
      {kl.mnemonic_reading && (
        <p className="text-lg text-shodo-ink-light leading-relaxed">{kl.mnemonic_reading}</p>
      )}
    </div>
  );
}

function KanjiVocabSlide({ loaded }: { loaded: LoadedItem }) {
  const kl = loaded.lesson as KanjiLesson;
  const vocab = kl.relatedVocab?.slice(0, 4) ?? [];
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">Used in Words</span>
      <div className="text-5xl font-bold text-shodo-stamp-red">{loaded.item.content}</div>
      {vocab.length > 0 ? (
        <ul className="space-y-3">
          {vocab.map((v, i) => (
            <li key={i} className="flex items-baseline gap-3">
              <span className="text-2xl text-shodo-ink">{v.content}</span>
              <span className="text-lg text-shodo-ink-light">{v.reading}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-shodo-ink-faint">No related vocabulary found.</p>
      )}
    </div>
  );
}

function GrammarPatternSlide({ loaded }: { loaded: LoadedItem }) {
  const gl = loaded.lesson as GrammarLesson;
  return (
    <div className="w-full flex flex-col items-center justify-center gap-6 text-center max-w-2xl mx-auto">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">Grammar Pattern</span>
      <GrammarPatternDisplay pattern={gl.pattern} className="text-5xl font-bold text-shodo-matcha leading-snug" />
      <div className="text-2xl text-shodo-ink-light">{gl.title}</div>
      <div className="text-sm text-shodo-ink-faint">{gl.jlptLevel}</div>
    </div>
  );
}

function GrammarMeaningSlide({ loaded }: { loaded: LoadedItem }) {
  const gl = loaded.lesson as GrammarLesson;
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">How it Works</span>
      <GrammarPatternDisplay pattern={gl.pattern} className="text-4xl font-bold text-shodo-matcha text-center" />
      <p className="text-xl text-shodo-ink-light">{gl.meaning}</p>
      <div className="bg-shodo-paper-dark rounded-lg px-4 py-3 border border-shodo-ink/10">
        <div className="text-xs uppercase tracking-widest text-shodo-ink-faint mb-1">Formation</div>
        <div className="flex flex-col gap-1">
          {normalizeFormation(gl.formation).map((f, i) => (
            <div key={i} className="flex gap-2 text-lg text-shodo-ink font-mono">
              <span className="text-shodo-ink-faint select-none">›</span>
              <span>{f}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GrammarExampleSlide({ loaded, exampleIdx }: { loaded: LoadedItem; exampleIdx: number }) {
  const gl = loaded.lesson as GrammarLesson;
  const ex = gl.examples[exampleIdx];
  if (!ex) return null;
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">
          Example {exampleIdx + 1} of {gl.examples.length}
        </span>
        {ex.context && (
          <span className="text-xs text-shodo-ink-faint italic">{ex.context}</span>
        )}
      </div>
      <p className="text-3xl text-shodo-ink leading-relaxed">{ex.japanese}</p>
      <p className="text-xl text-shodo-ink-light mt-2">{ex.english}</p>
    </div>
  );
}

function GrammarNotesSlide({ loaded }: { loaded: LoadedItem }) {
  const gl = loaded.lesson as GrammarLesson;
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">Notes</span>
      <GrammarPatternDisplay pattern={gl.pattern} className="text-4xl font-bold text-shodo-matcha text-center" />
      <div className="flex flex-col gap-3 text-lg text-shodo-ink-light leading-relaxed [&_p]:mb-3 [&_br]:block [&_br]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_strong]:font-semibold [&_strong]:text-shodo-ink [&_a]:underline [&_code]:bg-shodo-ink/5 [&_code]:px-1 [&_code]:rounded [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-shodo-ink [&_h1]:mt-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-shodo-ink [&_h2]:mt-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-shodo-ink [&_h3]:mt-2">
        <ReactMarkdown remarkPlugins={[remarkBreaks]}>{gl.notes.replace(/\\n/g, '\n')}</ReactMarkdown>
      </div>
    </div>
  );
}

export function renderSlide(loaded: LoadedItem, slideIdx: number, onAudio: (text: string) => void) {
  const { item, lesson } = loaded;
  if (item.type === "Vocab" && lesson.type === "Vocab") {
    const vl = lesson as VocabLesson;
    const hasKanji = !vl.kanaOnly && (vl.component_kanji?.length ?? 0) > 0;
    let s = slideIdx;
    if (s === 0) return <VocabWordSlide loaded={loaded} onAudio={onAudio} />;
    s--;
    if (hasKanji) { if (s === 0) return <VocabKanjiSlide loaded={loaded} />; s--; }
    if (s === 0) return <VocabMeaningSlide loaded={loaded} />;
    if (s === 1) return <VocabDefinitionsSlide loaded={loaded} />;
    if (s === 2) return <VocabExampleSlide loaded={loaded} />;
  }
  if (item.type === "Kanji") {
    switch (slideIdx) {
      case 0: return <KanjiCharacterSlide loaded={loaded} />;
      case 1: return <KanjiExampleWordsSlide loaded={loaded} />;
      case 2: return <KanjiReadingsSlide loaded={loaded} />;
      case 3: return <KanjiVocabSlide loaded={loaded} />;
    }
  }
  if (item.type === "Grammar" && lesson.type === "Grammar") {
    const gl = lesson as GrammarLesson;
    let s = slideIdx;
    if (s === 0) return <GrammarPatternSlide loaded={loaded} />;
    s--;
    if (s === 0) return <GrammarMeaningSlide loaded={loaded} />;
    s--;
    if (gl.notes) { if (s === 0) return <GrammarNotesSlide loaded={loaded} />; s--; }
    if (s < gl.examples.length) return <GrammarExampleSlide loaded={loaded} exampleIdx={s} />;
  }
  return null;
}

export const TYPE_COLORS: Record<string, string> = {
  Vocab: "#2E4B75",
  Kanji: "#C0392B",
  Grammar: "#7B8D42",
};
