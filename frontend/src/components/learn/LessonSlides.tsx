"use client";

import LessonNotes from "@/components/lessons/LessonNotes";
import { useEffect, useRef, useCallback } from "react";
import { VocabLesson, KanjiLesson, GrammarLesson, Lesson } from "@/types";
import { apiFetch } from "@/lib/api-client";
import { normalizeFormation } from "@/lib/grammar-lesson";
import { FuriganaText } from "@/components/FuriganaText";
import GrammarPatternDisplay from "@/components/lessons/GrammarPatternDisplay";
import { pictureUrl, type PictureRef } from "@/lib/pictures";
import { stripFurigana } from "@/lib/furigana";

export interface QueueItem {
  kuId: string;
  content: string;
  type: string;
}

export interface LoadedItem {
  item: QueueItem;
  lesson: Lesson;
  /** Audio-first experiment: approved pictures. When present, the word is taught by
   *  picture and sound only (no kanji or kana) — see audioFirstSlides. */
  pictures?: PictureRef[];
}

/**
 * Audio-first slides (#246): the word slide, then one slide per usage that has its own
 * picture, pairing it with that usage's example sentence (heard, not shown). Usages
 * without a picture are left out: the word is taught (and tested, by picture-choice) only
 * through what's pictured, and another usage's picture would teach the wrong meaning.
 * If no usage matches a picture (labels changed since it was drawn), one slide pairs the
 * first picture with the first example.
 */
function audioFirstSlides(loaded: LoadedItem): { picture: PictureRef; example?: NonNullable<VocabLesson["context_examples"]>[number] }[] {
  const vl = loaded.lesson as VocabLesson;
  const pics = loaded.pictures ?? [];
  const examples = vocabExampleSlides(vl);
  const key = (u?: string) => (u ?? "").trim().toLowerCase();
  const matched = examples.flatMap((ex) => {
    const picture = pics.find((p) => key(p.usage) === key(ex.usage));
    return picture ? [{ picture, example: ex }] : [];
  });
  return matched.length > 0 ? matched : [{ picture: pics[0], example: examples[0] }];
}

export const isAudioFirst = (loaded: LoadedItem) => loaded.lesson.type === "Vocab" && (loaded.pictures?.length ?? 0) > 0;

export function slideCount(loaded: LoadedItem): number {
  const { item, lesson } = loaded;
  if (isAudioFirst(loaded)) return 1 + audioFirstSlides(loaded).length;
  if (item.type === "Vocab" && lesson.type === "Vocab") {
    const vl = lesson as VocabLesson;
    const hasKanji = !vl.kanaOnly && (vl.component_kanji?.length ?? 0) > 0;
    return 3 + (hasKanji ? 1 : 0) + vocabExampleSlides(vl).length;
  }
  if (item.type === "Kanji") return 4;
  if (item.type === "Grammar" && lesson.type === "Grammar") {
    const gl = lesson as GrammarLesson;
    return 2 + (gl.notes ? 1 : 0) + (gl.examples?.length ?? 0);
  }
  return 1;
}

/**
 * Examples to show in the slideshow: the first example of each distinct usage, so a word
 * with two usages isn't later tested on one the learner never saw. Unlabelled (older)
 * lessons show just the first example.
 */
