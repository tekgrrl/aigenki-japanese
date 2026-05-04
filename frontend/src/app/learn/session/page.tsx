"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { VocabLesson, KanjiLesson, GrammarLesson, Lesson } from "@/types";
import { apiFetch } from "@/lib/api-client";

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
    return 3 + ((vl.context_examples?.length ?? 0) > 0 ? 1 : 0);
  }
  if (item.type === "Kanji") return 4;
  if (item.type === "Grammar" && lesson.type === "Grammar") {
    const gl = lesson as GrammarLesson;
    return 3 + (gl.notes ? 1 : 0);
  }
  return 1;
}

async function fetchLesson(item: QueueItem): Promise<Lesson> {
  if (item.type === "Kanji") {
    const res = await apiFetch(
      `/api/kanji/details?char=${encodeURIComponent(item.content)}&kuId=${item.kuId}`,
    );
    if (!res.ok) throw new Error("Failed to fetch kanji lesson");
    return res.json();
  }
  const res = await apiFetch("/api/lessons/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kuId: item.kuId }),
  });
  if (!res.ok) throw new Error("Failed to generate lesson");
  return res.json();
}

async function enrollItem(item: QueueItem, lesson: Lesson): Promise<void> {
  const facetsToCreate: { key: string; data: Record<string, unknown> }[] = [];

  if (lesson.type === "Vocab") {
    const vl = lesson as VocabLesson;
    const base = { content: item.content, reading: vl.reading, definitions: vl.definitions ?? [], topic: item.content };
    const hasReading = vl.reading && vl.reading !== item.content;
    const examples = vl.context_examples ?? [];
    facetsToCreate.push({ key: "Definition-to-Content", data: base });
    facetsToCreate.push({ key: "Content-to-Definition", data: base });
    if (hasReading) facetsToCreate.push({ key: "Content-to-Reading", data: base });
    if (examples.length > 0) {
      facetsToCreate.push({ key: "audio", data: { ...base, contextExample: examples[Math.floor(Math.random() * examples.length)] } });
    }
    facetsToCreate.push({ key: "AI-Generated-Question", data: base });
  } else if (lesson.type === "Kanji") {
    const kl = lesson as KanjiLesson;
    const base = { content: item.content, meaning: kl.meaning, onyomi: kl.onyomi, kunyomi: kl.kunyomi };
    facetsToCreate.push({ key: "Kanji-Component-Meaning", data: base });
    facetsToCreate.push({ key: "Kanji-Component-Reading", data: base });
  } else if (lesson.type === "Grammar") {
    const gl = lesson as GrammarLesson;
    for (const ex of gl.examples) {
      facetsToCreate.push({
        key: "sentence-assembly",
        data: { goalTitle: gl.pattern, fragments: ex.fragments, answer: ex.japanese, english: ex.english, accepted_alternatives: ex.accepted_alternatives ?? [], sourceId: item.kuId, sourceTitle: gl.title },
      });
    }
    facetsToCreate.push({ key: "AI-Generated-Question", data: { content: gl.pattern, topic: gl.title, sourceId: item.kuId, sourceTitle: gl.title } });
    facetsToCreate.push({ key: "Content-to-Definition", data: { content: gl.pattern, definitions: [gl.meaning], topic: gl.title, kuType: "Grammar" } });
  }

  if (facetsToCreate.length === 0) return;
  await apiFetch("/api/reviews/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kuId: item.kuId, facetsToCreate, selfCertifiedFacets: [] }),
  });
}

// ─── Slide renderers ────────────────────────────────────────────────────────

function VocabWordSlide({ loaded, onAudio }: { loaded: LoadedItem; onAudio: (text: string) => void }) {
  const vl = loaded.lesson as VocabLesson;
  useEffect(() => { onAudio(vl.reading); }, []);
  return (
    <div className="flex flex-col items-center justify-center gap-6 text-center">
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m0 0l-3-3m3 3l3-3M6.343 9.657a8 8 0 000 11.314" />
          </svg>
        </button>
      </div>
      <span className="text-sm text-shodo-ink-faint capitalize">{(vl.partOfSpeech ?? "").replace(/-/g, " ")}</span>
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
      <p className="text-3xl text-shodo-ink leading-relaxed">{stripped(ex.sentence)}</p>
      <p className="text-xl text-shodo-ink-light">{stripped(ex.translation)}</p>
    </div>
  );
}

function KanjiCharacterSlide({ loaded }: { loaded: LoadedItem }) {
  const kl = loaded.lesson as KanjiLesson;
  return (
    <div className="flex flex-col items-center justify-center gap-6 text-center">
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
    <div className="flex flex-col items-center justify-center gap-6 text-center">
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
        <div className="text-lg text-shodo-ink font-mono">{gl.formation}</div>
      </div>
    </div>
  );
}

