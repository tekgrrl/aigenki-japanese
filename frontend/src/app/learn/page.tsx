"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KnowledgeUnit } from "@/types";
import { apiFetch } from "@/lib/api-client";

type KUWithStatus = KnowledgeUnit & {
  ukuStatus?: "learning" | "reviewing" | "mastered";
  ukuFacetCount?: number;
  /** Where the item came from (a scenario groups its items together). */
  ukuSource?: { type: "scenario" | "lesson" | "flag"; id: string } | null;
  /** When it was enrolled (ISO); Start Learning serves the oldest waiting items first. */
  ukuCreatedAt?: string | null;
};

/** Items grouped by the scenario they came from; everything else goes in one last group. */
type Group = { key: string; title: string; scenarioId?: string; rows: KUWithStatus[] };
const OTHER = "__other";

/**
 * The scenario an item belongs to: its own source, or for a kanji enrolled by a word's lesson
 * (source `lesson`, id = the word), the word's scenario.
 */
function scenarioOf(ku: KUWithStatus, byId: Map<string, KUWithStatus>): string | null {
  const src = ku.ukuSource?.type === "lesson" ? byId.get(ku.ukuSource.id)?.ukuSource : ku.ukuSource;
  return src?.type === "scenario" ? src.id : null;
}

function groupByScenario(rows: KUWithStatus[], titles: Record<string, string>, byId: Map<string, KUWithStatus>): Group[] {
  const groups = new Map<string, Group>();
  for (const ku of rows) {
    const found = scenarioOf(ku, byId);
    const sid = found && titles[found] ? found : null;
    const key = sid ?? OTHER;
    if (!groups.has(key)) groups.set(key, sid ? { key, title: titles[sid], scenarioId: sid, rows: [] } : { key, title: "Not from a scenario", rows: [] });
    groups.get(key)!.rows.push(ku);
  }
  const oldest = (g: Group) => g.rows.reduce((m, r) => (r.ukuCreatedAt && r.ukuCreatedAt < m ? r.ukuCreatedAt : m), "\uffff");
  // Oldest first (what Start Learning reaches first); the catch-all group goes last.
  return [...groups.values()]
    .map(g => ({ ...g, rows: [...g.rows].sort((a, b) => (a.ukuCreatedAt ?? "").localeCompare(b.ukuCreatedAt ?? "")) }))
    .sort((a, b) => (a.key === OTHER ? 1 : b.key === OTHER ? -1 : oldest(a).localeCompare(oldest(b))));
}

const STATUS_COLORS: Record<string, string> = {
  learning: "var(--shodo-persimmon)",
  reviewing: "var(--shodo-indigo)",
  mastered: "var(--shodo-gold)",
};

const STATUS_BORDER_COLORS: Record<string, string> = {
  learning: "color-mix(in srgb, var(--shodo-persimmon) 80%, black)",
  reviewing: "color-mix(in srgb, var(--shodo-indigo) 80%, black)",
  mastered: "color-mix(in srgb, var(--shodo-gold) 80%, black)",
};

const TYPE_STYLES: Record<string, string> = {
  Vocab: "text-shodo-ink-light",
  Kanji: "text-shodo-stamp-red",
  Grammar: "text-shodo-matcha",
};

// Shodo theme variables via style prop (they follow light/dark mode)
const TYPE_COLORS: Record<string, string> = {
  Vocab: "var(--shodo-indigo)",
  Kanji: "var(--shodo-ink-light)", // deep ink-brown
  Grammar: "var(--shodo-matcha)",
};

