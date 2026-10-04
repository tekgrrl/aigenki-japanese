"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { KnowledgeUnit } from "@/types";

interface EditKnowledgeUnitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, updates: Partial<KnowledgeUnit>) => Promise<void>;
  knowledgeUnit: KnowledgeUnit | null;
}

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
  const [corpusNotes, setCorpusNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const prevKuIdRef = useRef<string | null>(null);

  // The modal stays mounted across opens (parent only toggles isOpen/knowledgeUnit) — clear
  // the "Saved." confirmation whenever it closes, so reopening later (even the same KU, with
  // no new edits) doesn't show a leftover confirmation from a previous session.
  useEffect(() => {
    if (!isOpen) setSaveMessage(null);
  }, [isOpen]);

  useEffect(() => {
    if (knowledgeUnit) {
      // True when this effect fired because the parent refreshed the same KU's prop after a
      // save (see handleSave) rather than because a genuinely different KU was opened.
      const isSameKuRefresh = knowledgeUnit.id === prevKuIdRef.current;
      prevKuIdRef.current = knowledgeUnit.id;

      setContent(knowledgeUnit.content || "");
      if (knowledgeUnit.type === "Vocab" || knowledgeUnit.type === "Kanji") {
        setReading(knowledgeUnit.data?.reading || "");
        setDefinition(knowledgeUnit.data?.definition || knowledgeUnit.data?.meaning || "");
        setJlptLevel(knowledgeUnit.data?.jlptLevel || "");
        setWanikaniLevel(knowledgeUnit.data?.wanikaniLevel || "");
        setGrammarTitle("");
        setGrammarCorpusNotes("");
        setCorpusNotes(knowledgeUnit.data?.corpusNotes || "");
      } else if (knowledgeUnit.type === "Grammar") {
        setGrammarTitle(knowledgeUnit.data?.title || "");
        setGrammarCorpusNotes(knowledgeUnit.data?.corpusNotes || "");
        setJlptLevel(knowledgeUnit.data?.jlptLevel || "");
        setReading("");
        setDefinition("");
        setWanikaniLevel("");
        setCorpusNotes("");

        if (isSameKuRefresh) {
          // Notes were just saved via the PUT in handleSave — grammarNotes already holds
          // the current value. Just re-baseline so hasChanges() reports false, instead of
          // resetting to "" and refetching, which would flash the textarea empty and risk
          // clobbering further edits typed during the async refetch.
          setInitialGrammarNotes(grammarNotes);
        } else {
          setGrammarNotes("");
          setInitialGrammarNotes("");
          apiFetch(`/api/lessons?kuId=${knowledgeUnit.id}`)
          .then(res => res.ok ? res.json() : null).then(lesson => {
            if (lesson?.notes) {
              setGrammarNotes(lesson.notes);
              setInitialGrammarNotes(lesson.notes);
            }
          }).catch(() => {});
        }
      } else {
        setReading("");
        setDefinition("");
        setJlptLevel("");
        setWanikaniLevel("");
        setGrammarTitle("");
        setGrammarNotes("");
        setInitialGrammarNotes("");
        setGrammarCorpusNotes("");
        setCorpusNotes("");
      }
    }
  }, [knowledgeUnit]);

  if (!isOpen || !knowledgeUnit) return null;

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
      return (
        content !== knowledgeUnit.content ||
        grammarTitle !== (knowledgeUnit.data?.title || "") ||
        grammarNotes !== initialGrammarNotes ||
        grammarCorpusNotes !== (knowledgeUnit.data?.corpusNotes || "") ||
        jlptLevel !== (knowledgeUnit.data?.jlptLevel || "")
      );
    }
    return content !== knowledgeUnit.content;
  };

  const handleSave = async () => {
    if (!hasChanges()) return;

    setIsSaving(true);
    setSaveMessage(null);
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

      setSaveMessage("Saved.");
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
                  className={`${inputClass} resize-y`}
                  placeholder="Nuance, register, common mistakes, contrast with similar patterns…"
                />
              </div>

              <div>
                <label className={labelClass}>Corpus Notes</label>
                <textarea
                  rows={4}
                  value={grammarCorpusNotes}
                  onChange={(e) => setGrammarCorpusNotes(e.target.value)}
                  className={`${inputClass} resize-y`}
                />
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
                className={`${inputClass} resize-y`}
                placeholder="Context instructions for Gemini..."
              />
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-shodo-paper-dark border-t border-shodo-mist flex justify-between items-center">
          {(knowledgeUnit.type === "Vocab" || knowledgeUnit.type === "Grammar") ? (
            <div className="flex items-center gap-3">
              <Link
                href={`/admin/knowledge-units/${knowledgeUnit.id}/edit`}
                onClick={onClose}
                className="text-sm text-shodo-indigo hover:text-shodo-indigo/70 transition-colors font-medium"
              >
                Edit lesson →
              </Link>
              <span className="text-shodo-mist">·</span>
              <Link
                href={`/admin/knowledge-units/${knowledgeUnit.id}/preview?from=${encodeURIComponent(`/admin/knowledge-units?openEdit=${knowledgeUnit.id}`)}`}
                onClick={(e) => {
                  if (hasChanges() && !confirm("You have unsaved changes that will be lost. Preview anyway?")) {
                    e.preventDefault();
                    return;
                  }
                  onClose();
                }}
                className="text-sm text-shodo-indigo hover:text-shodo-indigo/70 transition-colors font-medium"
              >
                Preview
              </Link>
            </div>
          ) : <span />}
          <div className="flex items-center gap-3">
          {saveMessage && <span className="text-sm text-green-700">{saveMessage}</span>}
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
    </div>
  );
}
