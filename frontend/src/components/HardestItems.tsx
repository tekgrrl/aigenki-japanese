"use client";

/**
 * Dashboard "Hardest items": the cards (or words) with the highest share of wrong answers, from
 * GET /api/stats/hardest. A card is listed once it has 5 reviews and at least one miss.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";

interface HardestItem {
  kuId: string;
  content: string;
  kuType: string;
  /** Set when listed by card. */
  facetType?: string;
  reviewCount: number;
  failCount: number;
  failRate: number;
}

const CARD_LABELS: Record<string, string> = {
  "Content-to-Definition": "meaning",
  "Definition-to-Content": "recall",
  "Content-to-Reading": "reading",
  "Reading-to-Content": "from reading",
  "AI-Generated-Question": "question",
  "Kanji-Component-Meaning": "kanji meaning",
  "Kanji-Component-Reading": "kanji reading",
  "audio": "listening",
  "sentence-assembly": "assembly",
  "sentence-cloze": "cloze",
};

export default function HardestItems() {
  const [by, setBy] = useState<"card" | "ku">("card");
  const [items, setItems] = useState<HardestItem[] | null>(null);

  useEffect(() => {
    let live = true;
    setItems(null);
    apiFetch(`/api/stats/hardest?by=${by}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => live && setItems(data))
      .catch(() => live && setItems([]));
    return () => { live = false; };
  }, [by]);

  return (
    <div className="rounded-2xl border-2 border-shodo-ink/10 bg-shodo-paper p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-shodo-ink">Hardest items</h2>
        <div className="flex rounded-lg border border-shodo-ink/20 text-sm">
          {(["card", "ku"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setBy(v)}
              className={`px-3 py-1 first:rounded-l-lg last:rounded-r-lg ${by === v ? "bg-shodo-ink text-shodo-paper" : "text-shodo-ink/70 hover:bg-shodo-ink/5"}`}
            >
              {v === "card" ? "By card" : "By word"}
            </button>
          ))}
        </div>
      </div>
      {items === null ? (
        <p className="text-sm text-shodo-ink/60">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-shodo-ink/60">Nothing yet: a card shows up here once it has 5 reviews and at least one miss.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((it) => (
            <li key={`${it.kuId}-${it.facetType ?? ""}`} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-shodo-ink/5">
              <span className="flex items-baseline gap-2">
                <Link href={`/learn/${it.kuId}?source=review`} className="text-base font-medium text-shodo-ink hover:underline">{it.content}</Link>
                {it.facetType && <span className="text-xs text-shodo-ink/60">{CARD_LABELS[it.facetType] ?? it.facetType}</span>}
              </span>
              <span className="shrink-0 text-right">
                <span className="font-bold text-shodo-stamp-red">{Math.round(it.failRate * 100)}%</span>
                <span className="ml-2 text-xs text-shodo-ink/60">{it.failCount} of {it.reviewCount} wrong</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
