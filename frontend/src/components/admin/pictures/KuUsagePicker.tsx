"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { UsageState } from "@/types";
import {
  fetchUsageStates,
  type KuHit,
  searchKus,
  type UsageStates,
} from "./pictureApi";

type Usage = UsageStates["usages"][number];

interface Props {
  /** What to offer on one usage row (e.g. Generate / Upload, or "Use this"). */
  actions: (ku: KuHit, usage: Usage) => ReactNode;
  /** Bump to re-fetch the selected word's usage states (e.g. after starting a picture). */
  refreshKey?: number;
  compact?: boolean;
}

const PICTURE_STATUS: Record<string, string> = {
  approved: "Approved (bound)",
  "needs-review": "In Needs Review",
  unpicturable: "Unpicturable",
};
const imageUrl = (id: string, file: string) => `/api/pictures/${id}/image?v=${encodeURIComponent(file)}`;

const STATE_LABEL: Record<UsageState, string> = {
  none: "No picture",
  waiting: "Waiting",
  bound: "Bound",
};
const STATE_STYLE: Record<UsageState, string> = {
  none: "bg-shodo-ink/10 text-shodo-ink-faint",
  waiting: "bg-shodo-persimmon/15 text-shodo-persimmon",
  bound: "bg-shodo-matcha/15 text-shodo-matcha",
};

/**
 * Find a KU by id or content (Kanji never listed), then see a Vocab word's usages with
 * where each stands. The caller decides what each usage row offers.
 */
