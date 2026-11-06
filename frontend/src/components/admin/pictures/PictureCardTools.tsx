"use client";

import { useState } from "react";
import type { AdminPicture } from "@/types";
import BriefEditor from "./BriefEditor";
import KuUsagePicker from "./KuUsagePicker";
import {
  buildSubject,
  type PictureBrief,
  SUBJECT_LABEL,
  type SubjectKind,
  sendJson,
} from "./pictureApi";

interface Props {
  pic: AdminPicture;
  disabled: boolean;
  onDone: (message?: string) => void;
}

type Tool = "note" | "brief" | "usage" | "attach";

const input = "rounded border border-shodo-ink/15 bg-shodo-paper p-1.5 text-xs";
const link = "underline text-shodo-ink-light disabled:opacity-40";
const primary = "rounded bg-shodo-ink px-3 py-1 text-xs font-semibold text-shodo-paper disabled:opacity-40";

const EMPTY_BRIEF: PictureBrief = { picturable: true, includeCast: false, background: "", scene: "" };

/**
 * Per-picture tools, by where the picture is. Approved pictures get none here (changing
 * a bound picture is a later step). Needs Review: redraw with a note or an edited brief,
 * change the word/usage it's made for. Unpicturable (the AI's call): redraw.
 */
export default function PictureCardTools({ pic, disabled, onDone }: Props) {
  const [open, setOpen] = useState<Tool | null>(null);
  const [note, setNote] = useState("");
  const [brief, setBrief] = useState<PictureBrief>(EMPTY_BRIEF);
  const [kind, setKind] = useState<SubjectKind>("ku");
  const [word, setWord] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (pic.status === "approved") return null;
  const generated = pic.origin !== "uploaded";
  const isUsage = !pic.subject || pic.subject.kind === "ku-usage";
  const reviewing = pic.status === "needs-review";

  const run = async (fn: () => Promise<unknown>, message?: string) => {
    setError(null);
    try {
      await fn();
      setOpen(null);
      onDone(message);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggle = (which: Tool) => {
    if (which === "brief") setBrief({ ...EMPTY_BRIEF, ...pic.brief, background: pic.brief?.background === "none" ? "" : (pic.brief?.background ?? "") });
    setOpen((o) => (o === which ? null : which));
  };

  const tools: { key: Tool; label: string; show: boolean }[] = [
    { key: "note", label: "Redraw with note…", show: generated },
    { key: "brief", label: "Edit brief & redraw…", show: generated && pic.status !== "rejected" },
    { key: "usage", label: "Change word/usage…", show: reviewing && isUsage },
    { key: "attach", label: "Re-attach…", show: reviewing && !isUsage },
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {tools
          .filter((t) => t.show)
          .map((t) => (
            <button key={t.key} type="button" disabled={disabled} onClick={() => toggle(t.key)} className={link}>
              {t.label}
            </button>
          ))}
      </div>

      {open === "note" && (
        <div className="space-y-1">
          <textarea
            aria-label="Redraw note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="What to change, e.g. show a clock, no background"
            className={`${input} w-full`}
          />
          <button
            type="button"
            disabled={!note.trim()}
            onClick={() => run(() => sendJson(`/api/pictures/${pic.id}/redraw`, "POST", { note: note.trim() }))}
            className={primary}
          >
            Redraw
          </button>
        </div>
      )}

      {open === "brief" && (
        <div className="space-y-2">
          <BriefEditor brief={brief} onChange={setBrief} compact />
          <button
            type="button"
            disabled={!brief.scene.trim()}
            onClick={() =>
              run(() =>
                sendJson(`/api/pictures/${pic.id}/redraw`, "POST", {
                  // Redrawing is the admin's choice to draw it, so the brief is picturable.
                  brief: { picturable: true, includeCast: brief.includeCast, background: brief.background, scene: brief.scene },
                }),
              )
            }
            className={primary}
          >
            Redraw this brief
          </button>
        </div>
      )}

      {open === "usage" && (
        <div className="rounded border border-shodo-ink/10 p-2">
          <KuUsagePicker
            compact
            actions={(ku, u) =>
              ku.id === pic.kuId && u.usage.trim().toLowerCase() === pic.usage.trim().toLowerCase() ? (
                <span className="text-xs text-shodo-ink-faint">Current</span>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    run(
                      () => sendJson(`/api/pictures/${pic.id}`, "PATCH", { subject: { kind: "ku-usage", kuId: ku.id, usage: u.usage } }),
                      `Now made for ${ku.content} (${u.usage})`,
                    )
                  }
                  className={primary}
                >
                  Use this
                </button>
              )
            }
          />
        </div>
      )}

      {open === "attach" && (
        <div className="flex flex-wrap items-center gap-1">
          <select aria-label="Attach to" value={kind} onChange={(e) => setKind(e.target.value as SubjectKind)} className={input}>
            {(["ku", "none"] as SubjectKind[]).map((k) => (
              <option key={k} value={k}>
                {k === "none" ? "Detach (free-standing)" : SUBJECT_LABEL[k]}
              </option>
            ))}
          </select>
          {kind !== "none" && (
            <input
              aria-label="Word or KU id"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="Word / KU id"
              className={`${input} w-28`}
            />
          )}
          <button
            type="button"
            disabled={kind !== "none" && !word.trim()}
            onClick={() =>
              run(
                async () => {
                  const subject = await buildSubject(kind, word, "");
                  await sendJson(`/api/pictures/${pic.id}`, "PATCH", { subject });
                },
                kind === "none" ? "Detached" : "Re-attached",
              )
            }
            className={primary}
          >
            Save
          </button>
        </div>
      )}

      {error && <p className="text-xs text-shodo-stamp-red">{error}</p>}
    </div>
  );
}
