"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KnowledgeUnit } from "@/types";
import { apiFetch } from "@/lib/api-client";

type KUWithStatus = KnowledgeUnit & {
  ukuStatus?: "learning" | "reviewing" | "mastered";
  ukuFacetCount?: number;
};

const STATUS_COLORS: Record<string, string> = {
  learning: "#E08A46", // shodo-persimmon
  reviewing: "#2E4B75", // shodo-indigo
  mastered: "#C7A04D", // shodo-gold
};

const STATUS_BORDER_COLORS: Record<string, string> = {
  learning: "#B36E38", // persimmon -20%
  reviewing: "#253C5E", // indigo -20%
  mastered: "#9F803E", // gold -20%
};

const TYPE_STYLES: Record<string, string> = {
  Vocab: "text-shodo-ink-light",
  Kanji: "text-shodo-stamp-red",
  Grammar: "text-shodo-matcha",
};

// Hex values from tailwind.config.ts — used via style prop to guarantee rendering
const TYPE_COLORS: Record<string, string> = {
  Vocab: "#2E4B75", // shodo-indigo
  Kanji: "#595048", // shodo-ink-light (deep ink-brown)
  Grammar: "#7B8D42", // shodo-matcha
};

export default function LearnListPage() {
  const router = useRouter();
  const [items, setItems] = useState<KUWithStatus[]>([]);
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

    return () => controller.abort();
  }, []);

  const learning = items.filter(k => k.ukuStatus === "learning");
  const reviewing = items.filter(k => k.ukuStatus === "reviewing");
  const mastered = items.filter(k => k.ukuStatus === "mastered");

  const renderSection = (title: string, rows: KUWithStatus[], emptyText: string) => (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-shodo-ink-faint mb-2 px-1">
        {title} <span className="ml-1 text-shodo-ink-faint font-normal">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-shodo-ink-faint px-1 pb-4">{emptyText}</p>
      ) : (
        <div className="rounded-lg border border-shodo-paper-dark overflow-hidden mb-6">
          {rows.map((ku, i) => (
            <Link
              key={ku.id}
              href={`/learn/${ku.id}`}
              style={{ borderLeftColor: TYPE_COLORS[ku.type] ?? "#A69E96" }}
              className={`flex items-center gap-3 pl-3 pr-4 py-2.5 border-l-4 hover:bg-shodo-paper-dark transition-colors
                ${i < rows.length - 1 ? "border-b border-shodo-paper-dark" : ""}
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
                className="text-xs px-2 py-0.5 rounded-full font-medium capitalize w-20 text-center text-white border"
              >
                {ku.ukuStatus ?? "learning"}
              </span>
            </Link>
          ))}
        </div>
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
          style={{ backgroundColor: "#2E4B75" }}
          className="mt-1 px-5 py-2 rounded-lg text-white text-sm font-semibold shrink-0 hover:opacity-90 transition-opacity"
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
          {renderSection("Lesson Pending", learning, "Nothing waiting for a lesson.")}
          {renderSection("In Review", reviewing, "Nothing in review yet.")}
          {renderSection("Mastered", mastered, "Nothing mastered yet — keep going!")}
        </>
      )}
    </main>
  );
}
