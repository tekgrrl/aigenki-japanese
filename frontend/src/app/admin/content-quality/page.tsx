"use client";

import { useState, useEffect, useCallback } from "react";
import { ContentFlag } from "@/types";
import { apiFetch } from "@/lib/api-client";

type TabKey = "open" | "resolved";

export default function ContentQualityPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("open");
  const [flags, setFlags] = useState<ContentFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [dismissNote, setDismissNote] = useState<Record<string, string>>({});
  const [showCreateForm, setShowCreateForm] = useState(false);

  const fetchFlags = useCallback(async (status: TabKey) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/content-flags?status=${status}`);
      if (!res.ok) throw new Error("Failed to fetch flags");
      setFlags(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFlags(activeTab);
  }, [activeTab, fetchFlags]);

  const handleRegenerate = async (flag: ContentFlag) => {
    if (!flag.id) return;
    setActioningId(flag.id);
    try {
      const res = flag.sourceType === "scenario"
        ? await apiFetch(`/api/scenarios/regenerate-from-flag/${flag.id}`, { method: "POST" })
        : await apiFetch(`/api/lessons/regenerate/${flag.kuId}`, { method: "POST" });
      if (!res.ok) throw new Error("Regeneration failed");
      await fetchFlags(activeTab);
    } catch (err) {
      console.error(err);
      alert("Regeneration failed — check logs.");
    } finally {
      setActioningId(null);
    }
  };

  const handleUpdateFlag = async (flagId: string, status: "resolved" | "dismissed") => {
    setActioningId(flagId);
    try {
      const body: Record<string, string> = { status };
      if (status === "dismissed" && dismissNote[flagId]) {
        body.dismissNote = dismissNote[flagId];
      }
      const res = await apiFetch(`/api/content-flags/${flagId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Update failed");
      setFlags((prev) => prev.filter((f) => f.id !== flagId));
    } catch (err) {
      console.error(err);
    } finally {
      setActioningId(null);
    }
  };

  const handleFlagCreated = () => {
    setShowCreateForm(false);
    fetchFlags("open");
    setActiveTab("open");
  };

  const tabClass = (tab: TabKey) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      activeTab === tab
        ? "border-shodo-ink text-shodo-ink"
        : "border-transparent text-shodo-ink/40 hover:text-shodo-ink/70"
    }`;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-shodo-ink">Content Quality</h1>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="px-3 py-1.5 text-sm bg-shodo-ink text-shodo-paper rounded hover:opacity-80 transition-opacity"
        >
          {showCreateForm ? "Cancel" : "Flag Content"}
        </button>
      </div>

      {showCreateForm && (
        <CreateFlagForm onCreated={handleFlagCreated} />
      )}

      <div className="flex border-b border-shodo-ink/10 mb-6">
        <button className={tabClass("open")} onClick={() => setActiveTab("open")}>
          Open Flags
        </button>
        <button className={tabClass("resolved")} onClick={() => setActiveTab("resolved")}>
          Resolved
        </button>
      </div>

      {loading ? (
        <p className="text-shodo-ink/50 text-sm">Loading...</p>
      ) : flags.length === 0 ? (
        <p className="text-shodo-ink/50 text-sm">No {activeTab} flags.</p>
      ) : (
        <div className="space-y-4">
          {flags.map((flag) => (
            <FlagRow
              key={flag.id}
              flag={flag}
              isOpen={activeTab === "open"}
              actioning={actioningId === flag.id}
              dismissNote={dismissNote[flag.id!] ?? ""}
              onDismissNoteChange={(note) =>
                setDismissNote((prev) => ({ ...prev, [flag.id!]: note }))
              }
              onRegenerate={() => handleRegenerate(flag)}
              onDismiss={() => handleUpdateFlag(flag.id!, "dismissed")}
              onResolve={() => handleUpdateFlag(flag.id!, "resolved")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create manual flag form
// ---------------------------------------------------------------------------

function CreateFlagForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    sourceType: "lesson" as "lesson" | "scenario",
    sourceId: "",
    kuContent: "",
    userLevel: "N4",
    manualNote: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.sourceId || !form.kuContent || !form.manualNote) {
      setError("All fields are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/content-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed to create flag");
      onCreated();
    } catch (err) {
      console.error(err);
      setError("Failed to create flag.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full text-sm border border-shodo-ink/20 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-shodo-ink/30";
  const labelClass = "block text-xs font-medium text-shodo-ink/60 mb-1";

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 p-4 border border-shodo-ink/10 rounded-lg bg-shodo-paper/50 space-y-3"
    >
      <p className="text-sm font-medium text-shodo-ink">Flag content for review</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Source type</label>
          <select
            value={form.sourceType}
            onChange={(e) => setForm((f) => ({ ...f, sourceType: e.target.value as "lesson" | "scenario" }))}
            className={inputClass}
          >
            <option value="lesson">Lesson</option>
            <option value="scenario">Scenario</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>User level</label>
          <select
            value={form.userLevel}
            onChange={(e) => setForm((f) => ({ ...f, userLevel: e.target.value }))}
            className={inputClass}
          >
            {["N5", "N4", "N3", "N2", "N1"].map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>
          {form.sourceType === "lesson" ? "KU ID (lesson document ID)" : "Scenario ID"}
        </label>
        <input
          type="text"
          value={form.sourceId}
          onChange={(e) => setForm((f) => ({ ...f, sourceId: e.target.value }))}
          placeholder="Firestore document ID"
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Content label (word, pattern, or scenario title)</label>
        <input
          type="text"
          value={form.kuContent}
          onChange={(e) => setForm((f) => ({ ...f, kuContent: e.target.value }))}
          placeholder="e.g. 食べる or Bookshop Scene"
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Note — describe what needs review</label>
        <textarea
          value={form.manualNote}
          onChange={(e) => setForm((f) => ({ ...f, manualNote: e.target.value }))}
          rows={2}
          placeholder="e.g. Context example uses N2 grammar for an N4 learner"
          className={inputClass}
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="px-4 py-1.5 text-sm bg-shodo-ink text-shodo-paper rounded hover:opacity-80 disabled:opacity-40 transition-opacity"
      >
        {saving ? "Saving..." : "Create Flag"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Flag row
// ---------------------------------------------------------------------------

interface FlagRowProps {
  flag: ContentFlag;
  isOpen: boolean;
  actioning: boolean;
  dismissNote: string;
  onDismissNoteChange: (note: string) => void;
  onRegenerate: () => void;
  onDismiss: () => void;
  onResolve: () => void;
}

function FlagRow({
  flag,
  isOpen,
  actioning,
  dismissNote,
  onDismissNoteChange,
  onRegenerate,
  onDismiss,
  onResolve,
}: FlagRowProps) {
  const [showDismissInput, setShowDismissInput] = useState(false);
  // Category-only in-lesson reports have an empty note but are still manual flags.
  const isManual = !flag.violations.length && (!!flag.manualNote || !!flag.category || !!flag.quotedSegment);
  const canRegenerate = (flag.sourceType === "lesson" && !!flag.kuId) || (flag.sourceType === "scenario" && !!flag.userId);

  return (
    <div className="border border-shodo-ink/10 rounded-lg p-4 bg-white">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-mono text-base text-shodo-ink">{flag.kuContent}</span>
            <span className="text-xs text-shodo-ink/40">JLPT {flag.userLevel}</span>
            <span className="text-xs text-shodo-ink/30 uppercase tracking-wide">{flag.sourceType}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              isManual ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
            }`}>
              {isManual ? "manual" : flag.status}
            </span>
          </div>

          {isManual ? (
            <div className="mt-1 space-y-1">
              {flag.category && (
                <span className="inline-block text-xs px-1.5 py-0.5 rounded border border-shodo-ink/20 text-shodo-ink/70">
                  {flag.category}
                </span>
              )}
              {flag.quotedSegment && (
                <p className="font-mono text-sm text-shodo-ink">「{flag.quotedSegment}」</p>
              )}
              {flag.manualNote && <p className="text-sm text-shodo-ink/70 italic">{flag.manualNote}</p>}
            </div>
          ) : (
            <div className="space-y-1 mt-2">
              {flag.violations.map((v, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-shodo-ink">{v.segment}</span>
                  <span className="text-xs text-shodo-ink/50">→ {v.detectedLevel}</span>
                  <span className="text-xs text-shodo-ink/30 italic">{v.type}</span>
                </div>
              ))}
            </div>
          )}

          {flag.dismissNote && (
            <p className="mt-2 text-xs text-shodo-ink/50 italic">Note: {flag.dismissNote}</p>
          )}

          <p className="mt-1.5 text-xs text-shodo-ink/30 font-mono">{flag.sourceId}</p>
        </div>

        {isOpen && (
          <div className="flex flex-col gap-2 shrink-0">
            {canRegenerate && (
              <button
                onClick={onRegenerate}
                disabled={actioning}
                className="px-3 py-1.5 text-xs bg-shodo-ink text-shodo-paper rounded hover:opacity-80 disabled:opacity-40 transition-opacity"
              >
                {actioning ? "..." : "Regenerate"}
              </button>
            )}
            <button
              onClick={onResolve}
              disabled={actioning}
              className="px-3 py-1.5 text-xs border border-shodo-ink/20 text-shodo-ink rounded hover:bg-shodo-ink/5 disabled:opacity-40 transition-colors"
            >
              Resolve
            </button>
            <button
              onClick={() => setShowDismissInput((v) => !v)}
              disabled={actioning}
              className="px-3 py-1.5 text-xs border border-shodo-ink/10 text-shodo-ink/50 rounded hover:bg-shodo-ink/5 disabled:opacity-40 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {showDismissInput && isOpen && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            placeholder="Reason for dismissal (optional)"
            value={dismissNote}
            onChange={(e) => onDismissNoteChange(e.target.value)}
            className="flex-1 text-xs border border-shodo-ink/20 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-shodo-ink/30"
          />
          <button
            onClick={onDismiss}
            disabled={actioning}
            className="px-3 py-1.5 text-xs bg-shodo-ink/10 text-shodo-ink rounded hover:bg-shodo-ink/20 disabled:opacity-40 transition-colors"
          >
            Confirm
          </button>
        </div>
      )}
    </div>
  );
}
