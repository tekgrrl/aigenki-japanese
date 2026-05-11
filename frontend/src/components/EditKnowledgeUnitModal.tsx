"use client";

import React, { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  KnowledgeUnit,
  GrammarClassification,
  GrammarProductionType,
  GrammarStructuralCategory,
  ExpressiveFunction,
  ExpressiveDomain,
  EXPRESSIVE_FUNCTIONS_BY_DOMAIN,
} from "@/types";

interface EditKnowledgeUnitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, updates: Partial<KnowledgeUnit>) => Promise<void>;
  knowledgeUnit: KnowledgeUnit | null;
}

const STRUCTURAL_CATEGORIES: { value: GrammarStructuralCategory; label: string }[] = [
  { value: "inflectional", label: "Inflectional" },
  { value: "particle", label: "Particle" },
  { value: "syntactic", label: "Syntactic" },
  { value: "derivational", label: "Derivational" },
  { value: "numerical", label: "Numerical" },
  { value: "modal", label: "Modal" },
  { value: "aspectual", label: "Aspectual" },
  { value: "discourse", label: "Discourse" },
  { value: "comparative", label: "Comparative" },
  { value: "speech-act", label: "Speech-act" },
  { value: "honorific", label: "Honorific" },
  { value: "pragmatic", label: "Pragmatic" },
];

const DOMAIN_LABELS: Record<ExpressiveDomain, string> = {
  "describing-the-world": "Describing the world",
  "expressing-the-mind": "Expressing the mind",
  "acting-in-the-world": "Acting in the world",
  "connecting-ideas": "Connecting ideas",
  "managing-conversation": "Managing conversation",
};

const DOMAINS: ExpressiveDomain[] = [
  "describing-the-world",
  "expressing-the-mind",
  "acting-in-the-world",
  "connecting-ideas",
  "managing-conversation",
];

const emptyClassification = (): GrammarClassification => ({
  productionType: "compositional",
  structuralCategory: "inflectional",
  expressiveFunctions: [],
});

