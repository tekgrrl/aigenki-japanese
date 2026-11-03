"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import {
  QueueItem,
  LoadedItem,
  slideCount,
  renderSlide,
  fetchLessonWithRetry,
  useLessonAudio,
  TYPE_COLORS,
  isAudioFirst,
} from "@/components/learn/LessonSlides";
import PictureChoiceCard from "@/components/review/PictureChoiceCard";
import { fetchApprovedPictures, shuffle } from "@/lib/pictures";
import type { VocabLesson } from "@/types";

type Phase = "loading" | "slideshow" | "check" | "complete";

/** Day-one reinforcement: each audio-first word twice, interleaved, no back-to-back repeats. */
function buildCheckRounds(items: LoadedItem[]): LoadedItem[] {
  if (items.length === 0) return [];
  const first = shuffle(items);
  let second = shuffle(items);
  if (items.length > 1 && second[0].item.kuId === first[first.length - 1].item.kuId) second = [...second.slice(1), second[0]];
  return [...first, ...second];
}

async function enrollItem(item: QueueItem, alreadyKnown = false): Promise<void> {
  await apiFetch("/api/reviews/initialize-sequence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kuId: item.kuId, alreadyKnown }),
  });
}

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
  const [checkRounds, setCheckRounds] = useState<LoadedItem[]>([]);
  const [checkIdx, setCheckIdx] = useState(0);
  // Audio-first words finished normally this session (not "already know this").
  const learnedAudioFirst = useRef<LoadedItem[]>([]);

  const { audioRef, playAudio } = useLessonAudio();
  const enrollmentPromises = useRef<Promise<void>[]>([]);
  const fetchRef = useRef(false);

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

        // Audio-first experiment: Vocab with approved pictures is taught by picture + sound.
        const me = await apiFetch("/api/users/me").then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const audioFirst = me?.preferences?.audioFirstExperiment === true;

        const results: LoadedItem[] = [];
        for (const item of queue) {
          try {
            const lesson = await fetchLessonWithRetry(item);
            const pictures = audioFirst && item.type === "Vocab" ? await fetchApprovedPictures(item.kuId) : [];
            results.push({ item, lesson, ...(pictures.length ? { pictures } : {}) });
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

  const triggerEnrollment = useCallback((item: QueueItem, alreadyKnown = false) => {
    enrollmentPromises.current.push(enrollItem(item, alreadyKnown));
  }, []);

  // Shared by both "finished the slides normally" and "I already know this" —
  // both end the current item and move on, differing only in the SRS starting point.
  const finishItem = useCallback(async (alreadyKnown: boolean) => {
    const loaded = loadedItems[currentItemIdx];
    triggerEnrollment(loaded.item, alreadyKnown);
    if (!alreadyKnown && isAudioFirst(loaded)) learnedAudioFirst.current.push(loaded);
    const isLastItem = currentItemIdx >= loadedItems.length - 1;

    if (!isLastItem) {
      setCurrentItemIdx(i => i + 1);
      setCurrentSlideIdx(0);
      return;
    }
    // Finished all items — switch screens immediately, save in background. Audio-first
    // words get a quick picture check first (practice: nothing is recorded).
    setEnrolling(true);
    const rounds = buildCheckRounds(learnedAudioFirst.current);
    setCheckRounds(rounds);
    setCheckIdx(0);
    setPhase(rounds.length > 0 ? "check" : "complete");
    await Promise.allSettled(enrollmentPromises.current);
    window.dispatchEvent(new CustomEvent("refreshStats"));
    setEnrolling(false);
  }, [currentItemIdx, loadedItems, triggerEnrollment]);

  const advance = useCallback(() => {
    const loaded = loadedItems[currentItemIdx];
    const slides = slideCount(loaded);
    const isLastSlide = currentSlideIdx >= slides - 1;

    if (!isLastSlide) {
      setCurrentSlideIdx(s => s + 1);
      return;
    }
    finishItem(false);
  }, [currentItemIdx, currentSlideIdx, loadedItems, finishItem]);

  const markKnown = useCallback(() => {
    finishItem(true);
  }, [finishItem]);

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
    const typeColor = TYPE_COLORS[loaded.item.type] ?? "var(--shodo-ink-light)";

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
                  backgroundColor: i <= currentItemIdx ? typeColor : "color-mix(in srgb, var(--shodo-ink) 20%, transparent)",
                }}
              />
            ))}
          </div>
          <span className="text-sm text-shodo-ink-faint ml-auto">
            Item {currentItemIdx + 1} of {loadedItems.length}
          </span>
          <span
            className="text-xs font-semibold px-2 py-1 rounded-full text-shodo-paper"
            style={{ backgroundColor: typeColor }}
          >
            {loaded.item.type}
          </span>
        </div>

        <div className="flex justify-end -mt-4 mb-4">
          <button
            onClick={markKnown}
            className="text-xs text-shodo-ink-faint hover:text-shodo-ink underline decoration-dotted underline-offset-2 transition-colors"
          >
            Already know this? Skip ahead →
          </button>
        </div>

        {/* Slide content */}
        <div
          key={`${currentItemIdx}-${currentSlideIdx}`}
          className="min-h-[400px] rounded-xl border p-8 animate-in fade-in duration-300"
          style={{
            backgroundColor: `color-mix(in srgb, ${typeColor} 5%, transparent)`,
            borderColor: `color-mix(in srgb, ${typeColor} 20%, transparent)`,
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
                style={{ backgroundColor: i === currentSlideIdx ? typeColor : "color-mix(in srgb, var(--shodo-ink) 20%, transparent)" }}
              />
            ))}
          </div>

          <button
            onClick={advance}
            className="px-6 py-2.5 rounded-lg text-shodo-paper font-semibold transition-colors"
            style={{ backgroundColor: typeColor }}
          >
            {isLastSlide && isLastItem ? "Finish" : isLastSlide ? "Next Item →" : "Next →"}
          </button>
        </div>
      </main>
    );
  }

  // ─── Quick check (audio-first words) ──────────────────────────────────────
  if (phase === "check") {
    const round = checkRounds[checkIdx];
    const vl = round.lesson as VocabLesson;
    return (
      <main className="container mx-auto max-w-2xl p-8">
        {/* biome-ignore lint/a11y/useMediaCaption: hidden TTS playback element, nothing to caption */}
        <audio ref={audioRef} />
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-shodo-ink">Quick check</h1>
          <span className="text-sm text-shodo-ink-faint">
            {checkIdx + 1} of {checkRounds.length}
          </span>
        </div>
        <PictureChoiceCard
          key={checkIdx}
          kuId={round.item.kuId}
          reading={vl.reading}
          meaning={(vl.definitions ?? [])[0] ?? vl.definition}
          pictures={round.pictures ?? []}
          onSpeak={playAudio}
          tone="paper"
          onAdvance={() => {
            if (checkIdx + 1 < checkRounds.length) setCheckIdx((i) => i + 1);
            else setPhase("complete");
          }}
        />
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
                className="text-xl px-3 py-1.5 rounded-lg text-shodo-paper font-medium"
                style={{ backgroundColor: TYPE_COLORS[item.type] ?? "var(--shodo-ink-light)" }}
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
