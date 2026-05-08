"use client";

import { useState, useEffect, useCallback } from "react";
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
  const classification = data?.classification as { structuralCategory?: string; expressiveFunctions?: string[] } | undefined;

  let preview = "";
  if (ku.type === "Vocab" || ku.type === "Kanji") {
    const reading = ku.data?.reading as string | undefined;
    const def = (ku.data?.definition || ku.data?.meaning) as string | undefined;
    preview = [reading, def].filter(Boolean).join(" · ");
  } else if (ku.type === "Grammar") {
    preview = (ku.data?.title || ku.data?.explanation || "") as string;
    if (preview.length > 80) preview = preview.slice(0, 80) + "…";
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-shodo-mist hover:bg-shodo-paper-warm transition-colors">
      <span className="text-base font-medium text-shodo-ink w-40 shrink-0 truncate">
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

      {ku.type === "Grammar" && !classification && (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 shrink-0">
          unclassified
        </span>
      )}

      {classification?.structuralCategory && (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 shrink-0">
          {classification.structuralCategory}
        </span>
      )}

      {classification?.expressiveFunctions?.[0] && (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 shrink-0">
          {classification.expressiveFunctions[0]}
        </span>
      )}

      <span className="text-xs text-shodo-ink-light truncate flex-1 min-w-0">
        {preview}
      </span>

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

  const [filterType, setFilterType] = useState("");
  const [filterLevel, setFilterLevel] = useState("");

  const [editTarget, setEditTarget] = useState<KnowledgeUnit | null>(null);

  const fetchKus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterType) params.set("type", filterType);
      if (filterLevel) params.set("jlptLevel", filterLevel);
      const res = await apiFetch(`/api/knowledge-units/get-all?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setKus(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filterType, filterLevel]);

  useEffect(() => {
    fetchKus();
  }, [fetchKus]);

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
  };

  const selectClass = "px-3 py-1.5 text-sm border border-shodo-mist rounded bg-white text-shodo-ink focus:outline-none focus:border-shodo-indigo";

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-shodo-ink mb-6">Global Knowledge Units</h1>

      {/* Filters */}
      <div className="flex gap-3 items-center mb-4">
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className={selectClass}>
          <option value="">All types</option>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)} className={selectClass}>
          <option value="">All levels</option>
          {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>

        {(filterType || filterLevel) && (
          <button
            onClick={() => { setFilterType(""); setFilterLevel(""); }}
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
