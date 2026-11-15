"use client";

/**
 * Admin: the scenario pool. Each entry is a premise and learning goals; nothing is generated here.
 * The first learner to start an entry generates its scene from these (shared by later learners).
 * Changing the premise or goals clears the generated scene so the next start writes a new one.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { PoolEntry, PoolScenarioSummary } from "@/types/scenario";

/** The editor's form: goals as one-per-line text (resolved by the backend on save). */
type Form = {
  id?: string;
  title: string;
  description: string;
  difficultyLevel: string;
  location: string;
  goal: string;
  timeOfDay: string;
  userRole: string;
  aiRole: string;
  simulationBrief: string;
  summary: string;
  vocab: string;
  grammar: string;
  setPhrases: string;
  situationTags: string;
  generated: boolean;
  /** Set when a Journey phase owns the goals and brief: they're edited in the planner, not here. */
  phaseRef?: PoolEntry["phaseRef"];
};

const blank: Form = {
  title: "", description: "", difficultyLevel: "N5", location: "", goal: "", timeOfDay: "", userRole: "", aiRole: "",
  simulationBrief: "", summary: "", vocab: "", grammar: "", setPhrases: "", situationTags: "", generated: false,
};

const toForm = (e: PoolEntry): Form => ({
  id: e.id,
  title: e.title,
  description: e.description ?? "",
  difficultyLevel: e.difficultyLevel ?? "N5",
  location: e.setting?.location ?? "",
  goal: e.setting?.goal ?? "",
  timeOfDay: e.setting?.timeOfDay ?? "",
  userRole: e.roles?.user ?? "",
  aiRole: Array.isArray(e.roles?.ai) ? e.roles.ai.join(", ") : e.roles?.ai ?? "",
  simulationBrief: e.simulationBrief ?? "",
  summary: e.goals?.summary ?? "",
  vocab: (e.goals?.vocab ?? []).map(v => v.content).join("\n"),
  // Stored as Grammar KU ids; the backend accepts ids or patterns.
  grammar: (e.goals?.grammarKuIds ?? []).join("\n"),
  setPhrases: (e.goals?.setPhrases ?? []).join("\n"),
  situationTags: (e.situationTags ?? []).join(", "),
  generated: (e.dialogue?.length ?? 0) > 0,
  phaseRef: e.phaseRef,
});

const lines = (text: string) => text.split("\n").map(l => l.trim()).filter(Boolean);