export default function EditKnowledgeUnitModal({
  isOpen,
  onClose,
  onSave,
  knowledgeUnit,
}: EditKnowledgeUnitModalProps) {
  const [content, setContent] = useState("");
  const [reading, setReading] = useState("");
  const [definition, setDefinition] = useState("");
  const [jlptLevel, setJlptLevel] = useState("");
  const [wanikaniLevel, setWanikaniLevel] = useState<number | "">("");
  const [grammarTitle, setGrammarTitle] = useState("");
  const [grammarNotes, setGrammarNotes] = useState("");
  const [initialGrammarNotes, setInitialGrammarNotes] = useState("");
  const [grammarCorpusNotes, setGrammarCorpusNotes] = useState("");
  const [classification, setClassification] = useState<GrammarClassification>(emptyClassification());
  const [hasClassification, setHasClassification] = useState(false);
  const [corpusNotes, setCorpusNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (knowledgeUnit) {
      setContent(knowledgeUnit.content || "");
      if (knowledgeUnit.type === "Vocab" || knowledgeUnit.type === "Kanji") {
        setReading(knowledgeUnit.data?.reading || "");
        setDefinition(knowledgeUnit.data?.definition || knowledgeUnit.data?.meaning || "");
        setJlptLevel(knowledgeUnit.data?.jlptLevel || "");
        setWanikaniLevel(knowledgeUnit.data?.wanikaniLevel || "");
        setGrammarTitle("");
        setGrammarCorpusNotes("");
        setClassification(emptyClassification());
        setHasClassification(false);
      } else if (knowledgeUnit.type === "Grammar") {
        setGrammarTitle(knowledgeUnit.data?.title || "");
        setGrammarNotes("");
        setInitialGrammarNotes("");
        setGrammarCorpusNotes(knowledgeUnit.data?.corpusNotes || "");
        setJlptLevel(knowledgeUnit.data?.jlptLevel || "");
        const existing = knowledgeUnit.data?.classification;
        if (existing) {
          setClassification(existing);
          setHasClassification(true);
        } else {
          setClassification(emptyClassification());
          setHasClassification(false);
        }
        setReading("");
        setDefinition("");
        setWanikaniLevel("");

        apiFetch(`/api/lessons?kuId=${knowledgeUnit.id}`)
        .then(res => res.ok ? res.json() : null).then(lesson => {
          if (lesson?.notes) {
            setGrammarNotes(lesson.notes);
            setInitialGrammarNotes(lesson.notes);
          }
        }).catch(() => {});
      } else {
        setReading("");
        setDefinition("");
        setJlptLevel("");
        setWanikaniLevel("");
        setGrammarTitle("");
        setGrammarNotes("");
        setInitialGrammarNotes("");
        setGrammarCorpusNotes("");
        setClassification(emptyClassification());
        setHasClassification(false);
      }
      setCorpusNotes(knowledgeUnit.data?.corpusNotes || "");
    }
  }, [knowledgeUnit]);

  if (!isOpen || !knowledgeUnit) return null;

  const toggleExpressiveFunction = (fn: ExpressiveFunction) => {
    setClassification(prev => ({
      ...prev,
      expressiveFunctions: prev.expressiveFunctions.includes(fn)
        ? prev.expressiveFunctions.filter(f => f !== fn)
        : [...prev.expressiveFunctions, fn],
    }));
    if (!hasClassification) setHasClassification(true);
  };

  const hasChanges = () => {
    if (!knowledgeUnit) return false;
    if (knowledgeUnit.type === "Vocab" || knowledgeUnit.type === "Kanji") {
      return (
        content !== knowledgeUnit.content ||
        reading !== (knowledgeUnit.data?.reading || "") ||
        definition !== (knowledgeUnit.data?.definition || "") ||
        jlptLevel !== (knowledgeUnit.data?.jlptLevel || "") ||
        wanikaniLevel !== (knowledgeUnit.data?.wanikaniLevel || "") ||
        corpusNotes !== (knowledgeUnit.data?.corpusNotes || "")
      );
    }
    if (knowledgeUnit.type === "Grammar") {
      const origClass = knowledgeUnit.data?.classification;
      const classChanged = hasClassification !== !!origClass ||
        (hasClassification && (
          classification.productionType !== origClass?.productionType ||
          classification.structuralCategory !== origClass?.structuralCategory ||
          JSON.stringify(classification.expressiveFunctions) !== JSON.stringify(origClass?.expressiveFunctions)
        ));
      return (
        content !== knowledgeUnit.content ||
        grammarTitle !== (knowledgeUnit.data?.title || "") ||
        grammarNotes !== initialGrammarNotes ||
        grammarCorpusNotes !== (knowledgeUnit.data?.corpusNotes || "") ||
        jlptLevel !== (knowledgeUnit.data?.jlptLevel || "") ||
        classChanged
      );
    }
    return content !== knowledgeUnit.content;
  };

  const handleSave = async () => {
    if (!hasChanges()) return;

    setIsSaving(true);
    try {
      let updates: Partial<KnowledgeUnit>;
      if (knowledgeUnit!.type === "Grammar") {
        updates = {
          content,
          data: {
            ...knowledgeUnit!.data,
            title: grammarTitle,
            corpusNotes: grammarCorpusNotes,
            jlptLevel: jlptLevel || null,
            classification: hasClassification ? classification : null,
          },
        };
      } else {
        updates = {
          content,
          data: {
            ...knowledgeUnit!.data,
            reading,
            definition,
            jlptLevel: jlptLevel !== "" ? jlptLevel : null,
            wanikaniLevel: wanikaniLevel !== "" ? Number(wanikaniLevel) : null,
            corpusNotes: corpusNotes || undefined,
          },
        };
      }
      await onSave(knowledgeUnit!.id, updates);

      if (knowledgeUnit!.type === "Grammar" && grammarNotes !== initialGrammarNotes) {
        await apiFetch(`/api/lessons/${knowledgeUnit!.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section: "notes", content: grammarNotes }),
        });
      }

      onClose();
    } catch (error) {
      console.error("Failed to save changes", error);
    } finally {
      setIsSaving(false);
    }
  };

  const inputClass = "w-full px-3 py-2 bg-white border border-shodo-mist rounded text-gray-900 focus:outline-none focus:border-shodo-indigo";
  const labelClass = "block text-xs font-bold text-shodo-ink-light uppercase tracking-wide mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-shodo-paper w-full max-w-2xl rounded-lg shadow-xl border border-shodo-ink-light overflow-hidden">
        {/* Header */}
        <div className="bg-shodo-paper-dark px-6 py-4 border-b border-shodo-mist flex justify-between items-center">
          <h2 className="text-xl font-bold text-shodo-ink font-sans">
            Edit Knowledge Unit
          </h2>
          <button
            onClick={onClose}
            className="text-shodo-ink-light hover:text-shodo-stamp-red transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto max-h-[80vh]">
          {/* Metadata Row */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className={labelClass}>Type</label>
              <div className="px-3 py-2 bg-shodo-mist rounded text-shodo-ink-light font-mono text-sm">
                {knowledgeUnit.type}
              </div>
            </div>
            <div className="flex-[2]">
              <label className={labelClass}>ID</label>
              <div className="px-3 py-2 bg-shodo-mist rounded text-shodo-ink-light font-mono text-xs truncate">
                {knowledgeUnit.id}
              </div>
            </div>
          </div>

          {/* Content */}
          <div>
            <label className={labelClass}>Content</label>
            <input
              type="text"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className={`${inputClass} text-lg`}
            />
          </div>

          {/* Vocab / Kanji Fields */}
          {(knowledgeUnit.type === "Vocab" || knowledgeUnit.type === "Kanji") && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Reading</label>
                  <input type="text" value={reading} onChange={(e) => setReading(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Definition</label>
                  <input type="text" value={definition} onChange={(e) => setDefinition(e.target.value)} className={inputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>JLPT Level</label>
                  <select value={jlptLevel} onChange={(e) => setJlptLevel(e.target.value)} className={inputClass}>
                    <option value="">None</option>
                    {["N5","N4","N3","N2","N1"].map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>WaniKani Level</label>
                  <input
                    type="number" min="1" max="60" placeholder="1-60"
                    value={wanikaniLevel}
                    onChange={(e) => setWanikaniLevel(e.target.value === "" ? "" : Number(e.target.value))}
                    className={inputClass}
                  />
                </div>
              </div>
            </>
          )}

          {/* Grammar Fields */}
          {knowledgeUnit.type === "Grammar" && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Title</label>
                  <input type="text" value={grammarTitle} onChange={(e) => setGrammarTitle(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>JLPT Level</label>
                  <select value={jlptLevel} onChange={(e) => setJlptLevel(e.target.value)} className={inputClass}>
                    <option value="">None</option>
                    {["N5","N4","N3","N2","N1"].map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelClass}>Notes</label>
                <textarea
                  rows={4}
                  value={grammarNotes}
                  onChange={(e) => setGrammarNotes(e.target.value)}
                  className={`${inputClass} resize-none`}
                  placeholder="Nuance, register, common mistakes, contrast with similar patterns…"
                />
              </div>

              <div>
                <label className={labelClass}>Corpus Notes</label>
                <textarea
                  rows={4}
                  value={grammarCorpusNotes}
                  onChange={(e) => setGrammarCorpusNotes(e.target.value)}
                  className={`${inputClass} resize-none`}
                />
              </div>

              {/* Classification */}
              <div className="border border-shodo-mist rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-shodo-ink-light uppercase tracking-wide">
                    Classification
                  </span>
                  {!hasClassification && (
                    <span className="text-[10px] text-shodo-ink-light italic">not yet classified</span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Production Type</label>
                    <select
                      value={classification.productionType}
                      onChange={(e) => {
                        setClassification(prev => ({ ...prev, productionType: e.target.value as GrammarProductionType }));
                        setHasClassification(true);
                      }}
                      className={inputClass}
                    >
                      <option value="compositional">Compositional</option>
                      <option value="constructional">Constructional</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Structural Category</label>
                    <select
                      value={classification.structuralCategory}
                      onChange={(e) => {
                        setClassification(prev => ({ ...prev, structuralCategory: e.target.value as GrammarStructuralCategory }));
                        setHasClassification(true);
                      }}
                      className={inputClass}
                    >
                      {STRUCTURAL_CATEGORIES.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Expressive Functions</label>
                  <div className="space-y-2 mt-1">
                    {DOMAINS.map(domain => (
                      <div key={domain}>
                        <div className="text-[10px] font-semibold text-shodo-ink-light uppercase tracking-wider mb-1">
                          {DOMAIN_LABELS[domain]}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {EXPRESSIVE_FUNCTIONS_BY_DOMAIN[domain].map(fn => {
                            const active = classification.expressiveFunctions.includes(fn);
                            const isPrimary = classification.expressiveFunctions[0] === fn;
                            return (
                              <button
                                key={fn}
                                type="button"
                                onClick={() => toggleExpressiveFunction(fn)}
                                className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                                  active
                                    ? isPrimary
                                      ? "bg-shodo-indigo text-white border-shodo-indigo"
                                      : "bg-shodo-indigo/20 text-shodo-indigo border-shodo-indigo"
                                    : "bg-white text-shodo-ink-light border-shodo-mist hover:border-shodo-indigo hover:text-shodo-indigo"
                                }`}
                              >
                                {fn}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  {classification.expressiveFunctions.length > 0 && (
                    <p className="text-[10px] text-shodo-ink-light mt-1.5">
                      Primary: <span className="font-semibold">{classification.expressiveFunctions[0]}</span>
                      {classification.expressiveFunctions.length > 1 && ` · ${classification.expressiveFunctions.length - 1} secondary`}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Corpus Notes — Vocab/Kanji only (Grammar has its own field above) */}
          {(knowledgeUnit.type === "Vocab" || knowledgeUnit.type === "Kanji") && (
            <div>
              <label className="block text-xs font-bold text-shodo-ink-light uppercase tracking-wide mb-1 flex items-center gap-2">
                Corpus Notes
                <span className="text-[10px] bg-shodo-indigo text-white px-1.5 py-0.5 rounded-full font-normal normal-case">
                  AI Context
                </span>
              </label>
              <p className="text-xs text-shodo-ink-light mb-2">
                Context for the AI lesson generator (e.g., "Focus on polite forms", "Medical terminology").
              </p>
              <textarea
                rows={2}
                value={corpusNotes}
                onChange={(e) => setCorpusNotes(e.target.value)}
                className={`${inputClass} resize-none`}
                placeholder="Context instructions for Gemini..."
              />
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-shodo-paper-dark border-t border-shodo-mist flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-shodo-ink-light hover:text-shodo-ink hover:bg-shodo-mist transition-colors font-medium text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges() || isSaving}
            className={`px-4 py-2 rounded text-white font-medium text-sm shadow-sm transition-all
              ${hasChanges() && !isSaving
                ? "bg-red-600 hover:bg-red-700 hover:shadow-md transform hover:-translate-y-0.5"
                : "bg-gray-400 cursor-not-allowed"
              }`}
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
