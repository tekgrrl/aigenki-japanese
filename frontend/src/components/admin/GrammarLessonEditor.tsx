"use client";

import React from "react";
import { GrammarLesson } from "@/types";
import ArrayFieldEditor from "./ArrayFieldEditor";

interface Props {
  lesson: GrammarLesson;
  onChange: (lesson: GrammarLesson) => void;
}

const inputClass = "w-full px-3 py-2 bg-white border border-shodo-mist rounded text-gray-900 text-sm focus:outline-none focus:border-shodo-indigo";
const labelClass = "block text-xs font-bold text-shodo-ink-light uppercase tracking-wide mb-1";
const microLabelClass = "block text-[10px] text-shodo-ink-light mb-0.5";
const sectionClass = "bg-shodo-paper-dark p-4 rounded-lg border border-shodo-ink/5 space-y-3";

// A string[] wrapped as {value} so it can go through the same ArrayFieldEditor
// as every object-shaped array — one editing mechanism, no bespoke string-array component.
function stringArrayField(
  values: string[] | undefined,
  onSet: (values: string[]) => void,
  addLabel: string,
  placeholder?: string,
) {
  return (
    <ArrayFieldEditor
      items={(values || []).map((value) => ({ value }))}
      onChange={(items) => onSet(items.map((i) => i.value))}
      emptyItem={() => ({ value: "" })}
      addLabel={addLabel}
      renderRow={(item, _i, update) => (
        <input
          type="text"
          className={inputClass}
          value={item.value}
          placeholder={placeholder}
          onChange={(e) => update({ value: e.target.value })}
        />
      )}
    />
  );
}

export default function GrammarLessonEditor({ lesson, onChange }: Props) {
  const set = <K extends keyof GrammarLesson>(key: K, value: GrammarLesson[K]) => {
    onChange({ ...lesson, [key]: value });
  };

  const formationArray = Array.isArray(lesson.formation)
    ? lesson.formation
    : lesson.formation
      ? [lesson.formation]
      : [];

  const examples = lesson.examples || [];
  const setExamples = (next: GrammarLesson["examples"]) => set("examples", next);

  return (
    <div className="space-y-6">
      <div className={sectionClass}>
        <label className={labelClass}>Meaning</label>
        <textarea
          rows={3}
          className={`${inputClass} resize-y`}
          value={lesson.meaning || ""}
          onChange={(e) => set("meaning", e.target.value)}
        />
      </div>

      <div className={sectionClass}>
        {stringArrayField(
          formationArray,
          (values) => set("formation", values),
          "+ Add formation line",
        )}
        <label className="block text-[10px] text-shodo-ink-light -mt-1">Formation</label>
      </div>

      <div className={sectionClass}>
        <ArrayFieldEditor
          label="Examples"
          items={examples}
          onChange={setExamples}
          emptyItem={() => ({
            japanese: "",
            english: "",
            context: "",
            fragments: [],
            accepted_alternatives: [],
            learnableTerms: [],
          })}
          addLabel="+ Add example"
          renderRow={(item, _i, update) => (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={microLabelClass}>Japanese</label>
                  <input
                    type="text"
                    className={inputClass}
                    value={item.japanese}
                    onChange={(e) => update({ japanese: e.target.value })}
                  />
                </div>
                <div>
                  <label className={microLabelClass}>English</label>
                  <input
                    type="text"
                    className={inputClass}
                    value={item.english}
                    onChange={(e) => update({ english: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className={microLabelClass}>Context</label>
                <input
                  type="text"
                  className={inputClass}
                  value={item.context || ""}
                  onChange={(e) => update({ context: e.target.value })}
                />
              </div>

              <div className="pl-2 border-l-2 border-shodo-mist">
                {stringArrayField(
                  item.fragments,
                  (values) => update({ fragments: values }),
                  "+ Add fragment",
                  "Fragment",
                )}
                <label className={microLabelClass}>Fragments</label>
              </div>

              <div className="pl-2 border-l-2 border-shodo-mist">
                {stringArrayField(
                  item.accepted_alternatives,
                  (values) => update({ accepted_alternatives: values }),
                  "+ Add alternative",
                  "Accepted alternative",
                )}
                <label className={microLabelClass}>Accepted Alternatives</label>
              </div>

              <div className="pl-2 border-l-2 border-shodo-mist">
                <ArrayFieldEditor
                  label="Learnable Terms"
                  items={item.learnableTerms || []}
                  onChange={(terms) => update({ learnableTerms: terms })}
                  emptyItem={() => ({ term: "", surfaceForm: "", reading: "", meaning: "" })}
                  addLabel="+ Add term"
                  renderRow={(term, _ti, updateTerm) => (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={microLabelClass}>Term</label>
                        <input type="text" className={inputClass} value={term.term} onChange={(e) => updateTerm({ term: e.target.value })} />
                      </div>
                      <div>
                        <label className={microLabelClass}>Surface Form</label>
                        <input type="text" className={inputClass} value={term.surfaceForm} onChange={(e) => updateTerm({ surfaceForm: e.target.value })} />
                      </div>
                      <div>
                        <label className={microLabelClass}>Reading</label>
                        <input type="text" className={inputClass} value={term.reading} onChange={(e) => updateTerm({ reading: e.target.value })} />
                      </div>
                      <div>
                        <label className={microLabelClass}>Meaning</label>
                        <input type="text" className={inputClass} value={term.meaning} onChange={(e) => updateTerm({ meaning: e.target.value })} />
                      </div>
                    </div>
                  )}
                />
              </div>
            </div>
          )}
        />
      </div>
    </div>
  );
}
