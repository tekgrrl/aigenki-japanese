"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KnowledgeUnit } from "@/types";
import EditKnowledgeUnitModal from "@/components/EditKnowledgeUnitModal";
import { apiFetch } from "@/lib/api-client";

const TYPES = ["Vocab", "Kanji", "Grammar"] as const;
const LEVELS = ["N5", "N4", "N3", "N2", "N1"] as const;

const TYPE_COLOURS: Record<string, string> = {
  Vocab: "bg-blue-100 text-blue-800",
  Kanji: "bg-purple-100 text-purple-800",
  Grammar: "bg-green-100 text-green-800",
};

function KuRow({ ku, onEdit, onDelete }: { ku: KnowledgeUnit; onEdit: () => void; onDelete: () => void }) {
  const data = ku.data as any;
  const level = data?.jlptLevel as string | undefined;
  const wk = data?.wanikaniLevel as number | undefined;

  let preview = "";
  if (ku.type === "Vocab" || ku.type === "Kanji") {
    const reading = ku.data?.reading as string | undefined;
    const def = (ku.data?.definition || ku.data?.meaning) as string | undefined;
    preview = [reading, def].filter(Boolean).join(" · ");
  } else if (ku.type === "Grammar") {
    preview = (ku.data?.title || ku.data?.corpusNotes || "") as string;
    if (preview.length > 80) preview = preview.slice(0, 80) + "…";
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-shodo-mist hover:bg-shodo-paper-warm transition-colors">
      <span title={ku.content} className="text-base font-medium text-shodo-ink w-40 shrink-0 truncate cursor-default">
        {ku.content}
      </span>

      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${TYPE_COLOURS[ku.type] ?? "bg-gray-100 text-gray-600"}`}>
        {ku.type}
      </span>

      {level && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">
          {level}
        </span>
      )}

      {wk && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 shrink-0">
          WK{wk}
        </span>
      )}

      <span className="text-xs text-shodo-ink-light truncate flex-1 min-w-0">
        {preview}
      </span>

      <a
        href={`https://console.cloud.google.com/firestore/databases/aisrs-japanese-dev/data/panel/lessons/${ku.id}?project=gen-lang-client-0878434798`}
        target="_blank"
        rel="noopener noreferrer"
        title="Open lesson in Firestore console"
        className="shrink-0 flex items-center gap-1 text-xs px-3 py-1 rounded border border-shodo-mist text-shodo-ink-light hover:border-orange-400 hover:text-orange-600 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        Lesson
      </a>
      <button
        onClick={onEdit}
        className="shrink-0 text-xs px-3 py-1 rounded border border-shodo-mist text-shodo-ink-light hover:border-shodo-indigo hover:text-shodo-indigo transition-colors"
      >
        Edit
      </button>
      <button
        onClick={onDelete}
        className="shrink-0 text-xs px-3 py-1 rounded border border-shodo-mist text-shodo-ink-light hover:border-red-400 hover:text-red-600 transition-colors"
      >
        Delete
      </button>
    </div>
  );
}

