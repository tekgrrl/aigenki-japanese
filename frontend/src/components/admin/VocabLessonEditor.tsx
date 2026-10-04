"use client";

import React from "react";
import { VocabLesson } from "@/types";
import ArrayFieldEditor from "./ArrayFieldEditor";

interface Props {
  lesson: VocabLesson;
  onChange: (lesson: VocabLesson) => void;
}

const PART_OF_SPEECH_OPTIONS = [
  "transitive-verb", "intransitive-verb", "i-adjective", "na-adjective", "noun",
  "noun-prenominal", "proper-noun", "noun-suru", "counter", "adverb",
  "auxiliary-verb", "prefix", "suffix", "conjunction", "grammar", "expression",
];

const inputClass = "w-full px-3 py-2 bg-white border border-shodo-mist rounded text-gray-900 text-sm focus:outline-none focus:border-shodo-indigo";
const labelClass = "block text-xs font-bold text-shodo-ink-light uppercase tracking-wide mb-1";
const microLabelClass = "block text-[10px] text-shodo-ink-light mb-0.5";
const sectionClass = "bg-shodo-paper-dark p-4 rounded-lg border border-shodo-ink/5 space-y-3";

export default function VocabLessonEditor({ lesson, onChange }: Props) {
  const set = <K extends keyof VocabLesson>(key: K, value: VocabLesson[K]) => {
    onChange({ ...lesson, [key]: value });
  };

  return (
    <div className="space-y-6">
      <div className={sectionClass}>
        <label className={labelClass}>Meaning Explanation</label>
        <textarea
          rows={4}
          className={`${inputClass} resize-y`}
          value={lesson.meaning_explanation || ""}
          onChange={(e) => set("meaning_explanation", e.target.value)}
        />
      </div>

      <div className={sectionClass}>
        <label className={labelClass}>Reading Explanation</label>
        <textarea
          rows={4}
          className={`${inputClass} resize-y`}
          value={lesson.reading_explanation || ""}
          onChange={(e) => set("reading_explanation", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Part of Speech</label>
          <select
            className={inputClass}
            value={lesson.partOfSpeech || ""}
            onChange={(e) => set("partOfSpeech", e.target.value as VocabLesson["partOfSpeech"])}
          >
            <option value="">None</option>
            {PART_OF_SPEECH_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Conjugation Type</label>
          <select
            className={inputClass}
            value={lesson.conjugationType || ""}
            onChange={(e) =>
              set("conjugationType", (e.target.value || undefined) as VocabLesson["conjugationType"])
            }
          >
            <option value="">None</option>
            <option value="godan">Godan</option>
            <option value="ichidan">Ichidan</option>
            <option value="irregular">Irregular</option>
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-shodo-ink">
        <input
          type="checkbox"
          checked={!!lesson.kanaOnly}
          onChange={(e) => set("kanaOnly", e.target.checked)}
        />
        Kana only — never show or queue this word&apos;s kanji breakdown
      </label>

      <div className={sectionClass}>
        <ArrayFieldEditor
          label="Definitions"
          items={(lesson.definitions || []).map((value) => ({ value }))}
          onChange={(items) => set("definitions", items.map((i) => i.value))}
          emptyItem={() => ({ value: "" })}
          addLabel="+ Add definition"
          renderRow={(item, _i, update) => (
            <input
              type="text"
              className={inputClass}
              value={item.value}
              onChange={(e) => update({ value: e.target.value })}
              placeholder="Definition"
            />
          )}
        />
      </div>

      <div className={sectionClass}>
        <ArrayFieldEditor
          label="Context Examples"
          items={lesson.context_examples || []}
          onChange={(items) => set("context_examples", items)}
          emptyItem={() => ({ sentence: "", translation: "" })}
          addLabel="+ Add example"
          renderRow={(item, _i, update) => (
            <>
              <div>
                <label className={microLabelClass}>Sentence</label>
                <input
                  type="text"
                  className={inputClass}
                  value={item.sentence}
                  onChange={(e) => update({ sentence: e.target.value })}
                />
              </div>
              <div>
                <label className={microLabelClass}>Translation</label>
                <input
                  type="text"
                  className={inputClass}
                  value={item.translation}
                  onChange={(e) => update({ translation: e.target.value })}
                />
              </div>
            </>
          )}
        />
      </div>

      <div className={`${sectionClass} ${lesson.kanaOnly ? "opacity-40 pointer-events-none" : ""}`}>
        {lesson.kanaOnly && (
          <p className="text-xs text-shodo-ink-light italic">
            Ignored on save while &quot;Kana only&quot; is checked.
          </p>
        )}
        <ArrayFieldEditor
          label="Component Kanji"
          items={lesson.component_kanji || []}
          onChange={(items) => set("component_kanji", items)}
          emptyItem={() => ({ kanji: "", reading: "", meaning: "", onyomi: [], kunyomi: [] })}
          addLabel="+ Add kanji"
          renderRow={(item, _i, update) => (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={microLabelClass}>Kanji</label>
                  <input type="text" className={inputClass} value={item.kanji} onChange={(e) => update({ kanji: e.target.value })} />
                </div>
                <div>
                  <label className={microLabelClass}>Reading</label>
                  <input type="text" className={inputClass} value={item.reading} onChange={(e) => update({ reading: e.target.value })} />
                </div>
                <div>
                  <label className={microLabelClass}>Meaning</label>
                  <input type="text" className={inputClass} value={item.meaning} onChange={(e) => update({ meaning: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={microLabelClass}>Onyomi (comma-separated)</label>
                  <input
                    type="text"
                    className={inputClass}
                    value={(item.onyomi || []).join(", ")}
                    onChange={(e) => update({ onyomi: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                  />
                </div>
                <div>
                  <label className={microLabelClass}>Kunyomi (comma-separated)</label>
                  <input
                    type="text"
                    className={inputClass}
                    value={(item.kunyomi || []).join(", ")}
                    onChange={(e) => update({ kunyomi: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                  />
                </div>
              </div>
            </>
          )}
        />
      </div>
    </div>
  );
}
