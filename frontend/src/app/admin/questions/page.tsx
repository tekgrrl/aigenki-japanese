"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import AiQuestionView from "@/components/review/AiQuestionView";

/** A question as GET /api/questions/admin returns it (see QuestionsAdminService.list). */
interface AdminQuestion {
  id: string;
  kuId: string;
  word: { content: string; type: string } | null;
  usageLabel?: string;
  kind: string;
  kindGuessed: boolean;
  createdAt: string | null;
  reviewedAt: string | null;
  inUse: number;
  data: { question: string; context?: string; answer: string; acceptedAlternatives?: string[] };
}

const TYPES = ["Vocab", "Grammar", "Concept", "Kanji", "Orphaned"] as const;
const KINDS = [
  "error-correction", "translation", "novel-translation", "fill-in-the-blank",
  "particle", "noun-particle", "conjugation", "other",
] as const;

const TYPE_COLOURS: Record<string, string> = {
  Vocab: "bg-blue-100 text-blue-800",
  Kanji: "bg-purple-100 text-purple-800",
  Grammar: "bg-green-100 text-green-800",
  Concept: "bg-amber-100 text-amber-800",
};

const chip = "text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0";
const button = "px-3 py-1 text-xs font-medium rounded-md border border-shodo-ink/15 text-shodo-ink/70 hover:bg-shodo-ink/5 transition-colors disabled:opacity-50";

