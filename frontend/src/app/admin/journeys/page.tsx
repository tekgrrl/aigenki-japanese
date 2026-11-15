"use client";

/**
 * Admin: the Journey planner. A Journey is ordered phases; each phase says what it teaches, what
 * its scenarios may also use, its set phrases, simulation brief, interstitials, passing and unlock
 * rules, and which scenario outlines (pool entries) it offers. Saving writes each phase down onto
 * its scenarios, which are generated from it. Learners see Journeys on /journeys.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { Journey, PlannerData } from "@/types/journey";
import type { PoolEntry, PoolScenarioSummary } from "@/types/scenario";
import { DraftPhase, PhaseCard, toDraftItems, toItemsInput } from "@/components/admin/journey-planner/PhaseCard";

type Draft = Omit<Journey, "id" | "phases"> & { id?: string; phases: DraftPhase[] };

const newPhase = (): DraftPhase => ({
  id: `new-${Math.random().toString(36).slice(2)}`,
  title: "",
  goalSummary: "",
  taught: { vocab: [], grammar: [] },
  extraAllowed: { vocab: [], grammar: [] },
  setPhrases: [],
  simulationBrief: "",
  interstitials: [],
  passing: { scenarioPasses: 1, minStage: 3, share: 1 },
  unlock: "after-previous",
  poolIds: [],
});

const blank = (order: number): Draft => ({ title: "", summary: "", difficultyLevel: "N5", order, phases: [newPhase()] });

const toDraft = (j: Journey, names: Record<string, string>): Draft => ({
  ...structuredClone(j),
  phases: j.phases.map(p => ({ ...structuredClone(p), taught: toDraftItems(p.taught, names), extraAllowed: toDraftItems(p.extraAllowed, names) })),
});

const toInput = (d: Draft) => {
  const { id: _id, ...rest } = d;
  return {
    ...rest,
    phases: d.phases.map(p => ({
      ...p,
      id: p.id.startsWith("new-") ? undefined : p.id,
      taught: toItemsInput(p.taught),
      extraAllowed: toItemsInput(p.extraAllowed),
    })),
  };
};

export default function JourneyPlannerPage() {
  const [data, setData] = useState<PlannerData>({ journeys: [], names: {}, allowed: {} });
  const [pool, setPool] = useState<PoolScenarioSummary[]>([]);
  const [entries, setEntries] = useState<Record<string, PoolEntry>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [j, p] = await Promise.all([apiFetch("/api/journeys/admin"), apiFetch("/api/scenarios/pool")]);
    const planner: PlannerData | null = j.ok ? await j.json() : null;
    if (planner) setData(planner);
    if (p.ok) setPool(await p.json());
    return planner;
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Pool entries shown in the draft's phases (tags, generated or not).
  const draftPoolIds = useMemo(() => [...new Set(draft?.phases.flatMap(p => p.poolIds) ?? [])].sort().join(","), [draft]);
  useEffect(() => {
    const missing = draftPoolIds.split(",").filter(id => id && !entries[id]);
    if (!missing.length) return;
    void (async () => {
      const loaded: Record<string, PoolEntry> = {};
      for (const id of missing) {
        const res = await apiFetch(`/api/scenarios/pool/${id}`);
        if (res.ok) loaded[id] = await res.json();
      }
      setEntries(prev => ({ ...prev, ...loaded }));
    })();
  }, [draftPoolIds, entries]);

  const select = (d: Draft) => {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    setDraft(d);
    setDirty(false);
    setStatus(null);
  };

  const change = (c: Partial<Draft>) => { setDraft(d => (d ? { ...d, ...c } : d)); setDirty(true); };
  const changePhase = (i: number, c: Partial<DraftPhase>) =>
    change({ phases: draft!.phases.map((p, pi) => (pi === i ? { ...p, ...c } : p)) });
  const movePhase = (i: number, by: number) => {
    if (!draft || i + by < 0 || i + by >= draft.phases.length) return;
    const phases = [...draft.phases];
    [phases[i], phases[i + by]] = [phases[i + by], phases[i]];
    change({ phases });
  };

  // Pool ids in other Journeys' phases, and in this Journey's other phases.
  const takenByOthers = useMemo(
    () => new Set(data.journeys.filter(j => j.id !== draft?.id).flatMap(j => j.phases.flatMap(p => p.poolIds))),
    [data.journeys, draft?.id],
  );

  const save = async () => {
    if (!draft) return;
    setStatus("Saving…");
    const res = await apiFetch(draft.id ? `/api/journeys/${draft.id}` : "/api/journeys", {
      method: draft.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toInput(draft)),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) return setStatus(`Save failed: ${result.message ?? res.status}`);
    const planner = await load();
    setEntries({}); // goals written down may have cleared generated scenes
    setDraft(toDraft(result, planner?.names ?? data.names));
    setDirty(false);
    setStatus("Saved. Phases written onto their scenarios.");
  };

  const remove = async () => {
    if (!draft?.id || !confirm(`Delete "${draft.title}"? Its scenarios and learners' progress are kept.`)) return;
    const res = await apiFetch(`/api/journeys/${draft.id}`, { method: "DELETE" });
    setStatus(res.ok ? "Deleted." : `Delete failed (${res.status})`);
    if (res.ok) { setDraft(null); setDirty(false); await load(); }
  };

  const input = "w-full rounded border border-shodo-ink-faint/50 bg-shodo-paper-dark px-2 py-1 text-shodo-ink focus:outline-none focus:border-shodo-ink-light";
  const label = "text-xs font-medium text-shodo-ink-light";
  const earlier = draft ? data.journeys.filter(j => j.id !== draft.id && j.order < draft.order) : [];

  return (
    <div className="container mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-bold text-shodo-ink">Journey planner</h1>
      <p className="text-sm text-shodo-ink-light mt-1">
        The course: Journeys in order, each with phases. Saving writes each phase&apos;s goals onto its scenarios; changed goals mean the scene is written again on the next start.
      </p>

      <div className="mt-6 grid grid-cols-[15rem_1fr] gap-6">
        <aside className="space-y-2">
          <button onClick={() => select(blank((data.journeys.at(-1)?.order ?? 0) + 1))} className="w-full rounded bg-shodo-ink px-3 py-1.5 text-sm text-shodo-paper">
            New Journey
          </button>
          <ul className="divide-y divide-shodo-paper-dark rounded border border-shodo-paper-dark bg-shodo-paper-warm">
            {data.journeys.map(j => (
              <li key={j.id}>
                <button
                  onClick={() => select(toDraft(j, data.names))}
                  className={`w-full px-3 py-2 text-left text-sm text-shodo-ink ${draft?.id === j.id ? "bg-shodo-paper-dark font-medium" : "hover:bg-shodo-paper-dark/60"}`}
                >
                  {j.order}. {j.title}
                  <span className="block text-xs text-shodo-ink-faint">{j.phases.length} phases · {j.difficultyLevel}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {draft ? (
          <main className="space-y-4 rounded-xl border border-shodo-paper-dark bg-shodo-paper-warm p-5">
            <div className="grid grid-cols-[1fr_6rem_6rem] gap-3">
              <label className={label}>Title<input className={input} value={draft.title} onChange={e => change({ title: e.target.value })} /></label>
              <label className={label}>Level<input className={input} value={draft.difficultyLevel} onChange={e => change({ difficultyLevel: e.target.value })} /></label>
              <label className={label}>Order<input type="number" className={input} value={draft.order} onChange={e => change({ order: Number(e.target.value) })} /></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>Learning goals (summary, learners see this)<textarea className={input} rows={2} value={draft.summary} onChange={e => change({ summary: e.target.value })} /></label>
              <label className={label}>Notes (planner only)<textarea className={input} rows={2} value={draft.notes ?? ""} onChange={e => change({ notes: e.target.value })} /></label>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded border border-shodo-paper-dark p-3">
              <div>
                <p className={label}>Unlocks after</p>
                {earlier.length === 0 && <p className="text-sm text-shodo-ink-faint">Nothing earlier: open from the start.</p>}
                {earlier.map(j => (
                  <label key={j.id} className="flex items-center gap-2 text-sm text-shodo-ink">
                    <input
                      type="checkbox"
                      checked={draft.unlockAfter?.includes(j.id) ?? false}
                      onChange={e => {
                        const next = e.target.checked ? [...(draft.unlockAfter ?? []), j.id] : (draft.unlockAfter ?? []).filter(x => x !== j.id);
                        change({ unlockAfter: next.length ? next : undefined });
                      }}
                    />
                    {j.title}
                  </label>
                ))}
                {earlier.length > 0 && !draft.unlockAfter?.length && <p className="text-xs text-shodo-ink-faint">None ticked: the previous Journey.</p>}
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-shodo-ink">
                  <input type="checkbox" checked={!!draft.passing} onChange={e => change({ passing: e.target.checked ? { minStage: 3, share: 1 } : undefined })} />
                  Overall rule, on top of every phase passed
                </label>
                {draft.passing && (
                  <div className="mt-1 flex items-center gap-1 text-sm text-shodo-ink">
                    <input type="number" min={0} max={100} className={`${input} w-16`} value={Math.round(draft.passing.share * 100)}
                      onChange={e => change({ passing: { ...draft.passing!, share: Math.min(Math.max(Number(e.target.value) / 100, 0), 1) } })} />
                    % of all taught items at stage
                    <input type="number" min={0} max={9} className={`${input} w-14`} value={draft.passing.minStage}
                      onChange={e => change({ passing: { ...draft.passing!, minStage: Number(e.target.value) } })} />
                    or above
                  </div>
                )}
              </div>
            </div>

            {draft.phases.map((p, i) => (
              <PhaseCard
                key={p.id}
                index={i}
                count={draft.phases.length}
                phase={p}
                level={draft.difficultyLevel}
                pool={pool}
                entries={entries}
                allowed={data.allowed[p.id]}
                names={data.names}
                takenElsewhere={new Set([...takenByOthers, ...draft.phases.filter((_, pi) => pi !== i).flatMap(x => x.poolIds)])}
                onChange={c => changePhase(i, c)}
                onMove={by => movePhase(i, by)}
                onRemove={() => change({ phases: draft.phases.filter((_, pi) => pi !== i) })}
              />
            ))}
            <button onClick={() => change({ phases: [...draft.phases, newPhase()] })} className="text-sm text-shodo-indigo">+ Add phase</button>

            <div className="sticky bottom-0 flex items-center gap-3 bg-shodo-paper-warm py-2">
              <button onClick={save} disabled={!dirty} className="rounded bg-shodo-ink px-4 py-1.5 text-sm text-shodo-paper disabled:opacity-40">Save</button>
              {draft.id && <button onClick={remove} className="text-sm text-shodo-stamp-red">Delete</button>}
              {status && <span className="text-sm text-shodo-ink-light">{status}</span>}
            </div>
          </main>
        ) : (
          <p className="text-shodo-ink-light">Choose a Journey, or make a new one.</p>
        )}
      </div>
    </div>
  );
}
