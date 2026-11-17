"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

/** One ending group of one verb form, as GET /api/learner-progress/verb-forms returns it. */
interface GroupRow {
  skillId: string;
  group: string;
  label: string;
  attempts: number;
  correct: number;
  distinctVerbs: number;
  lastResult: "pass" | "fail" | null;
  lastAt: string | null;
  state: "unseen" | "practising" | "learned";
  studiedVerbs: number;
  otherVerbs: number;
}

const FORM_TITLES: Record<string, string> = {
  masu: "ます-stem",
  te: "て-form",
  ta: "た-form",
  nai: "ない-form",
};

const STATE_CLASS: Record<GroupRow["state"], string> = {
  unseen: "text-shodo-ink/40",
  practising: "text-shodo-ink",
  learned: "text-shodo-indigo font-semibold",
};

/**
 * Your verb-form skills: for each form and ending group, the evidence so far and the state the
 * current rule (backend learner-progress/skill-rules.ts) gives it. For judging that rule.
 */
export default function ProgressAdminPage() {
  const [grid, setGrid] = useState<{ form: string; groups: GroupRow[] }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/learner-progress/verb-forms")
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setGrid(await res.json());
      })
      .catch(e => setError((e as Error).message));
  }, []);

  return (
    <main className="container mx-auto max-w-4xl px-8 py-12">
      <p className="text-xs font-semibold uppercase tracking-widest text-shodo-accent mb-2">Admin</p>
      <h1 className="text-2xl font-bold text-shodo-ink mb-2">Verb-form progress</h1>
      <p className="text-sm text-shodo-ink-light mb-8 pb-4 border-b border-shodo-ink/10">
        Your evidence per ending group. &ldquo;Verbs&rdquo; is how many verbs a drill could use: ones you study, plus
        others from the corpus. A group with none can&apos;t be drilled until a verb in it has a lesson.
      </p>

      {error && <p className="text-sm text-red-700">Couldn&apos;t load progress: {error}</p>}
      {!grid && !error && <p className="text-sm text-shodo-ink-light">Loading…</p>}

      {grid?.map(({ form, groups }) => (
        <section key={form} className="mb-10">
          <h2 className="text-lg font-semibold text-shodo-ink mb-3">{FORM_TITLES[form] ?? form}</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-shodo-ink-light border-b border-shodo-ink/10">
                <th className="py-2 pr-4 font-medium">Group</th>
                <th className="py-2 pr-4 font-medium">State</th>
                <th className="py-2 pr-4 font-medium text-right">Correct / tries</th>
                <th className="py-2 pr-4 font-medium text-right">Verbs proven</th>
                <th className="py-2 pr-4 font-medium">Last</th>
                <th className="py-2 font-medium text-right">Verbs (yours + other)</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.skillId} className="border-b border-shodo-ink/5">
                  <td className="py-2 pr-4 text-shodo-ink">{g.label}</td>
                  <td className={`py-2 pr-4 ${STATE_CLASS[g.state]}`}>{g.state}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{g.correct} / {g.attempts}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{g.distinctVerbs}</td>
                  <td className="py-2 pr-4 text-shodo-ink-light">
                    {g.lastResult ? `${g.lastResult === "pass" ? "✓" : "✗"} ${new Date(g.lastAt!).toLocaleDateString()}` : "—"}
                  </td>
                  <td className={`py-2 text-right tabular-nums ${g.studiedVerbs + g.otherVerbs === 0 ? "text-red-700" : ""}`}>
                    {g.studiedVerbs + g.otherVerbs === 0 ? "none" : `${g.studiedVerbs} + ${g.otherVerbs}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
