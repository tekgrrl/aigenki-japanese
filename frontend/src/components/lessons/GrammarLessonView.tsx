"use client";

import React, { useState } from "react";
import { GrammarLesson, UserGrammarLesson } from "@/types";

interface GrammarLessonViewProps {
  lesson: GrammarLesson;
  userLesson?: UserGrammarLesson;
  selectedFacets: Record<string, boolean>;
  onToggleFacet: (key: string) => void;
}

export default function GrammarLessonView({
  lesson,
  userLesson,
  selectedFacets,
  onToggleFacet,
}: GrammarLessonViewProps) {
  const [revealedExamples, setRevealedExamples] = useState<Record<number, boolean>>({});

  const toggleReveal = (idx: number) => {
    setRevealedExamples((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const facetOptions = [
    { key: "sentence-assembly", label: "Sentence Assembly", description: "Reassemble example sentences" },
    { key: "AI-Generated-Question", label: "General usage patterns", description: "Answer varied questions about how this pattern is used in context" },
    { key: "Content-to-Definition", label: "Pattern → Meaning", description: "See the pattern, recall its meaning" },
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
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-center shadow-sm">
        <div className="text-4xl font-bold text-slate-900 mb-2">{lesson.pattern}</div>
        <div className="text-slate-500 text-sm mb-3">{lesson.title}</div>
        <span className="inline-block px-3 py-1 bg-indigo-100 text-indigo-800 text-xs font-bold rounded-full">
          {lesson.jlptLevel}
        </span>
      </div>

      {/* Meaning */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-2">Meaning</h2>
        <p className="text-slate-800 text-lg">{lesson.meaning}</p>
      </div>

      {/* Formation */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-2">Formation</h2>
        <p className="font-mono text-slate-900 bg-white border border-slate-100 rounded px-4 py-2 inline-block">
          {lesson.formation}
        </p>
      </div>

      {/* Notes */}
      {lesson.notes && (
        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-lg">
          <h2 className="text-sm font-bold text-amber-700 uppercase tracking-wide mb-2">Notes</h2>
          <p className="text-amber-900 text-sm leading-relaxed">{lesson.notes}</p>
        </div>
      )}

      {/* Examples */}
      <div>
        <h2 className="text-xl font-bold text-slate-800 mb-4">Examples</h2>
        <div className="space-y-4">
          {lesson.examples.map((ex, idx) => {
            const isFromSource = idx === 0 && userLesson;
            return (
              <div
                key={idx}
                className={`border rounded-xl p-5 ${isFromSource ? "bg-indigo-50 border-indigo-200" : "bg-white border-slate-200"}`}
              >
                {isFromSource && (
                  <div className="text-xs font-bold text-indigo-500 uppercase mb-2">
                    From {userLesson!.sourceTitle}
                  </div>
                )}
                {ex.context && !isFromSource && (
                  <div className="text-xs font-bold text-slate-400 uppercase mb-2">{ex.context}</div>
                )}
                <p className="text-xl font-medium text-slate-900 mb-1">{ex.japanese}</p>
                <button
                  onClick={() => toggleReveal(idx)}
                  className="text-sm text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  {revealedExamples[idx] ? "Hide translation" : "Show translation"}
                </button>
                {revealedExamples[idx] && (
                  <p className="text-slate-500 text-sm mt-1">{ex.english}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Facet Selection */}
      <div className="border-t border-slate-200 pt-8">
        <h2 className="text-xl font-bold text-slate-800 mb-2">Review Methods</h2>
        <p className="text-sm text-slate-500 mb-4">
          Choose which review types to add to your queue.
        </p>
        <div className="space-y-3">
          {facetOptions.map(({ key, label, description }) => (
            <label
              key={key}
              className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-xl cursor-pointer hover:border-indigo-300 transition-colors"
            >
              <input
                type="checkbox"
                checked={!!selectedFacets[key]}
                onChange={() => onToggleFacet(key)}
                className="mt-1 w-4 h-4 accent-indigo-600"
              />
              <div>
                <div className="font-semibold text-slate-800">{label}</div>
                <div className="text-sm text-slate-500">{description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