function PoolEditor() {
  const params = useSearchParams();
  const [entries, setEntries] = useState<PoolScenarioSummary[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const res = await apiFetch("/api/scenarios/pool");
    if (res.ok) setEntries(await res.json());
  }, []);

  const open = useCallback(async (id: string) => {
    setStatus(null);
    const res = await apiFetch(`/api/scenarios/pool/${id}`);
    if (res.ok) setForm(toForm(await res.json()));
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { const id = params.get("id"); if (id) void open(id); }, [params, open]);

  const set = (c: Partial<Form>) => setForm(f => (f ? { ...f, ...c } : f));

  const save = async () => {
    if (!form) return;
    setStatus("Saving…");
    const body = {
      title: form.title,
      description: form.description,
      difficultyLevel: form.difficultyLevel,
      setting: { location: form.location, goal: form.goal, timeOfDay: form.timeOfDay },
      roles: { user: form.userRole, ai: form.aiRole },
      simulationBrief: form.simulationBrief,
      goals: { summary: form.summary, vocab: lines(form.vocab), grammar: lines(form.grammar), setPhrases: lines(form.setPhrases) },
      situationTags: form.situationTags.split(",").map(t => t.trim()).filter(Boolean),
    };
    const res = await apiFetch(form.id ? `/api/scenarios/pool/${form.id}` : "/api/scenarios/pool", {
      method: form.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) return setStatus(`Save failed: ${result.message ?? res.status}`);
    setForm(toForm(result));
    setStatus(result.dialogue?.length ? "Saved (scene kept)." : "Saved. The next start will write the scene.");
    await loadList();
  };

  const input = "w-full rounded border border-shodo-ink-faint/50 bg-shodo-paper-dark px-2 py-1 text-shodo-ink focus:outline-none focus:border-shodo-ink-light";
  const label = "block text-xs font-medium text-shodo-ink-light";

  return (
    <div className="container mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold text-shodo-ink">Scenario pool</h1>
      <p className="text-sm text-shodo-ink-light mt-1">
        A premise and learning goals per scene. The first learner to start it generates the scene from these; later learners share it.
      </p>

      <div className="mt-6 grid grid-cols-[16rem_1fr] gap-6">
        <aside className="space-y-2">
          <button onClick={() => { setForm({ ...blank }); setStatus(null); }} className="w-full rounded bg-shodo-ink px-3 py-1.5 text-sm text-shodo-paper">
            New scenario
          </button>
          <ul className="divide-y divide-shodo-paper-dark rounded border border-shodo-paper-dark bg-shodo-paper-warm">
            {entries.map(e => (
              <li key={e.id}>
                <button onClick={() => open(e.id)} className={`w-full px-3 py-2 text-left text-sm text-shodo-ink ${form?.id === e.id ? "bg-shodo-paper-dark font-medium" : "hover:bg-shodo-paper-dark/60"}`}>
                  {e.title} <span className="text-xs text-shodo-ink-light">{e.difficultyLevel}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {form ? (
          <main className="space-y-3 rounded-xl border border-shodo-paper-dark bg-shodo-paper-warm p-5">
            <p className="text-xs text-shodo-ink-light">{form.generated ? "Scene generated (changing the premise or goals clears it)." : "Not generated yet."}</p>
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <label className={label}>Title<input className={input} value={form.title} onChange={e => set({ title: e.target.value })} /></label>
              <label className={label}>Level<input className={input} value={form.difficultyLevel} onChange={e => set({ difficultyLevel: e.target.value })} /></label>
            </div>
            <label className={label}>Blurb (what learners read when choosing)<textarea className={input} rows={2} value={form.description} onChange={e => set({ description: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>Location<input className={input} value={form.location} onChange={e => set({ location: e.target.value })} /></label>
              <label className={label}>Time of day<input className={input} value={form.timeOfDay} onChange={e => set({ timeOfDay: e.target.value })} /></label>
              <label className={label}>Learner role<input className={input} value={form.userRole} onChange={e => set({ userRole: e.target.value })} /></label>
              <label className={label}>Partner role<input className={input} value={form.aiRole} onChange={e => set({ aiRole: e.target.value })} /></label>
            </div>
            <label className={label}>The learner&apos;s goal in the scene<input className={input} value={form.goal} onChange={e => set({ goal: e.target.value })} /></label>
            <label className={label}>Situation tags, comma-separated (e.g. traveller, resident)<input className={input} value={form.situationTags} onChange={e => set({ situationTags: e.target.value })} /></label>
            {form.phaseRef && (
              <p className="rounded bg-shodo-paper-dark px-3 py-2 text-sm text-shodo-ink">
                Goals, set phrases and the simulation brief are edited in the Journey planner:{" "}
                <a href="/admin/journeys" className="text-shodo-indigo underline">{form.phaseRef.journeyTitle} › {form.phaseRef.phaseTitle}</a>.
              </p>
            )}
            <fieldset disabled={!!form.phaseRef} className="space-y-3 disabled:opacity-60">
              <label className={label}>Learning goals (summary)<textarea className={input} rows={2} value={form.summary} onChange={e => set({ summary: e.target.value })} /></label>
              <div className="grid grid-cols-3 gap-3">
                <label className={label}>Vocab, one per line<textarea className={input} rows={8} value={form.vocab} onChange={e => set({ vocab: e.target.value })} /></label>
                <label className={label}>Grammar (pattern or id), one per line<textarea className={input} rows={8} value={form.grammar} onChange={e => set({ grammar: e.target.value })} /></label>
                <label className={label}>Set phrases, one per line<textarea className={input} rows={8} value={form.setPhrases} onChange={e => set({ setPhrases: e.target.value })} /></label>
              </div>
              <label className={label}>Simulation brief (what the role play adds)<textarea className={input} rows={2} value={form.simulationBrief} onChange={e => set({ simulationBrief: e.target.value })} /></label>
            </fieldset>
            <div className="flex items-center gap-3">
              <button onClick={save} className="rounded bg-shodo-ink px-4 py-1.5 text-sm text-shodo-paper">Save</button>
              {status && <span className="text-sm text-shodo-ink-light">{status}</span>}
            </div>
          </main>
        ) : (
          <p className="text-shodo-ink-light">Choose a scenario, or make a new one.</p>
        )}
      </div>
    </div>
  );
}

export default function AdminScenarioPoolPage() {
  return (
    <Suspense fallback={null}>
      <PoolEditor />
    </Suspense>
  );
}
