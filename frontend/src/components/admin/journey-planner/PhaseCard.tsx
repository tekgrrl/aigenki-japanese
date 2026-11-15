"use client";

/**
 * Journey planner: one phase, as a collapsible card. Goals, taught and extra-allowed items, set
 * phrases, the simulation brief, interstitials, passing and unlock rules, and the scenario
 * outlines (pool entries) the phase offers.
 */
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { JourneyPhase, PhaseItems } from "@/types/journey";
import type { PoolEntry, PoolScenarioSummary } from "@/types/scenario";
import { DraftItem, KuListField } from "./KuListField";

export interface DraftItems {
  vocab: DraftItem[];
  grammar: DraftItem[];
}

/** A phase as the planner edits it: items as chips that may not be resolved to KUs yet. */
export type DraftPhase = Omit<JourneyPhase, "taught" | "extraAllowed"> & { taught: DraftItems; extraAllowed: DraftItems };

export const toDraftItems = (items: PhaseItems, names: Record<string, string>): DraftItems => ({
  vocab: items.vocab.map(v => ({ id: v.kuId, text: v.content })),
  grammar: items.grammarKuIds.map(id => ({ id, text: names[id] ?? id })),
});

/** What the backend accepts: resolved Vocab as `{ content, kuId }`, unresolved as words; Grammar as ids or patterns. */
export const toItemsInput = (items: DraftItems) => ({
  vocab: items.vocab.map(i => (i.id ? { content: i.text, kuId: i.id } : i.text)),
  grammar: items.grammar.map(i => i.id ?? i.text),
});

const input = "w-full rounded border border-shodo-ink-faint/50 bg-shodo-paper-dark px-2 py-1 text-sm text-shodo-ink focus:outline-none focus:border-shodo-ink-light";
const label = "block text-xs font-medium text-shodo-ink-light";

