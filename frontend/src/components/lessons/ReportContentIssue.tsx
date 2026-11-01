"use client";

import { useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { apiFetch } from "@/lib/api-client";
import type { Lesson, VocabLesson, GrammarLesson, KanjiLesson } from "@/types";

const CATEGORIES = [
  "Above level",
  "Unnatural Japanese",
  "Wrong translation/meaning",
  "Bad sentence fragments",
  "Other",
] as const;

interface Props {
  kuId: string;
  kuContent: string;
  /** The lesson being viewed — its example sentences become the "Which part?" options. */
  lesson?: Lesson | null;
  /** "light" for paper-background lesson panels, "dark" for the gray review/debug UI. */
  tone?: "light" | "dark";
}

/** The headword of a lesson (word, kanji or grammar pattern), for labelling a report. */
export function lessonLabel(lesson?: Lesson | null): string | undefined {
  if (!lesson) return undefined;
  if (lesson.type === "Vocab") return (lesson as VocabLesson).vocab;
  if (lesson.type === "Kanji") return (lesson as KanjiLesson).kanji;
  if (lesson.type === "Grammar") return (lesson as GrammarLesson).pattern;
  return undefined;
}

function exampleSentences(lesson?: Lesson | null): string[] {
  if (!lesson) return [];
  if (lesson.type === "Vocab") {
    return ((lesson as VocabLesson).context_examples ?? []).map((e) => e.sentence).filter(Boolean);
  }
  if (lesson.type === "Grammar") {
    return ((lesson as GrammarLesson).examples ?? []).map((e) => e.japanese).filter(Boolean);
  }
  return [];
}

/**
 * Admin-only, in-context content-quality report. Everything the system already knows
 * (KU id/content, the user's level) is sent or filled in server-side — the reporter only
 * picks the offending part, a category, and optionally writes a note.
 */
export default function ReportContentIssue({ kuId, kuContent, lesson, tone = "light" }: Props) {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [segment, setSegment] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  if (!isAdmin) return null;

  const sentences = exampleSentences(lesson);
  const canSubmit = (!!category || note.trim() !== "") && status !== "sending";
  const dark = tone === "dark";

  const reset = () => {
    setOpen(false);
    setSegment("");
    setCategory(null);
    setNote("");
    setStatus("idle");
  };

  const submit = async () => {
    if (!canSubmit) return;
    setStatus("sending");
    try {
      const res = await apiFetch("/api/content-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: "lesson",
          sourceId: kuId,
          kuId,
          kuContent,
          manualNote: note.trim(),
          ...(segment ? { quotedSegment: segment } : {}),
          ...(category ? { category } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Flag request failed (${res.status})`);
      setStatus("done");
      setTimeout(reset, 2000);
    } catch (err) {
      console.error("[ReportContentIssue] failed", err);
      setStatus("error");
    }
  };

  const linkCls = dark ? "text-gray-400 hover:text-gray-200" : "text-shodo-ink-faint hover:text-shodo-ink";

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`text-xs transition-colors ${linkCls}`}>
        ⚑ Report issue
      </button>
    );
  }

  const panelCls = dark
    ? "border-gray-600 bg-gray-900 text-gray-300"
    : "border-shodo-ink/15 bg-shodo-paper-warm text-shodo-ink";
  const fieldCls = dark
    ? "bg-gray-800 border-gray-600 text-gray-200 placeholder-gray-500"
    : "bg-white dark:bg-shodo-paper-warm border-shodo-ink/15 text-shodo-ink placeholder-shodo-ink-faint";
  const chipCls = (active: boolean) =>
    active
      ? "bg-shodo-ink text-shodo-paper border-shodo-ink"
      : dark
        ? "border-gray-600 text-gray-300 hover:border-gray-400"
        : "border-shodo-ink/20 text-shodo-ink-light hover:border-shodo-ink/50";

  return (
    <div className={`mt-2 w-full rounded-lg border p-4 space-y-3 text-sm text-left ${panelCls}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">
          Report an issue with <span className="font-semibold">{kuContent}</span>
        </p>
        <button type="button" onClick={reset} className={`text-xs ${linkCls}`} aria-label="Close report">
          ✕
        </button>
      </div>

      {status === "done" ? (
        <p className={dark ? "text-green-300" : "text-shodo-matcha"}>Reported. Thanks.</p>
      ) : (
        <>
          {sentences.length > 0 && (
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wider opacity-70">Which part?</span>
              <select
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                className={`w-full rounded-md border p-2 text-sm ${fieldCls}`}
              >
                <option value="">Whole lesson</option>
                {sentences.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="space-y-1">
            <span className="text-xs uppercase tracking-wider opacity-70">What&apos;s wrong?</span>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(category === c ? null : c)}
                  className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${chipCls(category === c)}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={category ? "Anything to add? (optional)" : "What's wrong with this content?"}
            rows={2}
            className={`w-full rounded-md border p-2 text-sm focus:outline-none focus:ring-1 focus:ring-shodo-indigo ${fieldCls}`}
          />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="px-3 py-1.5 bg-shodo-ink hover:bg-shodo-ink/80 disabled:opacity-40 text-shodo-paper text-xs font-medium rounded-md transition-colors"
            >
              {status === "sending" ? "Reporting…" : "Report"}
            </button>
            {status === "error" && (
              <span className={`text-xs ${dark ? "text-red-300" : "text-shodo-stamp-red"}`}>
                Couldn&apos;t send — check the backend console.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