export default function AdminQuestionsPage() {
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kuType, setKuType] = useState("");
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // `search`, debounced
  const [showReviewed, setShowReviewed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (kuType) params.set("kuType", kuType);
    if (kind) params.set("kind", kind);
    if (query) params.set("q", query);
    if (!showReviewed) params.set("hideReviewed", "true");
    try {
      const res = await apiFetch(`/api/questions/admin?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setQuestions(await res.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [kuType, kind, query, showReviewed]);

  useEffect(() => { load(); }, [load]);

  // One group per word, each word's questions oldest first (the API sorts by createdAt).
  const groups = useMemo(() => {
    const byKu = new Map<string, AdminQuestion[]>();
    for (const q of questions) byKu.set(q.kuId, [...(byKu.get(q.kuId) ?? []), q]);
    return [...byKu.entries()].sort(([, a], [, b]) =>
      (a[0].word?.content ?? "~").localeCompare(b[0].word?.content ?? "~"),
    );
  }, [questions]);

  return (
    <div className="container mx-auto max-w-5xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-shodo-ink">Questions</h1>
        <p className="text-sm text-shodo-ink/50 mt-1">
          AI-generated questions, grouped by word and oldest first, shown as learners see them. Edits change the
          shared question for every learner. Reviewed questions are hidden unless you tick Show reviewed.
        </p>
      </header>

      <div className="flex flex-wrap gap-3 items-center">
        <select value={kuType} onChange={e => setKuType(e.target.value)} className="border border-shodo-ink/15 rounded-md px-2 py-1.5 text-sm bg-transparent">
          <option value="">All types</option>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={kind} onChange={e => setKind(e.target.value)} className="border border-shodo-ink/15 rounded-md px-2 py-1.5 text-sm bg-transparent">
          <option value="">All kinds</option>
          {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search word or question…"
          className="flex-1 min-w-48 border border-shodo-ink/15 rounded-md px-3 py-1.5 text-sm bg-transparent"
        />
        <label className="flex items-center gap-1.5 text-sm text-shodo-ink/70">
          <input type="checkbox" checked={showReviewed} onChange={e => setShowReviewed(e.target.checked)} />
          Show reviewed
        </label>
        <span className="text-xs text-shodo-ink/50">
          {loading ? "Loading…" : `${questions.length} question${questions.length === 1 ? "" : "s"} · ${groups.length} word${groups.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {error && <p className="text-sm text-red-700">Couldn&apos;t load questions: {error}</p>}

      <div className="space-y-8">
        {groups.map(([kuId, qs]) => (
          <section key={kuId} className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-shodo-ink">
              {qs[0].word ? (
                <>
                  <span>{qs[0].word.content}</span>
                  <span className={`${chip} ${TYPE_COLOURS[qs[0].word.type] ?? "bg-gray-100 text-gray-600"}`}>{qs[0].word.type}</span>
                </>
              ) : (
                <>
                  <span className="text-shodo-ink/50">Deleted word</span>
                  <span className={`${chip} bg-red-100 text-red-800`}>Orphaned</span>
                  <span className="text-xs font-mono text-shodo-ink/40">{kuId}</span>
                </>
              )}
            </h2>
            {qs.map(q => <QuestionCard key={q.id} question={q} onChanged={load} />)}
          </section>
        ))}
      </div>
    </div>
  );
}

function QuestionCard({ question: q, onChanged }: { question: AdminQuestion; onChanged: () => void }) {
  const [mode, setMode] = useState<"view" | "edit" | "reassign" | "confirm-delete">("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (path: string, init: RequestInit) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(path, { headers: { "Content-Type": "application/json" }, ...init });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      setMode("view");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-shodo-ink/10 overflow-hidden">
      <div className="bg-gray-800 p-6">
        <AiQuestionView context={q.data.context} question={q.data.question} />
      </div>

      <div className="px-5 py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-shodo-ink/60">
          <span className={`${chip} ${q.kindGuessed ? "border border-dashed border-shodo-ink/30 text-shodo-ink/60" : "bg-shodo-ink/10 text-shodo-ink"}`}
            title={q.kindGuessed ? "Guessed from the text: this question was made before kinds were stored" : undefined}>
            {q.kind}{q.kindGuessed ? "?" : ""}
          </span>
          {q.createdAt && <span>{q.createdAt.slice(0, 10)}</span>}
          {q.reviewedAt && <span className={`${chip} bg-emerald-100 text-emerald-800`}>reviewed {q.reviewedAt.slice(0, 10)}</span>}
          {q.usageLabel && <span>usage: {q.usageLabel}</span>}
          <span>{q.inUse === 0 ? "not on any card" : `on ${q.inUse} card${q.inUse === 1 ? "" : "s"}`}</span>
        </div>

        {mode !== "edit" && (
          <p className="text-sm text-shodo-ink">
            <span className="text-shodo-ink/50">Answer:</span> {q.data.answer}
            {(q.data.acceptedAlternatives?.length ?? 0) > 0 && (
              <span className="text-shodo-ink/50"> · also accepted: {q.data.acceptedAlternatives!.join(" / ")}</span>
            )}
          </p>
        )}

        {mode === "view" && (
          <div className="flex gap-2 pt-1">
            <button
              className={button}
              disabled={busy}
              onClick={() => run(`/api/questions/admin/${q.id}/reviewed`, { method: "PATCH", body: JSON.stringify({ reviewed: !q.reviewedAt }) })}
            >
              {q.reviewedAt ? "Mark not reviewed" : "Mark reviewed"}
            </button>
            <button className={button} onClick={() => setMode("edit")}>Edit</button>
            <button className={button} onClick={() => setMode("reassign")}>Reassign</button>
            <button className={button} onClick={() => setMode("confirm-delete")}>Delete</button>
          </div>
        )}

        {mode === "edit" && (
          <EditForm
            question={q}
            busy={busy}
            onCancel={() => setMode("view")}
            onSave={body => run(`/api/questions/admin/${q.id}`, { method: "PATCH", body: JSON.stringify(body) })}
          />
        )}

        {mode === "reassign" && (
          <ReassignPicker
            busy={busy}
            onCancel={() => setMode("view")}
            onPick={kuId => run(`/api/questions/admin/${q.id}/reassign`, { method: "POST", body: JSON.stringify({ kuId }) })}
          />
        )}

        {mode === "confirm-delete" && (
          <div className="flex items-center gap-2 pt-1 text-sm">
            <span className="text-shodo-ink">
              Delete this question{q.inUse > 0 ? `? ${q.inUse} card${q.inUse === 1 ? "" : "s"} will get a new question` : "?"}
            </span>
            <button className={button} disabled={busy} onClick={() => run(`/api/questions/admin/${q.id}`, { method: "DELETE" })}>
              {busy ? "Deleting…" : "Delete"}
            </button>
            <button className={button} disabled={busy} onClick={() => setMode("view")}>Cancel</button>
          </div>
        )}

        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </div>
  );
}

function EditForm({ question: q, busy, onSave, onCancel }: {
  question: AdminQuestion;
  busy: boolean;
  onSave: (body: { question: string; context: string; answer: string; acceptedAlternatives: string[] }) => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState(q.data.question);
  const [context, setContext] = useState(q.data.context ?? "");
  const [answer, setAnswer] = useState(q.data.answer);
  const [alternatives, setAlternatives] = useState((q.data.acceptedAlternatives ?? []).join("\n"));
  const field = "w-full border border-shodo-ink/15 rounded-md px-2 py-1.5 text-sm bg-transparent";

  return (
    <div className="space-y-2 pt-1">
      <label className="block text-xs text-shodo-ink/60">Question
        <textarea className={field} rows={2} value={question} onChange={e => setQuestion(e.target.value)} />
      </label>
      <label className="block text-xs text-shodo-ink/60">Context (optional, shown in italics above the question)
        <textarea className={field} rows={2} value={context} onChange={e => setContext(e.target.value)} />
      </label>
      <label className="block text-xs text-shodo-ink/60">Answer
        <input className={field} value={answer} onChange={e => setAnswer(e.target.value)} />
      </label>
      <label className="block text-xs text-shodo-ink/60">Also accepted (one per line)
        <textarea className={field} rows={3} value={alternatives} onChange={e => setAlternatives(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button
          className={button}
          disabled={busy || !question.trim() || !answer.trim()}
          onClick={() => onSave({ question, context, answer, acceptedAlternatives: alternatives.split("\n") })}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button className={button} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ReassignPicker({ busy, onPick, onCancel }: { busy: boolean; onPick: (kuId: string) => void; onCancel: () => void }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ id: string; content: string; type: string }[]>([]);

  useEffect(() => {
    const q = search.trim();
    if (!q) { setResults([]); return; }
    const t = setTimeout(async () => {
      const res = await apiFetch(`/api/knowledge-units/search?q=${encodeURIComponent(q)}`);
      if (res.ok) setResults(await res.json());
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="space-y-2 pt-1">
      <div className="flex gap-2">
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Find the word to move this question to…"
          className="flex-1 border border-shodo-ink/15 rounded-md px-2 py-1.5 text-sm bg-transparent"
        />
        <button className={button} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      {results.length > 0 && (
        <ul className="border border-shodo-ink/10 rounded-md divide-y divide-shodo-ink/10 max-h-56 overflow-y-auto">
          {results.map(ku => (
            <li key={ku.id}>
              <button
                disabled={busy}
                onClick={() => onPick(ku.id)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-shodo-ink/5 flex items-center gap-2 disabled:opacity-50"
              >
                <span className="text-shodo-ink">{ku.content}</span>
                <span className={`${chip} ${TYPE_COLOURS[ku.type] ?? "bg-gray-100 text-gray-600"}`}>{ku.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
