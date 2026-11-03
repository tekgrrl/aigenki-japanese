"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NewPicturePanel from "@/components/admin/pictures/NewPicturePanel";
import PictureCardTools from "@/components/admin/pictures/PictureCardTools";
import { type PictureSubject, resolveKuId, SUBJECT_LABEL, type SubjectKind } from "@/components/admin/pictures/pictureApi";
import { apiFetch } from "@/lib/api-client";

type PictureStatus = "approved" | "needs-review" | "rejected" | "unpicturable";

interface Picture {
  id: string;
  kuId: string | null;
  subject?: PictureSubject;
  style?: "card" | "scene";
  note?: string;
  content: string;
  reading: string;
  usage: string;
  status: PictureStatus;
  file?: string;
  brief?: { picturable: boolean; includeCast: boolean; background: string; scene: string };
  attempts: { hasText: boolean; where: string }[];
  origin?: "generated" | "uploaded";
  staleUsage?: boolean;
}

interface Job {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  current: string[];
  redrawing: string[];
  rendering: { id: string; label: string }[];
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
  const [uploadKind, setUploadKind] = useState<SubjectKind>("ku-usage");
  const [uploadWord, setUploadWord] = useState("");
  const [uploadUsage, setUploadUsage] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  // Bumped after each upload to remount (clear) the file input.
  const [fileInputKey, setFileInputKey] = useState(0);

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