export default function AdminKnowledgeUnitsPage() {
  const [kus, setKus] = useState<KnowledgeUnit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters persist across a round trip through Preview / the full-page lesson editor and
  // back (both navigate away from this page, which otherwise fully remounts on return).
  // Loaded/saved in effects rather than a useState lazy initializer — reading sessionStorage
  // during the initial render would mismatch the server-rendered ("" on the server, since
  // sessionStorage doesn't exist there) and client-hydrated output.
  const [filterType, setFilterType] = useState("");
  const [filterLevel, setFilterLevel] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // False until the sessionStorage load below has applied. Gates both the persist effect
  // (so it doesn't clobber storage with the pre-load "" defaults) and the fetch effect (so
  // no fetch fires with the pre-load "" filters at all — an earlier version let that fetch
  // fire anyway on a 0ms timer, racing the correctly-filtered one; whichever response landed
  // last won, which could leave the list unfiltered even though the dropdowns were correct).
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setFilterType(sessionStorage.getItem("kuListFilterType") ?? "");
    setFilterLevel(sessionStorage.getItem("kuListFilterLevel") ?? "");
    setSearchQuery(sessionStorage.getItem("kuListSearchQuery") ?? "");
    setFiltersHydrated(true);
  }, []);

  useEffect(() => {
    if (!filtersHydrated) return;
    sessionStorage.setItem("kuListFilterType", filterType);
    sessionStorage.setItem("kuListFilterLevel", filterLevel);
    sessionStorage.setItem("kuListSearchQuery", searchQuery);
  }, [filterType, filterLevel, searchQuery, filtersHydrated]);

  const [editTarget, setEditTarget] = useState<KnowledgeUnit | null>(null);
  const [backfill, setBackfill] = useState<{ running: boolean; message?: string }>({ running: false });

  // One-off, rerunnable: sets data.kanji on every Vocab KU from its content.
  const runKanjiBackfill = async () => {
    setBackfill({ running: true });
    try {
      const res = await apiFetch("/api/knowledge-units/migrate/vocab-kanji", { method: "POST" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const { updated, unchanged } = await res.json();
      setBackfill({ running: false, message: `Updated ${updated}, unchanged ${unchanged}.` });
    } catch (e) {
      setBackfill({ running: false, message: (e as Error).message });
    }
  };

  const router = useRouter();
  const urlSearchParams = useSearchParams();

  // Reopen the edit modal for a specific KU when returning from its lesson preview
  // (Preview's "Back" link carries ?openEdit=<kuId> for exactly this).
  useEffect(() => {
    const openEditId = urlSearchParams.get("openEdit");
    if (!openEditId) return;
    (async () => {
      try {
        const res = await apiFetch(`/api/knowledge-units/${openEditId}/global`);
        if (res.ok) setEditTarget(await res.json());
      } finally {
        router.replace("/admin/knowledge-units");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchKus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = searchQuery.trim();
      let results: KnowledgeUnit[];
      if (q) {
        const searchParams = new URLSearchParams({ q });
        if (filterType) searchParams.set("type", filterType);
        if (filterLevel) searchParams.set("jlptLevel", filterLevel);
        const res = await apiFetch(`/api/knowledge-units/search?${searchParams}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        results = await res.json();
      } else {
        const params = new URLSearchParams();
        if (filterType) params.set("type", filterType);
        if (filterLevel) params.set("jlptLevel", filterLevel);
        const res = await apiFetch(`/api/knowledge-units/get-all?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        results = await res.json();
      }
      setKus(results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filterType, filterLevel, searchQuery]);

  useEffect(() => {
    if (!filtersHydrated) return;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(fetchKus, searchQuery.trim() ? 300 : 0);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [fetchKus, searchQuery, filtersHydrated]);

  const handleDelete = async (ku: KnowledgeUnit) => {
    if (!confirm(`Delete "${ku.content}" (${ku.type})? This will remove the KU and all associated data.`)) return;
    const res = await apiFetch(`/api/knowledge-units/${ku.id}`, { method: "DELETE" });
    if (!res.ok) {
      alert(`Delete failed: HTTP ${res.status}`);
      return;
    }
    setKus(prev => prev.filter(k => k.id !== ku.id));
  };

  const handleSave = async (id: string, updates: Partial<KnowledgeUnit>) => {
    const res = await apiFetch(`/api/knowledge-units/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Save failed: HTTP ${res.status}`);
    setKus(prev => prev.map(k => k.id === id ? { ...k, ...updates } as KnowledgeUnit : k));
    // Refresh editTarget too — the modal stays open after saving, and its hasChanges()
    // check compares against this prop, which would otherwise still be the pre-save value.
    setEditTarget(prev => prev && prev.id === id ? { ...prev, ...updates } as KnowledgeUnit : prev);
  };

  const selectClass = "px-3 py-1.5 text-sm border border-shodo-mist rounded bg-white dark:bg-shodo-paper-warm text-shodo-ink focus:outline-none focus:border-shodo-indigo";

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-shodo-ink mb-2">Global Knowledge Units</h1>
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={runKanjiBackfill}
          disabled={backfill.running}
          className="rounded border border-shodo-ink/20 px-3 py-1 text-xs font-semibold text-shodo-ink disabled:opacity-40"
        >
          {backfill.running ? "Backfilling…" : "Backfill word kanji"}
        </button>
        {backfill.message && <span className="text-xs text-shodo-ink-light">{backfill.message}</span>}
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center mb-4">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by content…"
          className="px-3 py-1.5 text-sm border border-shodo-mist rounded bg-white dark:bg-shodo-paper-warm text-shodo-ink placeholder-shodo-ink-light focus:outline-none focus:border-shodo-indigo w-64"
        />

        <select value={filterType} onChange={e => setFilterType(e.target.value)} className={selectClass}>
          <option value="">All types</option>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)} className={selectClass}>
          <option value="">All levels</option>
          {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>

        {(filterType || filterLevel || searchQuery) && (
          <button
            onClick={() => { setFilterType(""); setFilterLevel(""); setSearchQuery(""); }}
            className="text-xs text-shodo-ink-light hover:text-shodo-stamp-red transition-colors"
          >
            Clear
          </button>
        )}

        <span className="ml-auto text-xs text-shodo-ink-light">
          {loading ? "Loading…" : `${kus.length} results`}
        </span>
      </div>

      {/* List */}
      <div className="border border-shodo-mist rounded-lg overflow-hidden bg-shodo-paper">
        {error && (
          <div className="px-4 py-3 text-sm text-red-700 bg-red-50">{error}</div>
        )}

        {!loading && !error && kus.length === 0 && (
          <div className="px-4 py-8 text-center text-shodo-ink-light text-sm">
            No results — try adjusting the filters.
          </div>
        )}

        {kus.map(ku => (
          <KuRow key={ku.id} ku={ku} onEdit={() => setEditTarget(ku)} onDelete={() => handleDelete(ku)} />
        ))}
      </div>

      <EditKnowledgeUnitModal
        isOpen={editTarget !== null}
        knowledgeUnit={editTarget}
        onClose={() => setEditTarget(null)}
        onSave={handleSave}
      />
    </div>
  );
}
