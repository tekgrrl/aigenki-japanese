"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import KuUsagePicker from "./KuUsagePicker";
import { sendJson } from "./pictureApi";

interface Props {
  /** Called once a picture has been started or uploaded (the page reloads and polls). */
  onStarted: (message: string) => void;
}

const button = "rounded px-3 py-1 text-xs font-semibold disabled:opacity-40";

/**
 * Add a Picture: find the word, pick a usage with no picture, then Generate or Upload.
 * The new picture waits in Needs Review; nothing here waits for it to finish.
 */
export default function AddPicturePanel({ onStarted }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setError(null);
    try {
      onStarted(await fn());
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const generate = (kuId: string, usage: string, label: string) =>
    run(`${kuId}:${usage}`, async () => {
      await sendJson("/api/pictures", "POST", { subject: { kind: "ku-usage", kuId, usage } });
      return `Drawing ${label}… It will appear in Needs Review.`;
    });

  const upload = (kuId: string, usage: string, label: string, file: File) =>
    run(`${kuId}:${usage}`, async () => {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "ku-usage");
      form.append("kuId", kuId);
      form.append("usage", usage);
      const res = await apiFetch("/api/pictures/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
      return `Uploaded ${label}. It's waiting in Needs Review.`;
    });

  return (
    <div className="rounded-lg border border-shodo-ink/10 bg-shodo-paper-warm p-4">
      <KuUsagePicker
        refreshKey={refreshKey}
        actions={(ku, u) => {
          if (u.state !== "none") return null;
          const kuId = ku.id;
          const key = `${kuId}:${u.usage}`;
          const label = `${ku.content} (${u.usage})`;
          return (
            <>
              <button
                type="button"
                disabled={busy === key}
                onClick={() => generate(kuId, u.usage, label)}
                className={`${button} bg-shodo-ink text-shodo-paper`}
              >
                {busy === key ? "Starting…" : "Generate"}
              </button>
              <label className={`${button} cursor-pointer border border-shodo-ink/20`}>
                Upload…
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={busy === key}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) upload(kuId, u.usage, label, f);
                  }}
                />
              </label>
            </>
          );
        }}
      />
      {error && <p className="mt-2 text-xs text-shodo-stamp-red">{error}</p>}
    </div>
  );
}