export default function KuUsagePicker({ actions, refreshKey = 0, compact }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KuHit[] | null>(null);
  const [selected, setSelected] = useState<KuHit | null>(null);
  const [states, setStates] = useState<UsageStates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  /** The picture shown enlarged under its usage row. */
  const [preview, setPreview] = useState<string | null>(null);

  const search = async () => {
    setError(null);
    setSelected(null);
    setStates(null);
    setSearching(true);
    try {
      const found = await searchKus(query);
      setHits(found);
      if (found.length === 1) setSelected(found[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const loadStates = useCallback(async (ku: KuHit) => {
    if (ku.type !== "Vocab") return;
    try {
      setStates(await fetchUsageStates(ku.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is a deliberate re-fetch trigger
  useEffect(() => {
    setStates(null);
    if (selected) loadStates(selected);
  }, [selected, loadStates, refreshKey]);

  // While a picture for this word is being drawn, check back until it lands.
  useEffect(() => {
    if (!selected || !states?.usages.some((u) => u.drawing)) return;
    const t = setTimeout(() => loadStates(selected), 5000);
    return () => clearTimeout(t);
  }, [selected, states, loadStates]);

  const input = `rounded border border-shodo-ink/15 bg-shodo-paper ${compact ? "p-1.5 text-xs" : "p-2 text-sm"}`;

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <input
          aria-label="KU id or content"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="KU id or content, e.g. 掛かる"
          className={`${input} ${compact ? "w-40" : "w-64"}`}
        />
        <button
          type="submit"
          disabled={!query.trim() || searching}
          className={`rounded border border-shodo-ink/20 font-semibold disabled:opacity-40 ${compact ? "px-2 py-1 text-xs" : "px-4 py-2 text-sm"}`}
        >
          {searching ? "Searching…" : "Find"}
        </button>
      </form>
      {error && <p className="text-xs text-shodo-stamp-red">{error}</p>}

      {hits && !selected && (
        hits.length === 0 ? (
          <p className="text-sm text-shodo-ink-faint">No KUs found (Kanji aren&apos;t listed).</p>
        ) : (
          <ul className="divide-y divide-shodo-ink/10 rounded border border-shodo-ink/10">
            {hits.map((k) => (
              <li key={k.id}>
                <button
                  type="button"
                  onClick={() => setSelected(k)}
                  className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-shodo-ink/5"
                >
                  <span className="font-bold">{k.content}</span>
                  {k.reading && <span className="text-sm text-shodo-ink-light">{k.reading}</span>}
                  <span className="text-xs rounded bg-shodo-ink/10 px-1.5 py-0.5">{k.type}</span>
                  {k.meaning && <span className="text-sm text-shodo-ink-faint truncate">{k.meaning}</span>}
                  <span className="ml-auto text-xs text-shodo-ink-faint">{k.id}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {selected && (
        <div className="rounded border border-shodo-ink/10 p-3">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-bold">{selected.content}</span>
            {selected.reading && <span className="text-sm text-shodo-ink-light">{selected.reading}</span>}
            <span className="text-xs rounded bg-shodo-ink/10 px-1.5 py-0.5">{selected.type}</span>
            <span className="text-xs text-shodo-ink-faint">{selected.id}</span>
            {hits && hits.length > 1 && (
              <button type="button" onClick={() => setSelected(null)} className="ml-auto text-xs underline text-shodo-ink-faint">
                Back to results
              </button>
            )}
          </div>

          {selected.type !== "Vocab" ? (
            <p className="mt-2 text-sm text-shodo-ink-faint">
              {selected.type} pictures aren&apos;t in this flow yet.
            </p>
          ) : !states ? (
            <p className="mt-2 text-sm text-shodo-ink-faint">Loading usages…</p>
          ) : (
            <>
              {!states.labelled && (
                <p className="mt-2 text-xs text-shodo-persimmon">
                  Usages not labelled: some of this word&apos;s examples have no usage label, so it counts as one usage
                  (its first definition). The lesson may really have more.
                </p>
              )}
              <ul className="mt-2 space-y-2">
                {states.usages.map((u) => {
                  const shown = u.pictures.find((p) => p.id === preview);
                  return (
                  <li key={u.usage} className="rounded bg-shodo-paper p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATE_STYLE[u.state]}`}>
                      {u.drawing ? "Drawing…" : STATE_LABEL[u.state]}
                    </span>
                    <span className="font-semibold text-sm">{u.usage}</span>
                    {u.sentence && (
                      <span className="text-xs text-shodo-ink-faint">
                        {u.sentence} · {u.translation}
                      </span>
                    )}
                    {u.rejected > 0 && (
                      <span className="text-xs text-shodo-ink-faint">({u.rejected} rejected)</span>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      {u.pictures.map((p) =>
                        p.file ? (
                          <button
                            key={p.id}
                            type="button"
                            title={`${PICTURE_STATUS[p.status] ?? p.status}: click to ${preview === p.id ? "close" : "enlarge"}`}
                            onClick={() => setPreview((cur) => (cur === p.id ? null : p.id))}
                            className={`rounded overflow-hidden border-2 ${preview === p.id ? "border-shodo-ink" : "border-transparent"}`}
                          >
                            {/* biome-ignore lint/performance/noImgElement: served by the backend from local disk */}
                            <img src={imageUrl(p.id, p.file)} alt="" className="h-10 w-10 object-cover bg-[#f9f7f2]" />
                          </button>
                        ) : (
                          <span key={p.id} className="text-xs text-shodo-ink-faint">(unpicturable)</span>
                        ),
                      )}
                      {actions(selected, u)}
                    </span>
                  </div>
                  {shown?.file && (
                    <div className="mt-2 flex items-start gap-3">
                      {/* biome-ignore lint/performance/noImgElement: served by the backend from local disk */}
                      <img
                        src={imageUrl(shown.id, shown.file)}
                        alt={`${selected.content}: ${u.usage}`}
                        className="w-64 max-w-full rounded bg-[#f9f7f2]"
                      />
                      <div className="text-xs text-shodo-ink-light space-y-1">
                        <p className="font-semibold">{PICTURE_STATUS[shown.status] ?? shown.status}</p>
                        <p>
                          {shown.status === "approved" ? "Bound to" : "Made for"} {selected.content} ({u.usage})
                        </p>
                        <button type="button" onClick={() => setPreview(null)} className="underline text-shodo-ink-faint">
                          Close
                        </button>
                      </div>
                    </div>
                  )}
                  </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