export function PhaseCard({ index, count, phase, level, pool, entries, allowed, names, takenElsewhere, onChange, onMove, onRemove }: {
  index: number;
  count: number;
  phase: DraftPhase;
  level: string;
  pool: PoolScenarioSummary[];
  /** Loaded pool entries by id (tags, generated, owner). */
  entries: Record<string, PoolEntry>;
  /** Worked-out allowed items as of the last save (absent for a new phase). */
  allowed?: PhaseItems;
  names: Record<string, string>;
  /** Pool ids already in another phase (this Journey's or another's). */
  takenElsewhere: Set<string>;
  onChange: (change: Partial<DraftPhase>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(index === 0);
  const [seeding, setSeeding] = useState(false);
  const set = onChange;
  const taughtCount = phase.taught.vocab.length + phase.taught.grammar.length;

  /** Fills an empty phase from its scenarios' own goals (for phases made before the planner). */
  const seed = async () => {
    setSeeding(true);
    const loaded: PoolEntry[] = [];
    for (const id of phase.poolIds) {
      const res = await apiFetch(`/api/scenarios/pool/${id}`);
      if (res.ok) loaded.push(await res.json());
    }
    const vocab: DraftItem[] = [];
    const grammar: DraftItem[] = [];
    const phrases: string[] = [];
    for (const e of loaded) {
      for (const v of e.goals?.vocab ?? []) if (!vocab.some(x => x.id === v.kuId)) vocab.push({ id: v.kuId, text: v.content });
      for (const id of e.goals?.grammarKuIds ?? []) if (!grammar.some(x => x.id === id)) grammar.push({ id, text: names[id] ?? id });
      for (const p of e.goals?.setPhrases ?? []) if (!phrases.includes(p)) phrases.push(p);
    }
    set({
      taught: { vocab, grammar },
      setPhrases: phrases,
      goalSummary: phase.goalSummary || loaded.find(e => e.goals?.summary)?.goals?.summary || "",
      simulationBrief: phase.simulationBrief || loaded.find(e => e.simulationBrief)?.simulationBrief || "",
    });
    setSeeding(false);
  };

  const rule = (r: { minStage: number; share: number }, change: (r: { minStage: number; share: number }) => void) => (
    <span className="inline-flex items-center gap-1 text-sm text-shodo-ink">
      <input type="number" min={0} max={100} className={`${input} w-16`} value={Math.round(r.share * 100)}
        onChange={e => change({ ...r, share: Math.min(Math.max(Number(e.target.value) / 100, 0), 1) })} />
      % of taught items at stage
      <input type="number" min={0} max={9} className={`${input} w-14`} value={r.minStage}
        onChange={e => change({ ...r, minStage: Number(e.target.value) })} />
      or above
    </span>
  );

  return (
    <div className="rounded border border-shodo-paper-dark bg-shodo-paper-dark/40">
      <div className="flex items-center gap-2 p-3">
        <button onClick={() => setOpen(o => !o)} className="text-sm text-shodo-ink-light w-4">{open ? "▾" : "▸"}</button>
        <span className="text-sm font-medium text-shodo-ink-light shrink-0">Phase {index + 1}</span>
        <input className={input} placeholder="Phase title" value={phase.title} onChange={e => set({ title: e.target.value })} />
        <span className="text-xs text-shodo-ink-faint shrink-0">{phase.taught.vocab.length} V · {phase.taught.grammar.length} G · {phase.poolIds.length} scenes</span>
        <button onClick={() => onMove(-1)} disabled={index === 0} className="text-sm px-1 disabled:opacity-30" title="Move up">↑</button>
        <button onClick={() => onMove(1)} disabled={index === count - 1} className="text-sm px-1 disabled:opacity-30" title="Move down">↓</button>
        <button onClick={onRemove} className="text-sm px-1 text-shodo-stamp-red" title="Remove phase">×</button>
      </div>

      {open && (
        <div className="space-y-4 border-t border-shodo-paper-dark p-3">
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>Learning goals<textarea className={input} rows={2} value={phase.goalSummary} onChange={e => set({ goalSummary: e.target.value })} /></label>
            <label className={label}>Notes (planner only)<textarea className={input} rows={2} value={phase.notes ?? ""} onChange={e => set({ notes: e.target.value })} /></label>
          </div>

          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h4 className="text-sm font-semibold text-shodo-ink">Taught here</h4>
              {taughtCount === 0 && phase.poolIds.length > 0 && (
                <button onClick={seed} disabled={seeding} className="text-xs text-shodo-indigo disabled:opacity-40">
                  {seeding ? "Seeding…" : "Seed from scenarios"}
                </button>
              )}
            </div>
            {taughtCount === 0 && (
              <p className="text-xs text-shodo-ink-faint">Nothing taught yet: this phase&apos;s scenarios keep their own goals until it is.</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <KuListField label="Vocab" type="Vocab" level={level} items={phase.taught.vocab} onChange={vocab => set({ taught: { ...phase.taught, vocab } })} />
              <KuListField label="Grammar" type="Grammar" level={level} items={phase.taught.grammar} onChange={grammar => set({ taught: { ...phase.taught, grammar } })} />
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-shodo-ink">Allowed (may be used, not taught)</h4>
            <p className="text-xs text-shodo-ink-light">
              From earlier phases and Journeys{allowed ? "" : " (worked out on save)"}:{" "}
              {allowed ? `${allowed.vocab.length} Vocab, ${allowed.grammarKuIds.length} Grammar` : "—"}
              {allowed && allowed.vocab.length + allowed.grammarKuIds.length > 0 && (
                <span className="text-shodo-ink-faint"> · {[...allowed.vocab.map(v => v.content), ...allowed.grammarKuIds.map(id => names[id] ?? id)].slice(0, 30).join("、")}{allowed.vocab.length + allowed.grammarKuIds.length > 30 ? "…" : ""}</span>
              )}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <KuListField label="Extra Vocab" type="Vocab" level={level} items={phase.extraAllowed.vocab} chipClass="border-shodo-indigo/50" onChange={vocab => set({ extraAllowed: { ...phase.extraAllowed, vocab } })} />
              <KuListField label="Extra Grammar" type="Grammar" level={level} items={phase.extraAllowed.grammar} chipClass="border-shodo-indigo/50" onChange={grammar => set({ extraAllowed: { ...phase.extraAllowed, grammar } })} />
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3">
            <label className={label}>Set phrases, one per line
              <textarea className={input} rows={3} value={phase.setPhrases.join("\n")} onChange={e => set({ setPhrases: e.target.value.split("\n") })} />
            </label>
            <label className={label}>Simulation brief (what the role play adds)
              <textarea className={input} rows={3} value={phase.simulationBrief} onChange={e => set({ simulationBrief: e.target.value })} />
            </label>
          </div>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-shodo-ink">Interstitials to teach</h4>
            {phase.interstitials.map((it, ii) => (
              <div key={ii} className="grid grid-cols-[1fr_10rem_1fr_auto] gap-2 items-center">
                <input className={input} placeholder="e.g. Counters for people" value={it.title}
                  onChange={e => set({ interstitials: phase.interstitials.map((x, xi) => (xi === ii ? { ...x, title: e.target.value } : x)) })} />
                <input className={input} placeholder="Concept KU id (optional)" title={it.conceptKuId ? names[it.conceptKuId] ?? "Unknown id" : undefined} value={it.conceptKuId ?? ""}
                  onChange={e => set({ interstitials: phase.interstitials.map((x, xi) => (xi === ii ? { ...x, conceptKuId: e.target.value } : x)) })} />
                <input className={input} placeholder="Notes" value={it.notes ?? ""}
                  onChange={e => set({ interstitials: phase.interstitials.map((x, xi) => (xi === ii ? { ...x, notes: e.target.value } : x)) })} />
                <button onClick={() => set({ interstitials: phase.interstitials.filter((_, xi) => xi !== ii) })} className="text-sm text-shodo-stamp-red px-1">×</button>
              </div>
            ))}
            <button onClick={() => set({ interstitials: [...phase.interstitials, { title: "" }] })} className="text-xs text-shodo-indigo">+ Add interstitial</button>
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-shodo-ink">Passing and unlock</h4>
            <div className="flex flex-wrap items-center gap-2 text-sm text-shodo-ink">
              Pass
              <input type="number" min={1} max={20} className={`${input} w-14`} value={phase.passing.scenarioPasses}
                onChange={e => set({ passing: { ...phase.passing, scenarioPasses: Number(e.target.value) } })} />
              scenario(s), and
              {rule(phase.passing, r => set({ passing: { ...phase.passing, ...r } }))}
            </div>
            <label className="flex items-center gap-2 text-sm text-shodo-ink">
              <input type="checkbox" checked={phase.unlock === "open"} onChange={e => set({ unlock: e.target.checked ? "open" : "after-previous" })} />
              Open with the Journey (otherwise after the previous phase)
            </label>
          </section>

          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h4 className="text-sm font-semibold text-shodo-ink">Scenario outlines</h4>
              <a href="/admin/scenario-pool" target="_blank" rel="noreferrer" className="text-xs text-shodo-indigo">New outline ↗</a>
            </div>
            {phase.poolIds.map(id => {
              const e = entries[id];
              const summary = pool.find(p => p.id === id);
              return (
                <div key={id} className="flex items-center gap-2 rounded border border-shodo-mist bg-shodo-paper px-3 py-2 text-sm">
                  <span className="flex-1 text-shodo-ink">
                    {summary?.title ?? id}
                    {e?.situationTags?.map(t => <span key={t} className="ml-2 rounded-full border border-shodo-indigo px-2 text-xs text-shodo-indigo">{t}</span>)}
                  </span>
                  <span className="text-xs text-shodo-ink-faint">{e ? ((e.dialogue?.length ?? 0) > 0 ? "generated" : "not generated") : ""}</span>
                  <a href={`/admin/scenario-pool?id=${id}`} target="_blank" rel="noreferrer" className="text-xs text-shodo-indigo">Edit outline ↗</a>
                  <button onClick={() => set({ poolIds: phase.poolIds.filter(x => x !== id) })} className="text-shodo-stamp-red px-1" title="Remove from phase">×</button>
                </div>
              );
            })}
            <select
              value=""
              onChange={e => e.target.value && set({ poolIds: [...phase.poolIds, e.target.value] })}
              className={input}
            >
              <option value="">+ Add a scenario outline…</option>
              {pool.filter(p => !phase.poolIds.includes(p.id) && !takenElsewhere.has(p.id)).map(p => (
                <option key={p.id} value={p.id}>{p.title} ({p.difficultyLevel})</option>
              ))}
            </select>
          </section>
        </div>
      )}
    </div>
  );
}
