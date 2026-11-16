"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/providers/AuthProvider";
import { apiFetch } from "@/lib/api-client";
import { KnowledgeUnit, Lesson, VocabLesson, GrammarLesson } from "@/types";
import VocabLessonEditor from "@/components/admin/VocabLessonEditor";
import GrammarLessonEditor from "@/components/admin/GrammarLessonEditor";

const VOCAB_EDITABLE_FIELDS: (keyof VocabLesson)[] = [
  "meaning_explanation",
  "reading_explanation",
  "definitions",
  "context_examples",
  "component_kanji",
  "partOfSpeech",
  "conjugationType",
  "kanaOnly",
];

const GRAMMAR_EDITABLE_FIELDS: (keyof GrammarLesson)[] = ["meaning", "formation", "examples"];

export default function EditLessonPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const params = useParams();
  const kuId = params?.id as string;

  const [ku, setKu] = useState<KnowledgeUnit | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [initialLesson, setInitialLesson] = useState<Lesson | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin || !kuId) return;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [kuRes, lessonRes] = await Promise.all([
          apiFetch(`/api/knowledge-units/${kuId}/global`),
          apiFetch(`/api/lessons?kuId=${kuId}`),
        ]);
        if (!kuRes.ok) throw new Error("Failed to load knowledge unit");
        const kuData = await kuRes.json();
        setKu(kuData);

        if (lessonRes.ok) {
          const lessonData = await lessonRes.json();
          setLesson(lessonData);
          setInitialLesson(lessonData);
        } else {
          setLesson(null);
          setInitialLesson(null);
        }
      } catch (e: any) {
        setError(e.message || "Failed to load lesson");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [isAdmin, kuId]);

  const editableFields = ku?.type === "Grammar" ? GRAMMAR_EDITABLE_FIELDS : VOCAB_EDITABLE_FIELDS;

  const hasChanges = useMemo(() => {
    if (!lesson || !initialLesson) return false;
    return editableFields.some(
      (field) =>
        JSON.stringify((lesson as any)[field]) !== JSON.stringify((initialLesson as any)[field]),
    );
  }, [lesson, initialLesson, editableFields]);

  const handleSave = useCallback(async () => {
    if (!lesson || !ku || !hasChanges) return;
    setIsSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const updates: Record<string, any> = {};
      for (const field of editableFields) {
        updates[field as string] = (lesson as any)[field];
      }
      // "None" is undefined, which JSON drops; send null when a set type was cleared, so the
      // backend removes it from the lesson and the KU.
      if (updates.conjugationType === undefined && (initialLesson as VocabLesson | null)?.conjugationType) {
        updates.conjugationType = null;
      }

      const res = await apiFetch(`/api/lessons/${kuId}/global`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaveMessage("Saved.");
      setInitialLesson(lesson);
    } catch (e: any) {
      setError(e.message || "Save failed");
    } finally {
      setIsSaving(false);
    }
  }, [lesson, initialLesson, ku, kuId, hasChanges, editableFields]);

  if (authLoading) return null;

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center">
        <h1 className="text-xl font-bold text-shodo-ink mb-2">Not authorized</h1>
        <p className="text-shodo-ink-light">This editor is admin-only.</p>
      </div>
    );
  }

  if (isLoading) {
    return <div className="max-w-4xl mx-auto p-8 text-shodo-ink-light">Loading…</div>;
  }

  if (error && !ku) {
    return <div className="max-w-4xl mx-auto p-8 text-shodo-stamp-red">{error}</div>;
  }

  if (!ku) {
    return <div className="max-w-4xl mx-auto p-8 text-shodo-stamp-red">Knowledge unit not found.</div>;
  }

  if (ku.type !== "Vocab" && ku.type !== "Grammar") {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center">
        <h1 className="text-xl font-bold text-shodo-ink mb-2">Not applicable</h1>
        <p className="text-shodo-ink-light">
          The lesson editor only applies to Vocab and Grammar knowledge units.
        </p>
      </div>
    );
  }

  if (!lesson) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center">
        <h1 className="text-xl font-bold text-shodo-ink mb-2">No lesson yet</h1>
        <p className="text-shodo-ink-light">
          This knowledge unit doesn&apos;t have a generated lesson to edit.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/admin/knowledge-units"
            className="text-sm text-shodo-ink-light hover:text-shodo-indigo transition-colors"
          >
            ← Back to Knowledge Units
          </Link>
          <h1 className="text-2xl font-bold text-shodo-ink font-sans mt-1">
            Edit Lesson — {ku.content}
          </h1>
          <p className="text-xs text-shodo-ink-light font-mono">{ku.type} · {kuId}</p>
        </div>
        <div className="flex items-center gap-3">
          {saveMessage && <span className="text-sm text-green-700">{saveMessage}</span>}
          <Link
            href={`/admin/knowledge-units/${kuId}/preview?from=${encodeURIComponent(`/admin/knowledge-units/${kuId}/edit`)}`}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-shodo-ink/20 text-shodo-ink hover:bg-shodo-paper-dark transition-colors"
          >
            Preview
          </Link>
          <button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium text-shodo-paper transition-colors ${
              !hasChanges || isSaving
                ? "bg-shodo-ink/40 cursor-not-allowed"
                : "bg-shodo-ink hover:bg-shodo-ink/80"
            }`}
          >
            {isSaving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-300 text-red-800 px-4 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {ku.type === "Vocab" && (
        <VocabLessonEditor lesson={lesson as VocabLesson} onChange={(next) => setLesson(next)} />
      )}
      {ku.type === "Grammar" && (
        <GrammarLessonEditor lesson={lesson as GrammarLesson} onChange={(next) => setLesson(next)} />
      )}
    </div>
  );
}