export function vocabExampleSlides(vl: VocabLesson): NonNullable<VocabLesson["context_examples"]> {
  const examples = vl.context_examples ?? [];
  if (examples.length === 0) return [];
  if (!examples.every((e) => e.usage)) return [examples[0]];
  const seen = new Set<string>();
  return examples.filter((e) => {
    const key = (e.usage ?? "").trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  const lesson: Lesson = await res.json();
  if (lesson.type === "Vocab") await ensureUsageLabels(lesson as VocabLesson, item.kuId);
  if (lesson.type === "Grammar") await ensureGrammarFurigana(lesson as GrammarLesson, item.kuId);
  return lesson;
}

/**
 * Older Vocab lessons have unlabelled examples. Ask the backend to label them once (it
 * saves the labels on the lesson) so the slideshow can show one example per usage.
 * Best-effort: on any failure the slideshow just shows the first example.
 */
const LABEL_TIMEOUT_MS = 30_000;

async function ensureUsageLabels(vl: VocabLesson, kuId: string) {
  const examples = vl.context_examples ?? [];
  if (examples.length < 2 || examples.every((e) => e.usage)) return;
  try {
    // Own timeout, not the lesson fetch's: a slow labelling call must never fail a lesson
    // that has already loaded.
    const res = await apiFetch(`/api/lessons/${kuId}/label-usages`, {
      method: "POST",
      signal: AbortSignal.timeout(LABEL_TIMEOUT_MS),
    });
    if (!res.ok) return;
    const { usages } = (await res.json()) as { usages: (string | null)[] };
    if (Array.isArray(usages) && usages.length === examples.length) {
      vl.context_examples = examples.map((e, i) => ({ ...e, usage: usages[i] ?? undefined }));
    }
  } catch (e) {
    console.warn(`[lesson-slides] usage labelling failed for ${vl.vocab}`, e);
  }
}

/** Grammar examples were generated without readings: fill them in once (saved on the lesson). */
async function ensureGrammarFurigana(gl: GrammarLesson, kuId: string) {
  const examples = gl.examples ?? [];
  if (examples.length === 0 || examples.every((e) => e.furigana)) return;
  try {
    // Own timeout, like usage labelling: never fail a lesson that has already loaded.
    const res = await apiFetch(`/api/lessons/${kuId}/furigana`, {
      method: "POST",
      signal: AbortSignal.timeout(LABEL_TIMEOUT_MS),
    });
    if (!res.ok) return;
    const { furigana } = (await res.json()) as { furigana: (string | null)[] };
    if (Array.isArray(furigana) && furigana.length === examples.length) {
      gl.examples = examples.map((e, i) => ({ ...e, furigana: furigana[i] ?? e.furigana }));
    }
  } catch (e) {
    console.warn(`[lesson-slides] furigana failed for ${gl.pattern}`, e);
  }
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

function PlayButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-shodo-ink text-shodo-paper font-semibold active:scale-95 transition-transform"
    >
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M4.018 14L14.41 9 4.018 4v10z" />
      </svg>
      {label}
    </button>
  );
}

function PictureFrame({ picture }: { picture: PictureRef }) {
  return (
    // biome-ignore lint/performance/noImgElement: backend-served card images
    <img
      src={pictureUrl(picture)}
      alt=""
      className="w-full max-w-sm aspect-square object-cover rounded-xl border border-shodo-ink/10 bg-[#f9f7f2] shadow-sm"
    />
  );
}

/** Audio-first: the word as picture + sound, with the English meaning as a small caption. */
function PictureWordSlide({ loaded, onAudio }: { loaded: LoadedItem; onAudio: (text: string) => void }) {
  const vl = loaded.lesson as VocabLesson;
  // biome-ignore lint/correctness/useExhaustiveDependencies: play once when the slide opens
  useEffect(() => { onAudio(vl.reading); }, []);
  return (
    <div className="w-full flex flex-col items-center gap-5 text-center">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">New word · listen</span>
      <PictureFrame picture={(loaded.pictures ?? [])[0]} />
      <PlayButton label="Play the word" onClick={() => onAudio(vl.reading)} />
      <p className="text-sm text-shodo-ink-light">{(vl.definitions ?? [])[0] ?? vl.definition}</p>
    </div>
  );
}

/** Audio-first: a usage's picture with its example sentence, heard (not shown), plus the translation. */
function PictureExampleSlide({
  picture,
  example,
  showUsage,
  onAudio,
}: {
  picture: PictureRef;
  example?: NonNullable<VocabLesson["context_examples"]>[number];
  showUsage: boolean;
  onAudio: (text: string) => void;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: play once when the slide opens
  useEffect(() => { if (example) onAudio(stripFurigana(example.sentence)); }, []);
  return (
    <div className="w-full flex flex-col items-center gap-5 text-center">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">
        In a sentence{showUsage && example?.usage ? <span className="normal-case tracking-normal font-medium"> · {example.usage}</span> : null}
      </span>
      <PictureFrame picture={picture} />
      {example && (
        <>
          <PlayButton label="Play the sentence" onClick={() => onAudio(stripFurigana(example.sentence))} />
          <p className="text-sm text-shodo-ink-light">{stripFurigana(example.translation)}</p>
        </>
      )}
    </div>
  );
}

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

function VocabExampleSlide({ ex, showUsage }: { ex: NonNullable<VocabLesson["context_examples"]>[number]; showUsage: boolean }) {
  const stripped = (s: string) => s.replace(/\[[^\]]*\]/g, "").trim();
  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <span className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint">
        Example{showUsage && ex.usage ? <span className="normal-case tracking-normal font-medium"> · {ex.usage}</span> : null}
      </span>
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
      <p className="text-3xl text-shodo-ink leading-relaxed"><FuriganaText text={ex.furigana ?? ex.japanese} /></p>
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
      <div className="flex flex-col gap-3">
        <LessonNotes
          notes={gl.notes}
          className="text-lg text-shodo-ink-light leading-relaxed"
          headingClassName="text-xl font-semibold text-shodo-ink mt-2"
        />
      </div>
    </div>
  );
}

export function renderSlide(loaded: LoadedItem, slideIdx: number, onAudio: (text: string) => void) {
  const { item, lesson } = loaded;
  if (isAudioFirst(loaded)) {
    if (slideIdx === 0) return <PictureWordSlide loaded={loaded} onAudio={onAudio} />;
    const slides = audioFirstSlides(loaded);
    const s = slides[slideIdx - 1];
    if (s) return <PictureExampleSlide key={slideIdx} picture={s.picture} example={s.example} showUsage={slides.length > 1} onAudio={onAudio} />;
  }
  if (item.type === "Vocab" && lesson.type === "Vocab") {
    const vl = lesson as VocabLesson;
    const hasKanji = !vl.kanaOnly && (vl.component_kanji?.length ?? 0) > 0;
    let s = slideIdx;
    if (s === 0) return <VocabWordSlide loaded={loaded} onAudio={onAudio} />;
    s--;
    if (hasKanji) { if (s === 0) return <VocabKanjiSlide loaded={loaded} />; s--; }
    if (s === 0) return <VocabMeaningSlide loaded={loaded} />;
    if (s === 1) return <VocabDefinitionsSlide loaded={loaded} />;
    const exampleSlides = vocabExampleSlides(vl);
    const ex = exampleSlides[s - 2];
    if (ex) return <VocabExampleSlide ex={ex} showUsage={exampleSlides.length > 1} />;
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

// Shodo theme variables (follow light/dark mode). Used as inline style colours, so
// derive tints with color-mix() rather than appending hex alpha.
export const TYPE_COLORS: Record<string, string> = {
  Vocab: "var(--shodo-indigo)",
  Kanji: "var(--shodo-stamp-red)",
  Grammar: "var(--shodo-matcha)",
};