function GrammarExampleSlide({ loaded }: { loaded: LoadedItem }) {
  const gl = loaded.lesson as GrammarLesson;
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">
        {gl.examples.length > 1 ? `Examples (${gl.examples.length})` : "Example"}
      </span>
      <div className="text-4xl font-bold text-shodo-matcha">{gl.pattern}</div>
      <div className="space-y-6">
        {gl.examples.slice(0, 2).map((ex, i) => (
          <div key={i}>
            <p className="text-2xl text-shodo-ink">{ex.japanese}</p>
            <p className="text-lg text-shodo-ink-light mt-1">{ex.english}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function GrammarNotesSlide({ loaded }: { loaded: LoadedItem }) {
  const gl = loaded.lesson as GrammarLesson;
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">Notes</span>
      <div className="text-4xl font-bold text-shodo-matcha">{gl.pattern}</div>
      <p className="text-lg text-shodo-ink-light leading-relaxed">{gl.notes}</p>
    </div>
  );
}

function renderSlide(loaded: LoadedItem, slideIdx: number, onAudio: (text: string) => void) {
  const { item, lesson } = loaded;
  if (item.type === "Vocab" && lesson.type === "Vocab") {
    switch (slideIdx) {
      case 0: return <VocabWordSlide loaded={loaded} onAudio={onAudio} />;
      case 1: return <VocabMeaningSlide loaded={loaded} />;
      case 2: return <VocabDefinitionsSlide loaded={loaded} />;
      case 3: return <VocabExampleSlide loaded={loaded} />;
    }
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
    switch (slideIdx) {
      case 0: return <GrammarPatternSlide loaded={loaded} />;
      case 1: return <GrammarMeaningSlide loaded={loaded} />;
      case 2: return <GrammarExampleSlide loaded={loaded} />;
      case 3: return <GrammarNotesSlide loaded={loaded} />;
    }
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
  const [currentItemIdx, setCurrentItemIdx] = useState(0);
  const [currentSlideIdx, setCurrentSlideIdx] = useState(0);
  const [enrolling, setEnrolling] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCache = useRef<Record<string, string>>({});
  const enrollmentPromises = useRef<Promise<void>[]>([]);

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
    (async () => {
      try {
        const queueRes = await apiFetch("/api/lessons/queue");
        if (!queueRes.ok) throw new Error("Failed to fetch queue");
        const queue: QueueItem[] = await queueRes.json();
        if (queue.length === 0) { setQueueEmpty(true); return; }
        setTotalCount(queue.length);

        const results: LoadedItem[] = [];
        await Promise.all(
          queue.map(async (item) => {
            const lesson = await fetchLesson(item);
            results.push({ item, lesson });
            setLoadedCount(c => c + 1);
          }),
        );
        // preserve queue order
        results.sort((a, b) => queue.findIndex(q => q.kuId === a.item.kuId) - queue.findIndex(q => q.kuId === b.item.kuId));
        setLoadedItems(results);
        setPhase("slideshow");
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const triggerEnrollment = useCallback((loaded: LoadedItem) => {
    enrollmentPromises.current.push(enrollItem(loaded.item, loaded.lesson));
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
    triggerEnrollment(loaded);

    if (!isLastItem) {
      setCurrentItemIdx(i => i + 1);
      setCurrentSlideIdx(0);
      return;
    }
    // Finished all items
    setEnrolling(true);
    await Promise.allSettled(enrollmentPromises.current);
    window.dispatchEvent(new CustomEvent("refreshStats"));
    setEnrolling(false);
    setPhase("complete");
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
  if (queueEmpty) {
    return (
      <main className="min-h-screen bg-shodo-paper flex items-center justify-center p-8">
        <div className="text-center max-w-md">
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
      <main className="min-h-screen bg-shodo-paper flex items-center justify-center p-8">
        <div className="text-center max-w-sm w-full">
          <h1 className="text-2xl font-bold text-shodo-ink mb-2">Preparing your lesson</h1>
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
      <main className="min-h-screen bg-shodo-paper flex flex-col">
        <audio ref={audioRef} />

        {/* Top bar */}
        <div className="px-8 pt-6 pb-4 flex items-center gap-4">
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
          className="flex-1 flex items-center px-8 py-6 animate-in fade-in duration-300"
        >
          {renderSlide(loaded, currentSlideIdx, playAudio)}
        </div>

        {/* Bottom nav */}
        <div className="px-8 pb-8 pt-4 flex items-center gap-4 border-t border-shodo-ink/5">
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
    <main className="min-h-screen bg-shodo-paper flex items-center justify-center p-8">
      {enrolling ? (
        <div className="text-center">
          <p className="text-shodo-ink-light">Saving your progress…</p>
        </div>
      ) : (
        <div className="text-center max-w-md">
          <div className="text-5xl mb-6">✨</div>
          <h1 className="text-3xl font-bold text-shodo-ink mb-2">Lesson complete!</h1>
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
