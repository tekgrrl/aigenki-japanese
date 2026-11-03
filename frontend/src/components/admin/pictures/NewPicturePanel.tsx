"use client";

import { useState } from "react";
import {
  buildSubject,
  type PictureBrief,
  SUBJECT_LABEL,
  type SubjectKind,
  sendJson,
} from "./pictureApi";

interface Props {
  /** Called once a render has started (the page polls job.rendering). */
  onStarted: (message: string) => void;
}

const input = "rounded border border-shodo-ink/15 bg-shodo-paper p-2 text-sm";

/**
 * Make one picture step by step: choose what it's of, draft a brief (optional), edit it,
 * then render. Rendering without a drafted brief drafts one on the server.
 */
export default function NewPicturePanel({ onStarted }: Props) {
  const [kind, setKind] = useState<SubjectKind>("ku-usage");
  const [word, setWord] = useState("");
  const [usage, setUsage] = useState("");
  const [note, setNote] = useState("");
  const [style, setStyle] = useState<"card" | "scene">("card");
  const [brief, setBrief] = useState<PictureBrief | null>(null);
  const [busy, setBusy] = useState<"draft" | "render" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needsWord = kind !== "none";
  const ready = needsWord ? !!word.trim() : !!note.trim() || !!brief;

  const draft = async () => {
    setBusy("draft");
    setError(null);
    try {
      const subject = await buildSubject(kind, word, usage);
      const drafted = await sendJson<PictureBrief>(
        "/api/pictures/briefs",
        "POST",
        { subject, note: note.trim() || undefined },
      );
      // The model writes "none" for no background; show it as an empty box (the
      // renderer treats empty and "none" alike) so the placeholder's examples appear.
      setBrief({
        ...drafted,
        background:
          drafted.background.trim().toLowerCase() === "none"
            ? ""
            : drafted.background,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const render = async () => {
    setBusy("render");
    setError(null);
    try {
      const subject = await buildSubject(kind, word, usage);
      await sendJson<{ id: string }>("/api/pictures", "POST", {
        subject: kind === "none" ? undefined : subject,
        brief: brief ?? undefined,
        note: note.trim() || undefined,
        style,
      });
      onStarted(
        `Rendering ${kind === "none" ? "a free-standing picture" : word.trim()}…`,
      );
      setBrief(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const patchBrief = (p: Partial<PictureBrief>) =>
    setBrief((b) => (b ? { ...b, ...p } : b));

  const actions = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={draft}
        disabled={!!busy || (needsWord ? !word.trim() : !note.trim())}
        className="rounded border border-shodo-ink/20 px-4 py-2 text-sm font-semibold disabled:opacity-40"
      >
        {busy === "draft" ? "Drafting…" : brief ? "Draft again" : "Draft brief"}
      </button>
      <button
        type="button"
        onClick={render}
        disabled={!!busy || !ready || (brief !== null && !brief.scene.trim())}
        className="rounded bg-shodo-ink px-4 py-2 text-sm font-semibold text-shodo-paper disabled:opacity-40"
      >
        {busy === "render"
          ? "Starting…"
          : brief
            ? "Render this brief"
            : "Render"}
      </button>
      {error && <span className="text-sm text-shodo-stamp-red">{error}</span>}
    </div>
  );

  return (
    <div className="rounded-lg border border-shodo-ink/10 bg-shodo-paper-warm p-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Subject"
          value={kind}
          onChange={(e) => setKind(e.target.value as SubjectKind)}
          className={input}
        >
          {(Object.keys(SUBJECT_LABEL) as SubjectKind[]).map((k) => (
            <option key={k} value={k}>
              {SUBJECT_LABEL[k]}
            </option>
          ))}
        </select>
        {needsWord && (
          <input
            aria-label="Word or KU id"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder={kind === "ku" ? "KU content or id" : "Word, e.g. 練習"}
            className={`${input} w-44`}
          />
        )}
        {kind === "ku-usage" && (
          <input
            aria-label="Usage"
            value={usage}
            onChange={(e) => setUsage(e.target.value)}
            placeholder="Usage (optional; defaults to the first)"
            className={`${input} w-64`}
          />
        )}
        <select
          aria-label="Style"
          value={style}
          onChange={(e) => setStyle(e.target.value as "card" | "scene")}
          className={input}
        >
          <option value="card">Card (square)</option>
          <option value="scene">Scene (wide)</option>
        </select>
      </div>
      <textarea
        aria-label="Note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={
          kind === "none"
            ? "Describe the picture"
            : "Note for the brief (optional)"
        }
        className={`${input} mt-2 w-full`}
      />

      {brief ? (
        <div className="mt-4">
          <h3 className="text-base font-bold">
            Draft Brief
            {!brief.picturable && (
              <span className="ml-2 text-xs font-normal text-shodo-persimmon">
                The model judged this unpicturable: edit the scene to override.
              </span>
            )}
          </h3>
          <div className="mt-2 ml-6 space-y-3">
            <textarea
              aria-label="Scene"
              value={brief.scene}
              onChange={(e) =>
                patchBrief({ scene: e.target.value, picturable: true })
              }
              rows={3}
              className={`${input} w-full`}
            />
            <label className="flex items-center gap-3">
              <span className="text-sm font-semibold text-shodo-ink-light">
                Background
              </span>
              <input
                value={brief.background}
                onChange={(e) => patchBrief({ background: e.target.value })}
                placeholder="e.g. a quiet classroom, a rainy street at dusk (empty = plain card)"
                className={`${input} flex-1`}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-shodo-ink-light">
              <input
                type="checkbox"
                checked={brief.includeCast}
                onChange={(e) => patchBrief({ includeCast: e.target.checked })}
              />
              Fude / Suzuri in the scene
            </label>
            <button
              type="button"
              onClick={() => setBrief(null)}
              className="block text-xs underline text-shodo-ink-faint"
            >
              Discard brief
            </button>
            {actions}
          </div>
        </div>
      ) : (
        <div className="mt-3">{actions}</div>
      )}
    </div>
  );
}
