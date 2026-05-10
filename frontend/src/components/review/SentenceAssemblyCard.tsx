"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { ReviewFacet } from "@/types";

interface Props {
  facet: ReviewFacet;
  onResult: (result: "pass" | "fail") => Promise<void>;
  onAdvance: () => void;
  onSkip: () => void;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function SentenceAssemblyCard({ facet, onResult, onAdvance, onSkip }: Props) {
  const { goalTitle, fragments, answer, english, accepted_alternatives, sourceId, sourceTitle } = facet.data as {
    goalTitle: string;
    fragments: string[];
    answer: string;
    english: string;
    accepted_alternatives: string[];
    sourceId?: string;
    sourceTitle?: string;
  };

  const normalize = (s: string) => s.replace(/[。、！？!?\.]+$/u, "").replace(/[\s　]+/g, "").trim();
  const missingData = !Array.isArray(fragments) || fragments.length === 0 || !answer;
  const [available, setAvailable] = useState<string[]>(() => shuffleArray(Array.isArray(fragments) ? fragments : []));
  const [assembled, setAssembled] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [submittedAnswer, setSubmittedAnswer] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false);
  const nextButtonRef = useRef<HTMLButtonElement>(null);

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
          {available.map((fragment, i) => (
            <button
              key={`${fragment}-${i}`}
              onClick={() => addFragment(i)}
              disabled={submitted}
              className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-base rounded-md font-medium transition-colors disabled:opacity-40 disabled:cursor-default"
            >
              {fragment}
            </button>
          ))}
        </div>
      </div>

      {/* Submit */}
      {!submitted && (
        <div className="flex gap-4">
          <button
            onClick={onSkip}
            className="flex-1 px-6 py-3 bg-gray-500 text-white text-lg font-semibold rounded-md shadow-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-gray-800"
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            disabled={assembled.length === 0 || isSubmitting}
            className="flex-1 px-6 py-3 bg-blue-600 text-white text-lg font-semibold rounded-md shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:bg-gray-500 disabled:cursor-wait"
          >
            {isSubmitting ? "Checking…" : "Submit"}
          </button>
        </div>
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
              <p className="text-gray-200">
                <span className="font-semibold">Correct answer: </span>
                <span className="text-white font-medium">{answer}</span>
              </p>
              {sourceId && (
                <Link
                  href={`/concepts/${sourceId}`}
                  className="inline-block px-4 py-2 bg-[#0A5C36] text-white font-semibold rounded-md hover:bg-[#084a2b]"
                >
                  Review concept: {sourceTitle}
                </Link>
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
