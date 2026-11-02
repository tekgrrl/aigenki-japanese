"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type PictureStatus = "approved" | "needs-review" | "rejected" | "unpicturable";

interface Picture {
  id: string;
  kuId: string;
  content: string;
  reading: string;
  usage: string;
  status: PictureStatus;
  file?: string;
  brief?: { picturable: boolean; includeCast: boolean; background: string; scene: string };
  attempts: { hasText: boolean; where: string }[];
}

interface Job {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  current: string[];
}

const TABS: { key: PictureStatus | "all"; label: string }[] = [
  { key: "needs-review", label: "Needs review" },
  { key: "approved", label: "Approved" },
  { key: "unpicturable", label: "Unpicturable" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

const STATUS_STYLE: Record<PictureStatus, string> = {
  approved: "bg-shodo-matcha/15 text-shodo-matcha",
  "needs-review": "bg-shodo-persimmon/15 text-shodo-persimmon",
  rejected: "bg-shodo-stamp-red/15 text-shodo-stamp-red",
  unpicturable: "bg-shodo-ink/10 text-shodo-ink-faint",
};

/** Picture cards for audio-first vocab: generate, then approve / reject / regenerate. */
export default function PicturesAdminPage() {
  const [tab, setTab] = useState<PictureStatus | "all">("needs-review");
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [words, setWords] = useState("");
  const [missingLimit, setMissingLimit] = useState(10);
  const [force, setForce] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (tab !== "all") params.set("status", tab);
    const res = await apiFetch(`/api/pictures/admin?${params}`);
    if (res.ok) {
      const data = (await res.json()) as { pictures: Picture[]; job: Job };
      setPictures(data.pictures);
      setJob(data.job);
    }
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Poll while a generation job is running.
  useEffect(() => {
    if (!job?.running) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [job?.running, load]);

  /** Lines are KU ids or Vocab words; words are resolved by exact match via KU search. */
  const resolveKuIds = async (lines: string[]): Promise<{ ids: string[]; missing: string[] }> => {
    const ids: string[] = [];
    const missing: string[] = [];
    for (const line of lines) {
      const res = await apiFetch(`/api/knowledge-units/search?${new URLSearchParams({ q: line, type: "Vocab" })}`);
      const hits = res.ok ? ((await res.json()) as { id: string; content: string }[]) : [];
      const match = hits.find((k) => k.content === line || k.id === line);
      if (match) ids.push(match.id);
      else if (/^[A-Za-z0-9_-]{6,}$/.test(line)) ids.push(line); // looks like an id
      else missing.push(line);
    }
    return { ids, missing };
  };

  const startJob = async (body: Record<string, unknown>, note?: string) => {
    const res = await apiFetch("/api/pictures/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setMessage(`Couldn't start: ${(await res.json().catch(() => ({}))).message ?? res.status}`);
      return;
    }
    setJob(await res.json());
    setMessage(note ?? null);
  };

  const generateForWords = async () => {
    const lines = words.split(/\n|,|、/).map((w) => w.trim()).filter(Boolean);
    if (!lines.length) return;
    const { ids, missing } = await resolveKuIds(lines);
    if (!ids.length) {
      setMessage(`No Vocab found for: ${missing.join(", ")}`);
      return;
    }
    await startJob({ kuIds: ids, force }, missing.length ? `Not found (skipped): ${missing.join(", ")}` : undefined);
  };

  const act = async (pic: Picture, action: "approve" | "reject" | "regenerate") => {
    setBusyId(pic.id);
    try {
      const res =
        action === "regenerate"
          ? await apiFetch(`/api/pictures/${pic.id}/regenerate`, { method: "POST" })
          : await apiFetch(`/api/pictures/${pic.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: action === "approve" ? "approved" : "rejected" }),
            });
      if (!res.ok) setMessage(`${action} failed (${res.status})`);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const tabClass = (key: string) =>
    `px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
      tab === key ? "border-shodo-ink text-shodo-ink" : "border-transparent text-shodo-ink-faint hover:text-shodo-ink"
    }`;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 text-shodo-ink">
      <h1 className="text-2xl font-bold mb-1">Picture Cards</h1>
      <p className="text-sm text-shodo-ink-faint mb-6">
        Text-free illustrations for audio-first vocab. Generated images that pass the automatic text check are approved;
        the rest wait here for review.
      </p>

      <section className="mb-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-shodo-ink/10 bg-shodo-paper-warm p-4">
          <label htmlFor="picture-words" className="block text-sm font-semibold mb-2">
            Generate for words or KU ids
          </label>
          <textarea
            id="picture-words"
            value={words}
            onChange={(e) => setWords(e.target.value)}
            rows={4}
            placeholder={"蛇口\n練習\n可愛い"}
            className="w-full rounded border border-shodo-ink/15 bg-shodo-paper p-2 text-sm"
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-shodo-ink-light">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Replace existing pictures (rebuild from the current usage labels)
          </label>
          <button
            type="button"
            onClick={generateForWords}
            disabled={!!job?.running}
            className="mt-2 rounded bg-shodo-ink px-4 py-2 text-sm font-semibold text-shodo-paper disabled:opacity-40"
          >
            Generate
          </button>
        </div>
        <div className="rounded-lg border border-shodo-ink/10 bg-shodo-paper-warm p-4">
          <label htmlFor="picture-missing" className="block text-sm font-semibold mb-2">
            Generate for Vocab without pictures
          </label>
          <div className="flex items-center gap-2">
            <input
              id="picture-missing"
              type="number"
              min={1}
              max={200}
              value={missingLimit}
              onChange={(e) => setMissingLimit(Number(e.target.value))}
              className="w-24 rounded border border-shodo-ink/15 bg-shodo-paper p-2 text-sm"
            />
            <button
              type="button"
              onClick={() => startJob({ missingLimit })}
              disabled={!!job?.running}
              className="rounded bg-shodo-ink px-4 py-2 text-sm font-semibold text-shodo-paper disabled:opacity-40"
            >
              Generate
            </button>
          </div>
          {job && (job.running || job.total > 0) && (
            <p className="mt-3 text-sm text-shodo-ink-light">
              {job.running ? "Running" : "Last job"}: {job.done}/{job.total} words
              {job.failed > 0 && <span className="text-shodo-stamp-red"> · {job.failed} failed</span>}
            </p>
          )}
        </div>
      </section>

      {message && <p className="mb-4 text-sm text-shodo-persimmon">{message}</p>}

      <div className="flex border-b border-shodo-ink/10 mb-6">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={tabClass(t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-shodo-ink-faint">Loading…</p>
      ) : pictures.length === 0 ? (
        <p className="text-sm text-shodo-ink-faint">No pictures here.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pictures.map((pic) => (
            <div key={pic.id} className="rounded-lg border border-shodo-ink/10 bg-shodo-paper-warm overflow-hidden">
              {pic.file ? (
                // biome-ignore lint/performance/noImgElement: served by the backend from local disk; next/image optimisation isn't wanted here
                <img
                  src={`/api/pictures/${pic.id}/image?v=${encodeURIComponent(pic.file)}`}
                  alt={`${pic.content}: ${pic.usage}`}
                  className="w-full aspect-square object-cover bg-[#f9f7f2]"
                />
              ) : (
                <div className="w-full aspect-square flex items-center justify-center text-sm text-shodo-ink-faint">
                  No image
                </div>
              )}
              <div className="p-3 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-bold">
                    {pic.content} <span className="text-sm font-normal text-shodo-ink-light">{pic.reading}</span>
                  </span>
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[pic.status]}`}>{pic.status}</span>
                </div>
                <p className="text-sm text-shodo-ink-light">{pic.usage}</p>
                {pic.brief?.scene && <p className="text-xs text-shodo-ink-faint">{pic.brief.scene}</p>}
                {pic.attempts.some((a) => a.hasText) && (
                  <p className="text-xs text-shodo-persimmon">
                    Text found: {pic.attempts.filter((a) => a.hasText).map((a) => a.where).join(" · ")}
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  {pic.status !== "approved" && pic.file && (
                    <button type="button" disabled={busyId === pic.id} onClick={() => act(pic, "approve")}
                      className="rounded bg-shodo-ink px-3 py-1 text-xs font-semibold text-shodo-paper disabled:opacity-40">
                      Approve
                    </button>
                  )}
                  {pic.status !== "rejected" && (
                    <button type="button" disabled={busyId === pic.id} onClick={() => act(pic, "reject")}
                      className="rounded border border-shodo-ink/20 px-3 py-1 text-xs font-semibold disabled:opacity-40">
                      Reject
                    </button>
                  )}
                  <button type="button" disabled={busyId === pic.id} onClick={() => act(pic, "regenerate")}
                    title="Draw this picture again for the same usage"
                    className="rounded border border-shodo-ink/20 px-3 py-1 text-xs font-semibold disabled:opacity-40">
                    {busyId === pic.id ? "Working…" : "Redraw"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
