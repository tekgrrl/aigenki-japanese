"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { VocabLesson, KanjiLesson, GrammarLesson, Lesson } from "@/types";
import { apiFetch } from "@/lib/api-client";
import { FuriganaText } from "@/components/FuriganaText";

interface QueueItem {
  kuId: string;
  content: string;
  type: string;
}

interface LoadedItem {
  item: QueueItem;
  lesson: Lesson;
}

type Phase = "loading" | "slideshow" | "complete";

function slideCount(loaded: LoadedItem): number {
  const { item, lesson } = loaded;
  if (item.type === "Vocab" && lesson.type === "Vocab") {
    const vl = lesson as VocabLesson;
    const hasKanji = (vl.component_kanji?.length ?? 0) > 0;
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

async function fetchLesson(item: QueueItem, signal: AbortSignal): Promise<Lesson> {
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

async function fetchLessonWithRetry(item: QueueItem): Promise<Lesson> {
  try {
    return await fetchLesson(item, AbortSignal.timeout(LESSON_TIMEOUT_MS));
  } catch (e) {
    console.warn(`[session] lesson fetch failed for ${item.content}, retrying…`, e);
    return await fetchLesson(item, AbortSignal.timeout(LESSON_TIMEOUT_MS));
  }
}

async function enrollItem(item: QueueItem): Promise<void> {
  await apiFetch("/api/reviews/initialize-sequence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kuId: item.kuId }),
  });
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

      {/* The word — framed and centred so it reads as the subject */}
      <div className="flex justify-center">
        <div className="px-10 py-4 rounded-xl bg-shodo-paper-dark border border-shodo-ink/10">
          <span className="text-5xl font-bold text-shodo-ink">{loaded.item.content}</span>
        </div>
      </div>

      {/* Visual connector */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-shodo-ink/10" />
        <span className="text-xs text-shodo-ink-faint uppercase tracking-widest">made of</span>
        <div className="flex-1 h-px bg-shodo-ink/10" />
      </div>

      {/* Component kanji — each in its own card */}
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

function KanjiMnemonicMeaningSlide({ loaded }: { loaded: LoadedItem }) {
  const kl = loaded.lesson as KanjiLesson;
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">Remember the Meaning</span>
      <div className="text-5xl font-bold text-shodo-stamp-red">{loaded.item.content}</div>
      <p className="text-lg text-shodo-ink-light leading-relaxed">{kl.mnemonic_meaning}</p>
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
    <div className="w-full flex flex-col items-center justify-center gap-6 text-center">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">Grammar Pattern</span>
      <div className="text-5xl font-bold text-shodo-matcha leading-snug">{gl.pattern}</div>
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
      <div className="text-4xl font-bold text-shodo-matcha">{gl.pattern}</div>
      <p className="text-xl text-shodo-ink-light">{gl.meaning}</p>
      <div className="bg-shodo-paper-dark rounded-lg px-4 py-3 border border-shodo-ink/10">
        <div className="text-xs uppercase tracking-widest text-shodo-ink-faint mb-1">Formation</div>
        <div className="flex flex-col gap-1">
          {(Array.isArray(gl.formation) ? gl.formation : [gl.formation]).map((f, i) => (
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
  const paragraphs = gl.notes.replace(/\\n/g, '\n').split(/\n\n+/);
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">Notes</span>
      <div className="text-4xl font-bold text-shodo-matcha">{gl.pattern}</div>
      <div className="flex flex-col gap-3">
        {paragraphs.map((para, i) => (
          <p key={i} className="text-lg text-shodo-ink-light leading-relaxed">{para}</p>
        ))}
      </div>
    </div>
  );
}

function renderSlide(loaded: LoadedItem, slideIdx: number, onAudio: (text: string) => void) {
  const { item, lesson } = loaded;
  if (item.type === "Vocab" && lesson.type === "Vocab") {
    const vl = lesson as VocabLesson;
    const hasKanji = (vl.component_kanji?.length ?? 0) > 0;
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
      case 1: return <KanjiMnemonicMeaningSlide loaded={loaded} />;
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

const TYPE_COLORS: Record<string, string> = {
  Vocab: "#2E4B75",
  Kanji: "#C0392B",
  Grammar: "#7B8D42",
};

// ─── Main component ──────────────────────────────────────────────────────────

export default function LessonSessionPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadedItems, setLoadedItems] = useState<LoadedItem[]>([]);
  const [loadedCount, setLoadedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [queueEmpty, setQueueEmpty] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [currentItemIdx, setCurrentItemIdx] = useState(0);
  const [currentSlideIdx, setCurrentSlideIdx] = useState(0);
  const [enrolling, setEnrolling] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCache = useRef<Record<string, string>>({});
  const enrollmentPromises = useRef<Promise<void>[]>([]);
  const fetchRef = useRef(false);

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

  // Load queue and generate all lessons upfront
  useEffect(() => {
    if (fetchRef.current) return;
    fetchRef.current = true;
    (async () => {
      try {
        const queueRes = await apiFetch("/api/lessons/queue");
        if (!queueRes.ok) throw new Error("Failed to fetch queue");
        const queue: QueueItem[] = await queueRes.json();
        if (queue.length === 0) { setQueueEmpty(true); return; }
        setTotalCount(queue.length);

        const results: LoadedItem[] = [];
        for (const item of queue) {
          try {
            const lesson = await fetchLessonWithRetry(item);
            results.push({ item, lesson });
          } catch (e) {
            console.error(`[session] skipping ${item.content} after retry:`, e);
          }
          setLoadedCount(c => c + 1);
        }
        if (results.length === 0) { setLoadError(true); return; }
        setLoadedItems(results);
        setPhase("slideshow");
      } catch (e) {
        console.error(e);
        setLoadError(true);
      }
    })();
  }, []);

  const triggerEnrollment = useCallback((item: QueueItem) => {
    enrollmentPromises.current.push(enrollItem(item));
  }, []);

  const advance = useCallback(async () => {
    const loaded = loadedItems[currentItemIdx];
    const slides = slideCount(loaded);
    const isLastSlide = currentSlideIdx >= slides - 1;
    const isLastItem = currentItemIdx >= loadedItems.length - 1;

    if (!isLastSlide) {
      setCurrentSlideIdx(s => s + 1);
      return;
    }
    // Finished this item — enroll it
    triggerEnrollment(loaded.item);

    if (!isLastItem) {
      setCurrentItemIdx(i => i + 1);
      setCurrentSlideIdx(0);
      return;
    }
    // Finished all items — switch screens immediately, save in background
    setEnrolling(true);
    setPhase("complete");
    await Promise.allSettled(enrollmentPromises.current);
    window.dispatchEvent(new CustomEvent("refreshStats"));
    setEnrolling(false);
  }, [currentItemIdx, currentSlideIdx, loadedItems, triggerEnrollment]);

  const retreat = useCallback(() => {
    if (currentSlideIdx > 0) { setCurrentSlideIdx(s => s - 1); return; }
    if (currentItemIdx > 0) {
      const prevIdx = currentItemIdx - 1;
      setCurrentItemIdx(prevIdx);
      setCurrentSlideIdx(slideCount(loadedItems[prevIdx]) - 1);
    }
  }, [currentItemIdx, currentSlideIdx, loadedItems]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phase !== "slideshow") return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") { e.preventDefault(); advance(); }
      if (e.key === "ArrowLeft") retreat();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, advance, retreat]);

  // ─── Loading phase ────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <main className="container mx-auto max-w-2xl p-8">
        <div>
          <h1 className="text-2xl font-bold text-shodo-ink mb-3">Could not load lessons</h1>
          <p className="text-shodo-ink-light mb-8">All lesson generations failed or timed out. Check the backend logs, then try again.</p>
          <button onClick={() => router.push("/learn")} className="px-6 py-3 bg-shodo-ink text-shodo-paper rounded-lg font-semibold hover:bg-shodo-ink-light transition-colors">
            Back
          </button>
        </div>
      </main>
    );
  }

  if (queueEmpty) {
    return (
      <main className="container mx-auto max-w-2xl p-8">
        <div>
          <div className="text-5xl mb-6">🎉</div>
          <h1 className="text-3xl font-bold text-shodo-ink mb-3">All caught up!</h1>
          <p className="text-shodo-ink-light mb-8">No new items available at your current level. Check back after reviewing what you have.</p>
          <button onClick={() => router.push("/")} className="px-6 py-3 bg-shodo-ink text-shodo-paper rounded-lg font-semibold hover:bg-shodo-ink-light transition-colors">
            Back to Dashboard
          </button>
        </div>
      </main>
    );
  }

  if (phase === "loading") {
    return (
      <main className="container mx-auto max-w-2xl p-8">
        <div>
          <h1 className="text-2xl font-bold text-shodo-ink mb-2">Preparing your Lessons</h1>
          <p className="text-shodo-ink-faint mb-8 text-sm">
            {totalCount === 0 ? "Finding items…" : `Generating ${loadedCount} of ${totalCount}`}
          </p>
          <div className="w-full bg-shodo-paper-dark rounded-full h-2 overflow-hidden">
            <div
              className="h-2 bg-shodo-accent rounded-full transition-all duration-500"
              style={{ width: totalCount > 0 ? `${(loadedCount / totalCount) * 100}%` : "0%" }}
            />
          </div>
        </div>
      </main>
    );
  }

  // ─── Slideshow phase ──────────────────────────────────────────────────────
  if (phase === "slideshow") {
    const loaded = loadedItems[currentItemIdx];
    const slides = slideCount(loaded);
    const isLastSlide = currentSlideIdx >= slides - 1;
    const isLastItem = currentItemIdx >= loadedItems.length - 1;
    const typeColor = TYPE_COLORS[loaded.item.type] ?? "#595048";

    return (
      <main className="container mx-auto max-w-2xl p-8">
        <audio ref={audioRef} />

        {/* Progress bar */}
        <div className="flex items-center gap-4 mb-8">
          <div className="flex items-center gap-1.5">
            {loadedItems.map((_, i) => (
              <div
                key={i}
                className="h-2 rounded-full transition-all duration-300"
                style={{
                  width: i === currentItemIdx ? "2rem" : "0.5rem",
                  backgroundColor: i <= currentItemIdx ? typeColor : "#D1CBC3",
                }}
              />
            ))}
          </div>
          <span className="text-sm text-shodo-ink-faint ml-auto">
            Item {currentItemIdx + 1} of {loadedItems.length}
          </span>
          <span
            className="text-xs font-semibold px-2 py-1 rounded-full text-white"
            style={{ backgroundColor: typeColor }}
          >
            {loaded.item.type}
          </span>
        </div>

        {/* Slide content */}
        <div
          key={`${currentItemIdx}-${currentSlideIdx}`}
          className="min-h-[400px] rounded-xl border p-8 animate-in fade-in duration-300"
          style={{
            backgroundColor: `${typeColor}0d`,
            borderColor: `${typeColor}33`,
          }}
        >
          {renderSlide(loaded, currentSlideIdx, playAudio)}
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-4 mt-8 pt-6 border-t border-shodo-ink/10">
          <button
            onClick={retreat}
            disabled={currentItemIdx === 0 && currentSlideIdx === 0}
            className="px-5 py-2.5 rounded-lg border border-shodo-ink/20 text-shodo-ink-light font-medium hover:bg-shodo-paper-dark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Back
          </button>

          <div className="flex-1 flex justify-center gap-1.5">
            {Array.from({ length: slides }).map((_, i) => (
              <div
                key={i}
                className="h-1.5 w-1.5 rounded-full transition-colors"
                style={{ backgroundColor: i === currentSlideIdx ? typeColor : "#D1CBC3" }}
              />
            ))}
          </div>

          <button
            onClick={advance}
            className="px-6 py-2.5 rounded-lg text-white font-semibold transition-colors"
            style={{ backgroundColor: typeColor }}
          >
            {isLastSlide && isLastItem ? "Finish" : isLastSlide ? "Next Item →" : "Next →"}
          </button>
        </div>
      </main>
    );
  }

  // ─── Complete phase ───────────────────────────────────────────────────────
  return (
    <main className="container mx-auto max-w-2xl p-8">
      {enrolling ? (
        <div>
          <p className="text-shodo-ink-light">Saving your progress…</p>
        </div>
      ) : (
        <div>
          <div className="text-5xl mb-6">✨</div>
          <h1 className="text-3xl font-bold text-shodo-ink mb-2">Lessons Complete</h1>
          <p className="text-shodo-ink-light mb-2">
            You studied {loadedItems.length} {loadedItems.length === 1 ? "item" : "items"}.
          </p>
          <div className="flex flex-wrap justify-center gap-2 mb-8 mt-4">
            {loadedItems.map(({ item }) => (
              <span
                key={item.kuId}
                className="text-xl px-3 py-1.5 rounded-lg text-white font-medium"
                style={{ backgroundColor: TYPE_COLORS[item.type] ?? "#595048" }}
              >
                {item.content}
              </span>
            ))}
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => router.push("/review")}
              className="px-6 py-3 bg-shodo-ink text-shodo-paper rounded-lg font-semibold hover:bg-shodo-ink-light transition-colors"
            >
              Start Review
            </button>
            <button
              onClick={() => router.push("/")}
              className="px-6 py-3 border border-shodo-ink/20 text-shodo-ink rounded-lg font-medium hover:bg-shodo-paper-dark transition-colors"
            >
              Dashboard
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
