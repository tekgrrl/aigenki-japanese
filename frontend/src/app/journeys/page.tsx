"use client";

/**
 * Journeys: the course, in order. Locked Journeys open when the previous one is done; the current
 * one shows its learning goals, progress and phases, and the current phase offers its scenarios.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { LearnerJourney } from "@/types/journey";

export default function JourneysPage() {
  const router = useRouter();
  const [journeys, setJourneys] = useState<LearnerJourney[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/journeys")
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setJourneys)
      .catch(e => setError((e as Error).message));
  }, []);

  /** Start (or reopen) a pool scenario, then go to it. */
  const open = async (poolId: string) => {
    setStarting(poolId);
    try {
      const res = await apiFetch(`/api/scenarios/pool/${poolId}/start`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { id } = await res.json();
      router.push(`/scenarios/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(null);
    }
  };

  return (
    <main className="container mx-auto max-w-3xl p-6 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-shodo-ink">Journeys</h1>
        <p className="text-sm text-shodo-ink-light mt-1">
          Each Journey is a few scenes from life in Japan. Pass a scene&apos;s role play to move on.
        </p>
      </header>

      {error && <p className="text-sm text-shodo-stamp-red">Couldn&apos;t load Journeys: {error}</p>}
      {!journeys && !error && <p className="text-shodo-ink-faint">Loading…</p>}
      {journeys?.length === 0 && <p className="text-shodo-ink-faint">No Journeys yet.</p>}

      {journeys?.map(j => (
        <section
          key={j.id}
          className={`rounded-xl border p-5 ${j.status === "current" ? "border-shodo-ink bg-shodo-paper" : "border-shodo-mist"} ${j.status === "locked" ? "opacity-60" : ""}`}
        >
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-bold text-shodo-ink">
              {j.status === "done" && <span className="mr-2 text-shodo-matcha">✓</span>}
              {j.title}
            </h2>
            <span className="text-xs text-shodo-ink-faint">{j.difficultyLevel}</span>
          </div>

          {j.status === "locked" && (
            <p className="mt-1 text-sm text-shodo-ink-faint">Complete {j.unlockAfterTitles.join(" and ") || "the previous Journey"} to unlock.</p>
          )}

          {j.status !== "locked" && j.summary && <p className="mt-1 text-shodo-ink-light">{j.summary}</p>}

          {j.status === "current" && (
            <div className="mt-4 space-y-4">
              {j.goals && j.goals.total > 0 && (
                <div>
                  <p className="text-sm text-shodo-ink-light">
                    {j.goals.ready} of {j.goals.total} words and grammar points at Familiar
                  </p>
                  <div className="mt-1 h-2 rounded bg-shodo-mist overflow-hidden">
                    <div className="h-full bg-shodo-matcha" style={{ width: `${Math.round((j.goals.ready / j.goals.total) * 100)}%` }} />
                  </div>
                </div>
              )}

              {j.phases.map((p, pi) => {
                const needsMorePasses = p.passing.scenarioPasses > 1;
                return (
                  <div key={p.id} className={p.status === "locked" ? "opacity-60" : ""}>
                    <h3 className="text-sm font-semibold text-shodo-ink">
                      {p.done ? "✓ " : ""}Phase {pi + 1}: {p.title}
                    </h3>
                    {p.status === "current" && (needsMorePasses || (p.goals && p.goals.total > 0)) && (
                      <p className="text-xs text-shodo-ink-light">
                        {needsMorePasses && `Pass ${p.passing.scenarioPasses} scenes. `}
                        {p.goals && p.goals.total > 0 && `${p.goals.ready} of ${p.goals.total} items ready${p.passing.share < 1 ? ` (${Math.round(p.passing.share * 100)}% needed)` : ""}.`}
                      </p>
                    )}
                    {p.status !== "locked" && (
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        {p.scenarios.map(s => (
                          <div key={s.poolId} className="rounded-lg border border-shodo-mist p-4 flex flex-col">
                            <p className="font-semibold text-shodo-ink">{s.title}</p>
                            {s.situationTags.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {s.situationTags.map(t => <span key={t} className="rounded-full border border-shodo-indigo px-2 text-xs text-shodo-indigo">{t}</span>)}
                              </div>
                            )}
                            <p className="mt-1 flex-1 text-sm text-shodo-ink-light">{s.description}</p>
                            {s.passed ? (
                              <Link href={`/scenarios/${s.poolId}`} className="mt-3 text-sm text-shodo-matcha">Passed ✓ · open</Link>
                            ) : (
                              <button
                                onClick={() => open(s.poolId)}
                                disabled={starting !== null}
                                className="mt-3 rounded bg-shodo-ink px-3 py-1.5 text-sm text-shodo-paper disabled:opacity-50"
                              >
                                {starting === s.poolId ? (s.started ? "Opening…" : "Writing your scene…") : s.started ? "Continue" : "Start"}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