export default function LearnListPage() {
  const router = useRouter();
  const [items, setItems] = useState<KUWithStatus[]>([]);
  const [scenarioTitles, setScenarioTitles] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    apiFetch("/api/knowledge-units/get-all?status=user", { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((data: KUWithStatus[]) => setItems(data))
      .catch(err => { if (err.name !== "AbortError") setError(err.message || "Failed to fetch"); })
      .finally(() => setIsLoading(false));

    apiFetch("/api/scenarios", { signal: controller.signal })
      .then(res => (res.ok ? res.json() : []))
      .then((list: { id: string; title?: string }[]) =>
        setScenarioTitles(Object.fromEntries(list.filter(s => s.title).map(s => [s.id, s.title!]))))
      .catch(() => { /* titles are a nicety: without them items show under "Not from a scenario" */ });

    return () => controller.abort();
  }, []);

  const byId = new Map(items.map(k => [k.id, k]));
  const learning = items.filter(k => k.ukuStatus === "learning");
  const reviewing = items.filter(k => k.ukuStatus === "reviewing");
  const mastered = items.filter(k => k.ukuStatus === "mastered");

  const renderSection = (title: string, rows: KUWithStatus[], emptyText: string, note?: string) => (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint mb-2 px-1">
        {title} <span className="ml-1 text-shodo-ink-faint font-normal">({rows.length})</span>
      </h2>
      {note && rows.length > 0 && <p className="text-xs text-shodo-ink-faint px-1 mb-2">{note}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-shodo-ink-faint px-1 pb-4">{emptyText}</p>
      ) : (
        groupByScenario(rows, scenarioTitles, byId).map(group => (
        <div key={group.key} className="mb-6">
          <h3 className="text-sm font-medium text-shodo-ink-light px-1 mb-1">
            {group.scenarioId ? (
              <Link href={`/scenarios/${group.scenarioId}`} className="hover:underline">{group.title}</Link>
            ) : group.title}
            <span className="ml-1 text-shodo-ink-faint font-normal">({group.rows.length})</span>
          </h3>
        <div className="rounded-lg border border-shodo-paper-dark overflow-hidden">
          {group.rows.map((ku, i) => (
            <Link
              key={ku.id}
              href={`/learn/${ku.id}`}
              style={{ borderLeftColor: TYPE_COLORS[ku.type] ?? "var(--shodo-ink-faint)" }}
              className={`flex items-center gap-3 pl-3 pr-4 py-2.5 border-l-4 hover:bg-shodo-paper-dark transition-colors
                ${i < group.rows.length - 1 ? "border-b border-shodo-paper-dark" : ""}
                dark:hover:bg-gray-700`}
            >
              {/* Primary label — coloured by type */}
              <span
                style={{ color: TYPE_COLORS[ku.type] }}
                className={`font-bold min-w-[5rem] dark:text-white ${ku.type === "Grammar" ? "text-base" : "text-xl"}`}
              >
                {ku.type === "Grammar" && (ku as any).data?.title
                  ? (ku as any).data.title
                  : ku.content}
              </span>

              {/* Reading / definition hint — always flex-1 to anchor fixed columns */}
              <span className="flex-1 truncate text-sm text-shodo-ink-light dark:text-gray-400">
                {ku.type === "Vocab" && (ku as any).data?.reading && (ku as any).data.reading !== ku.content
                  ? (ku as any).data.reading
                  : ku.type === "Grammar"
                    ? ku.content
                    : ku.type === "Kanji" && (ku as any).data?.meaning
                      ? (ku as any).data.meaning
                      : ""}
              </span>

              {/* Facet count — fixed width, always present to anchor layout */}
              <span className="text-xs text-shodo-ink-faint w-16 text-right tabular-nums whitespace-nowrap">
                {ku.ukuFacetCount != null && ku.ukuFacetCount > 0
                  ? `${ku.ukuFacetCount} ${ku.ukuFacetCount === 1 ? "facet" : "facets"}`
                  : ""}
              </span>

              {/* JLPT level — fixed width */}
              <span className="text-xs text-shodo-ink-faint w-6 text-center">
                {(ku as any).data?.jlptLevel ?? ""}
              </span>

              {/* Type — fixed width, always rightmost before badge */}
              <span className={`text-xs font-medium w-16 text-right ${TYPE_STYLES[ku.type] ?? "text-shodo-ink-light"}`}>
                {ku.type}
              </span>

              {/* Status badge */}
              <span
                style={{
                  backgroundColor: STATUS_COLORS[ku.ukuStatus ?? "learning"],
                  borderColor: STATUS_BORDER_COLORS[ku.ukuStatus ?? "learning"],
                }}
                className="text-xs px-2 py-0.5 rounded-full font-medium capitalize w-20 text-center text-shodo-paper border"
              >
                {ku.ukuStatus ?? "learning"}
              </span>
            </Link>
          ))}
        </div>
        </div>
        ))
      )}
    </section>
  );

  return (
    <main className="container mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-shodo-ink dark:text-white">My Library</h1>
          <p className="text-sm text-shodo-ink-light dark:text-gray-400 mt-1">
            {isLoading ? "Loading…" : `${items.length} items`}
          </p>
        </div>
        <button
          onClick={() => router.push("/learn/session")}
          className="mt-1 px-5 py-2 rounded-lg bg-shodo-indigo text-shodo-paper text-sm font-semibold shrink-0 hover:opacity-90 transition-opacity"
        >
          Start Learning
        </button>
      </header>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="text-shodo-ink-faint text-sm">Loading…</p>
      ) : (
        <>
          {renderSection("Lesson Pending", learning, "Nothing waiting for a lesson.", "Start Learning teaches these, oldest first.")}
          {renderSection("In Review", reviewing, "Nothing in review yet.")}
          {renderSection("Mastered", mastered, "Nothing mastered yet — keep going!")}
        </>
      )}
    </main>
  );
}