  // Poll while a generation job or a redraw is running (both run in the background).
  const busy = !!job?.running || (job?.redrawing.length ?? 0) > 0 || (job?.rendering?.length ?? 0) > 0;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [busy, load]);

  // When a single render finishes, replace the "Rendering …" message with its outcome.
  const renderingRef = useRef<{ id: string; label: string }[]>([]);
  useEffect(() => {
    const now = job?.rendering ?? [];
    const finished = renderingRef.current.filter((r) => !now.some((n) => n.id === r.id));
    renderingRef.current = now;
    if (finished.length === 0) return;
    setMessage(
      finished
        .map((r) => {
          const pic = pictures.find((p) => p.id === r.id);
          return pic ? `${r.label}: ${pic.status}` : `${r.label}: finished (not in this tab, or it failed: see the backend log)`;
        })
        .join(" · "),
    );
  }, [job, pictures]);

  /** Lines are KU ids or Vocab words; words are resolved by exact match via KU search. */
  const resolveKuIds = async (lines: string[]): Promise<{ ids: string[]; missing: string[] }> => {
    const ids: string[] = [];
    const missing: string[] = [];
    const results = await Promise.all(
      lines.map(async (line) => {
        const res = await apiFetch(`/api/knowledge-units/search?${new URLSearchParams({ q: line, type: "Vocab" })}`);
        const hits = res.ok ? ((await res.json()) as { id: string; content: string }[]) : [];
        return { line, match: hits.find((k) => k.content === line || k.id === line) };
      }),
    );
    for (const { line, match } of results) {
      if (match) ids.push(match.id);
      else if (/^(wk-\d+|[A-Za-z0-9]{20})$/.test(line)) ids.push(line); // a WaniKani-style or Firestore id
      else missing.push(line);
    }
    return { ids, missing };
  };

  /** Attach a hand-made image (e.g. a diagram) to one word. */
  const upload = async () => {
    if (!uploadFile || (uploadKind !== "none" && !uploadWord.trim())) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      form.append("kind", uploadKind);
      if (uploadKind !== "none") {
        const kuId = await resolveKuId(uploadWord, uploadKind === "ku");
        if (!kuId) {
          setMessage(`No ${uploadKind === "ku" ? "KU" : "Vocab"} found for: ${uploadWord.trim()}`);
          return;
        }
        form.append("kuId", kuId);
      }
      // The second field is the usage for a word, or the description of a free-standing image.
      if (uploadUsage.trim()) form.append(uploadKind === "none" ? "note" : "usage", uploadUsage.trim());
      const res = await apiFetch("/api/pictures/upload", { method: "POST", body: form });
      if (!res.ok) {
        setMessage(`Upload failed: ${(await res.json().catch(() => ({}))).message ?? res.status}`);
        return;
      }
      const pic = (await res.json()) as Picture;
      setMessage(`Uploaded: ${pic.content}${pic.usage ? ` (${pic.usage})` : ""}`);
      setUploadWord("");
      setUploadUsage("");
      setUploadFile(null);
      setFileInputKey((k) => k + 1);
      // Switching tab reloads via the effect; only reload directly if we're already there
      // (calling load() after setTab would fetch the old tab and race the effect's fetch).
      if (tab === "approved") await load();
      else setTab("approved");
    } finally {
      setUploading(false);
    }
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
          ? await apiFetch(`/api/pictures/${pic.id}/redraw`, { method: "POST" })
          : await apiFetch(`/api/pictures/${pic.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: action === "approve" ? "approved" : "rejected" }),
            });
      if (!res.ok) setMessage(`${action} failed: ${(await res.json().catch(() => ({}))).message ?? res.status}`);
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
        Text-free illustrations: picture cards for word usages, whole-KU pictures and diagrams, and free-standing
        assets. Generated images that pass the automatic text check are approved; the rest wait here for review.
      </p>

      <Section title="Generate in bulk" hint="Picture cards for word usages, drafted and drawn automatically." first>
      <div className="grid gap-4 md:grid-cols-2">
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
      </div>
      </Section>

      <Section
        title="Make one picture"
        hint="Choose what it's of, draft a brief, adjust it, then render. A note steers the brief; for a free-standing picture the note is the description."
      >
        <NewPicturePanel
          onStarted={(m) => {
            setMessage(m);
            load(); // picks up job.rendering, which starts the polling
          }}
        />
      </Section>

      <Section
        title="Upload"
        hint="For what a generated picture can't show (e.g. a diagram). Uploads are approved straight away and never redrawn or replaced by generation."
      >
        <div className="rounded-lg border border-shodo-ink/10 bg-shodo-paper-warm p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Upload for"
              value={uploadKind}
              onChange={(e) => setUploadKind(e.target.value as SubjectKind)}
              className="rounded border border-shodo-ink/15 bg-shodo-paper p-2 text-sm"
            >
              {(Object.keys(SUBJECT_LABEL) as SubjectKind[]).map((k) => (
                <option key={k} value={k}>
                  {SUBJECT_LABEL[k]}
                </option>
              ))}
            </select>
            {uploadKind !== "none" && (
            <input
              aria-label="Word"
              value={uploadWord}
              onChange={(e) => setUploadWord(e.target.value)}
              placeholder={uploadKind === "ku" ? "KU content or id" : "Word, e.g. くれる"}
              className="w-40 rounded border border-shodo-ink/15 bg-shodo-paper p-2 text-sm"
            />
            )}
            {uploadKind !== "ku" && (
            <input
              aria-label="Usage (optional)"
              value={uploadUsage}
              onChange={(e) => setUploadUsage(e.target.value)}
              placeholder={uploadKind === "none" ? "Description (optional)" : "Usage (optional; defaults to the first)"}
              className="w-72 rounded border border-shodo-ink/15 bg-shodo-paper p-2 text-sm"
            />
            )}
            <input
              key={fileInputKey}
              aria-label="Image file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            <button
              type="button"
              onClick={upload}
              disabled={uploading || !uploadFile || (uploadKind !== "none" && !uploadWord.trim())}
              className="rounded bg-shodo-ink px-4 py-2 text-sm font-semibold text-shodo-paper disabled:opacity-40"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        </div>
      </Section>

      <Section title="Library" hint="Every picture, by review status.">
      {message && <p className="mb-4 text-sm text-shodo-persimmon">{message}</p>}
      {(job?.rendering?.length ?? 0) > 0 && (
        <p className="mb-4 text-sm text-shodo-ink-light">
          Rendering: {job?.rendering.map((r) => r.label).join(" · ")}
        </p>
      )}

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
          {pictures.map((pic) => {
            const working = busyId === pic.id || !!job?.redrawing.includes(pic.id);
            return (
            <div key={pic.id} className="rounded-lg border border-shodo-ink/10 bg-shodo-paper-warm overflow-hidden">
              {pic.file ? (
                // biome-ignore lint/performance/noImgElement: served by the backend from local disk; next/image optimisation isn't wanted here
                <img
                  src={`/api/pictures/${pic.id}/image?v=${encodeURIComponent(pic.file)}`}
                  alt={`${pic.content}: ${pic.usage}`}
                  className={`w-full aspect-square bg-[#f9f7f2] ${pic.style === "scene" ? "object-contain" : "object-cover"}`}
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
                  <span className="flex gap-1">
                    {pic.origin === "uploaded" && (
                      <span className="rounded px-2 py-0.5 text-xs font-semibold bg-shodo-indigo/15 text-shodo-indigo">uploaded</span>
                    )}
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[pic.status]}`}>{pic.status}</span>
                  </span>
                </div>
                <p className="text-sm text-shodo-ink-light">
                  {pic.subject?.kind === "ku" ? "Whole KU" : pic.subject?.kind === "none" ? "Free-standing" : pic.usage}
                  {pic.style === "scene" && <span className="text-shodo-ink-faint"> · scene</span>}
                </p>
                {pic.note && <p className="text-xs text-shodo-ink-faint">Note: {pic.note}</p>}
                {pic.staleUsage && (
                  <p className="text-xs text-shodo-persimmon">
                    This usage is no longer in the lesson (relabelled?). Uploads aren&apos;t cleaned up automatically: reject it or upload a replacement.
                  </p>
                )}
                {pic.brief?.scene && <p className="text-xs text-shodo-ink-faint">{pic.brief.scene}</p>}
                {pic.attempts.some((a) => a.hasText) && (
                  <p className="text-xs text-shodo-persimmon">
                    Text found: {pic.attempts.filter((a) => a.hasText).map((a) => a.where).join(" · ")}
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  {pic.status !== "approved" && pic.file && (
                    <button type="button" disabled={working} onClick={() => act(pic, "approve")}
                      className="rounded bg-shodo-ink px-3 py-1 text-xs font-semibold text-shodo-paper disabled:opacity-40">
                      Approve
                    </button>
                  )}
                  {pic.status !== "rejected" && (
                    <button type="button" disabled={working} onClick={() => act(pic, "reject")}
                      className="rounded border border-shodo-ink/20 px-3 py-1 text-xs font-semibold disabled:opacity-40">
                      Reject
                    </button>
                  )}
                  {pic.origin !== "uploaded" && (
                    <button type="button" disabled={working} onClick={() => act(pic, "regenerate")}
                      title="Draw this picture again for the same usage"
                      className="rounded border border-shodo-ink/20 px-3 py-1 text-xs font-semibold disabled:opacity-40">
                      {working ? "Working…" : "Redraw"}
                    </button>
                  )}
                </div>
                <PictureCardTools
                  pictureId={pic.id}
                  canRedraw={pic.origin !== "uploaded"}
                  disabled={working}
                  onDone={(m) => {
                    if (m) setMessage(m);
                    load();
                  }}
                />
              </div>
            </div>
            );
          })}
        </div>
      )}
      </Section>
    </div>
  );
}

/** A page section: heading, one-line hint, and a rule above it (except the first). */
function Section({ title, hint, first, children }: { title: string; hint: string; first?: boolean; children: React.ReactNode }) {
  return (
    <section className={first ? "mb-10" : "mb-10 border-t border-shodo-ink/15 pt-8"}>
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mb-4 text-sm text-shodo-ink-faint">{hint}</p>
      {children}
    </section>
  );
}
