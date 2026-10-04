"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { GrammarLesson, UserGrammarLesson } from "@/types";
import { normalizeFormation } from "@/lib/grammar-lesson";
import GrammarPatternDisplay from "./GrammarPatternDisplay";

interface GrammarLessonViewProps {
  lesson: GrammarLesson;
  userLesson?: UserGrammarLesson;
  selectedFacets: Record<string, boolean>;
  onToggleFacet: (key: string) => void;
  existingFacetTypes?: Set<string>;
}

export default function GrammarLessonView({
  lesson,
  userLesson,
  selectedFacets,
  onToggleFacet,
  existingFacetTypes = new Set(),
}: GrammarLessonViewProps) {
  const [revealedExamples, setRevealedExamples] = useState<Record<number, boolean>>({});

  const toggleReveal = (idx: number) => {
    setRevealedExamples((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const facetOptions = [
    { key: "sentence-assembly", label: "Sentence Assembly", description: "Reassemble example sentences" },
    { key: "AI-Generated-Question", label: "General usage patterns", description: "Answer varied questions about how this pattern is used in context" },
  ];

  return (
    <div className="space-y-8">
      {/* Source Context Banner */}
      {userLesson && (
        <div className="bg-indigo-50 border-l-4 border-indigo-400 px-4 py-3 rounded-r-lg text-sm text-indigo-800">
          First encountered in <strong>{userLesson.sourceTitle}</strong>
        </div>
      )}

      {/* Pattern Header */}
      <div className="bg-shodo-paper-dark border border-shodo-ink/5 rounded-lg p-6 text-center shadow-lg">
        <GrammarPatternDisplay pattern={lesson.pattern} className="text-2xl font-bold text-shodo-ink mb-2" />
        <div className="text-shodo-ink-faint text-sm mb-3">{lesson.title}</div>
        <span className="inline-block px-3 py-1 bg-indigo-100 text-indigo-800 text-xs font-bold rounded-full">
          {lesson.jlptLevel}
        </span>
      </div>

      {/* Meaning + Notes */}
      <div className="bg-shodo-paper-dark border border-shodo-ink/5 rounded-lg p-6 shadow-lg space-y-4">
        <div>
          <h2 className="text-sm font-bold text-shodo-ink-faint uppercase tracking-wide mb-2">Meaning</h2>
          <p className="text-shodo-ink text-lg">{lesson.meaning}</p>
        </div>
        {lesson.notes && (
          <div className="border-t border-shodo-ink/10 pt-4 space-y-3 text-shodo-ink-light text-base leading-relaxed [&_p]:mb-3 [&_br]:block [&_br]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_strong]:text-shodo-ink [&_a]:underline [&_code]:bg-shodo-ink/5 [&_code]:px-1 [&_code]:rounded [&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-shodo-ink [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-shodo-ink [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-shodo-ink [&_h3]:mt-3 [&_h3]:mb-1.5">
            <ReactMarkdown remarkPlugins={[remarkBreaks]}>{lesson.notes.replace(/\\n/g, '\n')}</ReactMarkdown>
          </div>
        )}
      </div>

      {/* Formation */}
      <div className="bg-shodo-paper-dark border border-shodo-ink/5 rounded-lg p-6 shadow-lg">
        <h2 className="text-sm font-bold text-shodo-ink-faint uppercase tracking-wide mb-2">Formation</h2>
        <ul className="space-y-2">
          {normalizeFormation(lesson.formation).map((f, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-2 w-1.5 h-1.5 rounded-full bg-shodo-ink-faint flex-shrink-0" />
              <span className="font-mono text-shodo-ink bg-shodo-paper-warm border border-shodo-ink/10 rounded px-4 py-2 inline-block">
                {f}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Examples */}
      <div className="bg-shodo-paper-dark border border-shodo-ink/5 rounded-lg p-6 shadow-lg">
        <h2 className="text-2xl font-semibold mb-4 text-shodo-ink">Examples</h2>
        <div className="space-y-4">
          {lesson.examples.map((ex, idx) => {
            const isFromSource = idx === 0 && userLesson;
            return (
              <div
                key={idx}
                className={`rounded-md p-4 ${isFromSource ? "bg-indigo-50 border border-indigo-200" : "bg-shodo-paper-warm"}`}
              >
                {isFromSource && (
                  <div className="text-xs font-bold text-indigo-500 uppercase mb-2">
                    From {userLesson!.sourceTitle}
                  </div>
                )}
                {ex.context && !isFromSource && (
                  <div className="text-xs font-bold text-shodo-ink-faint uppercase mb-2">{ex.context}</div>
                )}
                <p className="text-xl font-medium text-shodo-ink mb-1">{ex.japanese}</p>
                <button
                  onClick={() => toggleReveal(idx)}
                  className="text-sm text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  {revealedExamples[idx] ? "Hide translation" : "Show translation"}
                </button>
                {revealedExamples[idx] && (
                  <p className="text-shodo-ink-light text-sm mt-1">{ex.english}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Facet Selection */}
      <div className="bg-shodo-paper-dark border border-shodo-ink/5 rounded-lg p-6 shadow-lg">
        <h2 className="text-2xl font-semibold mb-2 text-shodo-ink">Review Methods</h2>
        <p className="text-sm text-shodo-ink-faint mb-4">
          Choose which review types to add to your queue.
        </p>
        <div className="space-y-3">
          {facetOptions.map(({ key, label, description }) => {
            const enrolled = existingFacetTypes.has(key);
            return enrolled ? (
              <label
                key={key}
                className="flex items-start gap-3 p-4 bg-shodo-paper-warm border border-shodo-ink/10 rounded-lg opacity-60 cursor-not-allowed"
              >
                <input
                  type="checkbox"
                  checked
                  disabled
                  onChange={() => {}}
                  className="mt-1 w-4 h-4 accent-indigo-600"
                />
                <div>
                  <div className="font-semibold text-shodo-ink">{label}</div>
                  <div className="text-sm text-shodo-ink-light">{description}</div>
                </div>
              </label>
            ) : (
              <label
                key={key}
                className="flex items-start gap-3 p-4 bg-shodo-paper-warm border border-shodo-ink/10 rounded-lg cursor-pointer hover:border-indigo-300 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={!!selectedFacets[key]}
                  onChange={() => onToggleFacet(key)}
                  className="mt-1 w-4 h-4 accent-indigo-600"
                />
                <div>
                  <div className="font-semibold text-shodo-ink">{label}</div>
                  <div className="text-sm text-shodo-ink-light">{description}</div>
                </div>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
