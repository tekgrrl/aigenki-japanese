"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Volume2 } from "lucide-react";
import { ReviewFacet } from "@/types";
import { apiFetch } from "@/lib/api-client";
import ReviewActionButtons from "./ReviewActionButtons";

const LONG_PRESS_MS = 500;

interface Props {
  facet: ReviewFacet;
  onResult: (result: "pass" | "fail") => Promise<void>;
  onAdvance: () => void;
  onSkip: () => void;
  onSpeak?: (text: string) => void;
  onShowLesson?: () => void;
  showLesson?: boolean;
  isFetchingLesson?: boolean;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface LearnableTerm {
  term: string;
  surfaceForm: string;
  reading: string;
  meaning: string;
}

interface AssemblyExample {
  fragments: string[];
  answer: string;
  english: string;
  accepted_alternatives: string[];
  learnableTerms?: LearnableTerm[];
}

/**
 * Removes sentence-final punctuation from the last fragment (in canonical order) so it
 * doesn't give away which piece goes last. Answer checking ignores trailing punctuation
 * via normalize(), and feedback still shows the full answer. Drops a lone "。" fragment.
 */
function stripFinalPunctuation(fragments: string[]): string[] {
  if (fragments.length === 0) return fragments;
  const out = [...fragments];
  out[out.length - 1] = out[out.length - 1].replace(/[。！？!?.]+$/u, "");
  return out.filter((f) => f.trim() !== "");
}

export default function SentenceAssemblyCard({ facet, onResult, onAdvance, onSkip, onSpeak, onShowLesson, showLesson, isFetchingLesson }: Props) {
  const data = facet.data as Partial<AssemblyExample> & {
    goalTitle: string;
    sourceId?: string;
    sourceTitle?: string;
    /** Rotating facets (one per grammar point) hold several examples; legacy facets hold one, flat. */
    examples?: AssemblyExample[];
  };
  const { goalTitle, sourceId, sourceTitle } = data;
  // Pick once per mount so the example doesn't change mid-answer.
  const [example] = useState<Partial<AssemblyExample>>(() =>
    Array.isArray(data.examples) && data.examples.length > 0
      ? data.examples[Math.floor(Math.random() * data.examples.length)]
      : data,
  );
  const { fragments, answer = "", english, accepted_alternatives, learnableTerms } = example;

  const normalize = (s: string) => s.replace(/[。、！？!?\.]+$/u, "").replace(/[\s　]+/g, "").trim();
  const missingData = !Array.isArray(fragments) || fragments.length === 0 || !answer;
  const [available, setAvailable] = useState<string[]>(() =>
    shuffleArray(Array.isArray(fragments) ? stripFinalPunctuation(fragments) : []),
  );
  const [assembled, setAssembled] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [submittedAnswer, setSubmittedAnswer] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false);
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  // "I don't know this" flag flow (issue #222) — long-press an unplaced fragment
  // to flag it, without disturbing the tap-to-select gesture the same button uses.
  // Fragments bundle particles with their preceding word (needed for the assembly
  // exercise itself), so they're often poor standalone learning items on their own
  // ("先生は", "九時から"). Instead of flagging the raw fragment, match it against
  // learnableTerms — dictionary-form words the lesson generator already identified
  // as worth learning — and only offer the flag when a match exists.
  const [flagTerm, setFlagTerm] = useState<LearnableTerm | null>(null);
  const [flagStatus, setFlagStatus] = useState<"idle" | "sending">("idle");
  const [flagMessage, setFlagMessage] = useState<string | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  useEffect(() => {
    if (submitted) {
      setTimeout(() => nextButtonRef.current?.focus(), 50);
    }
  }, [submitted]);

  const addFragment = (idx: number) => {
    if (submitted) return;
    const fragment = available[idx];
    setAvailable(prev => prev.filter((_, i) => i !== idx));
    setAssembled(prev => [...prev, fragment]);
  };

  const startPress = (fragment: string) => {
    longPressTriggered.current = false;
    const match = (learnableTerms ?? []).find(t => fragment.includes(t.surfaceForm || t.term));
    if (!match) return; // nothing learnable in this fragment — no long-press effect
    pressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setFlagTerm(match);
    }, LONG_PRESS_MS);
  };

  const cancelPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const handleFragmentClick = (idx: number) => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    addFragment(idx);
  };

  const handleFlagChoice = async (choice: "exclude" | "enroll") => {
    if (!flagTerm) return;
    setFlagStatus("sending");
    try {
      const res = await apiFetch("/api/learner-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: flagTerm.term,
          kuType: "Vocab",
          choice,
          context: "sentence-assembly",
        }),
      });
      if (!res.ok) throw new Error("Flag request failed");
      setFlagMessage(choice === "exclude" ? "Got it — won't show this for a while." : "Added to your learning queue.");
    } catch {
      setFlagMessage("Something went wrong — try again later.");
    } finally {
      setFlagStatus("idle");
      setTimeout(() => { setFlagTerm(null); setFlagMessage(null); }, 2500);
    }
  };

  const removeFragment = (idx: number) => {
    if (submitted) return;
    const fragment = assembled[idx];
    setAssembled(prev => prev.filter((_, i) => i !== idx));
    setAvailable(prev => [...prev, fragment]);
  };

  const handleSubmit = async () => {
    if (assembled.length === 0 || submitted) return;
    setIsSubmitting(true);
    const assembledStr = assembled.join("");
    const exactMatch = assembledStr === answer || normalize(assembledStr) === normalize(answer);
    const altMatch = (accepted_alternatives ?? []).some(a => assembledStr === a || normalize(assembledStr) === normalize(a));
    const correct = exactMatch || altMatch;

    if (!correct) {
      console.group("[SentenceAssembly] Incorrect answer diagnosis");
      console.log("Submitted:  ", JSON.stringify(assembledStr));
      console.log("Expected:   ", JSON.stringify(answer));
      console.log("Alternatives:", JSON.stringify(accepted_alternatives ?? []));
      console.log("Fragments used:", assembled);
      if (assembledStr.length === answer.length) {
        const diffs = [...assembledStr].map((ch, i) =>
          ch !== answer[i]
            ? `[${i}] submitted U+${ch.codePointAt(0)?.toString(16)} vs expected U+${answer[i].codePointAt(0)?.toString(16)}`
            : null
        ).filter(Boolean);
        console.log("Char diffs (same length):", diffs.length ? diffs : "none — possible whitespace/normalization issue");
        console.log("Submitted codepoints: ", [...assembledStr].map(c => c.codePointAt(0)?.toString(16)).join(" "));
        console.log("Expected  codepoints: ", [...answer].map(c => c.codePointAt(0)?.toString(16)).join(" "));
      } else {
        console.log(`Length mismatch: submitted=${assembledStr.length}, expected=${answer.length}`);
      }
      console.groupEnd();
    } else {
      console.log(`[SentenceAssembly] Correct (${exactMatch ? "exact" : "alternative match"}):`, JSON.stringify(assembledStr));
    }

    setSubmittedAnswer(assembledStr);
    setIsCorrect(correct);
    onSpeak?.(correct ? assembledStr : answer);
    await onResult(correct ? "pass" : "fail");
    setSubmitted(true);
    setIsSubmitting(false);
  };

  if (missingData) {
    console.warn("[SentenceAssembly] Facet missing required data", { facetId: facet.id, fragments, answer });
    return (
      <div className="bg-gray-800 shadow-2xl rounded-lg p-8 space-y-4 text-center">
        <p className="text-amber-400 font-semibold">This review card has incomplete data and cannot be shown.</p>
        <p className="text-gray-400 text-sm">Facet ID: {facet.id}</p>
        <button onClick={onSkip} className="px-6 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-500">
          Skip
        </button>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 shadow-2xl rounded-lg p-8 space-y-6">
      {/* Header */}
      <div className="text-center">
        <p className="text-lg font-semibold text-blue-300 mb-1">Sentence Structure</p>
        <p className="text-sm text-gray-400">{goalTitle}</p>
      </div>

      {/* Prompt */}
      <div className="bg-gray-700 rounded-lg px-5 py-4 text-center">
        <p className="text-xs uppercase tracking-widest text-gray-400 mb-1">Translate</p>
        <p className="text-xl text-white font-medium">{english}</p>
      </div>

      {/* Assembly zone */}
      <div>
        <p className="text-xs uppercase tracking-widest text-gray-400 mb-2">Your answer</p>
        <div className="min-h-[52px] flex flex-wrap gap-2 p-3 bg-gray-900 rounded-lg border-2 border-gray-600">
          {assembled.length === 0 && (
            <p className="text-gray-600 text-sm self-center">Click fragments below to assemble…</p>
          )}
          {assembled.map((fragment, i) => (
            <button
              key={`${fragment}-${i}`}
              onClick={() => removeFragment(i)}
              disabled={submitted}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-base rounded-md font-medium transition-colors disabled:cursor-default"
            >
              {fragment}
            </button>
          ))}
        </div>
      </div>

      {/* Available fragments */}
      <div>
        <p className="text-xs uppercase tracking-widest text-gray-400 mb-2">Fragments</p>
        <div className="flex flex-wrap gap-2">
          {available.map((fragment, i) => {
            const hasLearnableTerm = (learnableTerms ?? []).some(t => fragment.includes(t.surfaceForm || t.term));
            return (
              <button
                key={`${fragment}-${i}`}
                onClick={() => handleFragmentClick(i)}
                onPointerDown={() => startPress(fragment)}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                disabled={submitted}
                title={hasLearnableTerm ? "Long-press if you don't know this" : undefined}
                className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-base rounded-md font-medium transition-colors disabled:opacity-40 disabled:cursor-default select-none"
              >
                {fragment}
              </button>
            );
          })}
        </div>
      </div>

      {/* "I don't know this" flag — long-press a fragment above to open */}
      {flagTerm && (
        <div className="rounded-lg border border-gray-600 bg-gray-900 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-300">
              Don't know <span className="text-white font-semibold">{flagTerm.term}</span>
              {flagTerm.reading && flagTerm.reading !== flagTerm.term && <span className="text-gray-400"> ({flagTerm.reading})</span>}
              {flagTerm.meaning && <span className="text-gray-400"> — {flagTerm.meaning}</span>}?
            </p>
            <button
              onClick={() => { setFlagTerm(null); setFlagMessage(null); }}
              className="text-gray-500 hover:text-gray-300 text-sm shrink-0"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
          {flagMessage ? (
            <p className="text-sm text-green-300">{flagMessage}</p>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => handleFlagChoice("exclude")}
                disabled={flagStatus === "sending"}
                className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-md transition-colors disabled:opacity-50"
              >
                Not now
              </button>
              <button
                onClick={() => handleFlagChoice("enroll")}
                disabled={flagStatus === "sending"}
                className="flex-1 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-sm rounded-md transition-colors disabled:opacity-50"
              >
                Help me learn this
              </button>
            </div>
          )}
        </div>
      )}

      {/* Submit */}
      {!submitted && (
        <ReviewActionButtons
          submitLabel={isSubmitting ? "Checking…" : "Submit"}
          onSubmit={handleSubmit}
          submitDisabled={assembled.length === 0 || isSubmitting}
          onSkip={onSkip}
          onShowLesson={onShowLesson}
          showLesson={showLesson}
          isFetchingLesson={isFetchingLesson}
        />
      )}

      {/* Feedback */}
      {submitted && isCorrect !== null && (
        <div className={`rounded-lg p-5 space-y-3 ${isCorrect ? "bg-green-800" : "bg-red-800"}`}>
          <h3 className="text-xl font-semibold text-white">
            {isCorrect ? "Correct" : "Incorrect"}
          </h3>
          {isCorrect ? (
            <div className="space-y-2">
              <p className="text-gray-200">
                Your answer of <span className="text-white font-medium">{submittedAnswer}</span> is a correct translation of <span className="text-white font-medium">{english}</span>.
              </p>
              {normalize(submittedAnswer) !== normalize(answer) && (
                <p className="text-green-200 text-sm">
                  While that's acceptable, it's better to say: <span className="text-white font-medium">{answer}</span>
                </p>
              )}
            </div>
          ) : (
            <>
              <p className="text-gray-200 flex items-center flex-wrap gap-x-2">
                <span className="font-semibold">Correct answer:</span>
                <span className="text-white font-medium">{answer}</span>
                {onSpeak && (
                  <button
                    type="button"
                    onClick={() => onSpeak(answer)}
                    title="Replay audio"
                    aria-label="Replay audio"
                    className="p-1.5 rounded-full text-gray-200 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <Volume2 className="w-5 h-5" />
                  </button>
                )}
              </p>
              {sourceId && (
                <Link
                  href={`/concepts/${sourceId}`}
                  className="inline-block px-4 py-2 bg-[#0A5C36] text-white font-semibold rounded-md hover:bg-[#084a2b]"
                >
                  Review concept: {sourceTitle}
                </Link>
              )}
              {onShowLesson && (
                <button
                  type="button"
                  onClick={onShowLesson}
                  disabled={isFetchingLesson}
                  className="inline-block px-4 py-2 bg-[#0A5C36] text-white font-semibold rounded-md hover:bg-[#084a2b] disabled:opacity-50"
                >
                  {isFetchingLesson ? "Loading..." : showLesson ? "Hide Lesson" : "Review Lesson"}
                </button>
              )}
            </>
          )}
          <button
            ref={nextButtonRef}
            onClick={onAdvance}
            className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
