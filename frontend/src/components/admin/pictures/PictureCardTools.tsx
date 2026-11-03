"use client";

import { useState } from "react";
import {
  buildSubject,
  SUBJECT_LABEL,
  type SubjectKind,
  sendJson,
} from "./pictureApi";

interface Props {
  pictureId: string;
  /** Uploaded pictures can't be redrawn. */
  canRedraw: boolean;
  disabled: boolean;
  onDone: (message?: string) => void;
}

const input = "rounded border border-shodo-ink/15 bg-shodo-paper p-1.5 text-xs";

/** Per-picture extras: redraw steered by a note, and (re)attach to another subject. */
export default function PictureCardTools({
  pictureId,
  canRedraw,
  disabled,
  onDone,
}: Props) {
  const [open, setOpen] = useState<"note" | "attach" | null>(null);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<SubjectKind>("ku-usage");
  const [word, setWord] = useState("");
  const [usage, setUsage] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  const toggle = (which: "note" | "attach") =>
    setOpen((o) => (o === which ? null : which));

  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-xs">
        {canRedraw && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => toggle("note")}
            className="underline text-shodo-ink-light disabled:opacity-40"
          >
            Redraw with note…
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => toggle("attach")}
          className="underline text-shodo-ink-light disabled:opacity-40"
        >
          Re-attach…
        </button>
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
            onClick={() =>
              run(() =>
                sendJson(`/api/pictures/${pictureId}/redraw`, "POST", {
                  note: note.trim(),
                }),
              )
            }
            className="rounded bg-shodo-ink px-3 py-1 text-xs font-semibold text-shodo-paper disabled:opacity-40"
          >
            Redraw
          </button>
        </div>
      )}

      {open === "attach" && (
        <div className="flex flex-wrap items-center gap-1">
          <select
            aria-label="Attach to"
            value={kind}
            onChange={(e) => setKind(e.target.value as SubjectKind)}
            className={input}
          >
            {(Object.keys(SUBJECT_LABEL) as SubjectKind[]).map((k) => (
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
          {kind === "ku-usage" && (
            <input
              aria-label="Usage"
              value={usage}
              onChange={(e) => setUsage(e.target.value)}
              placeholder="Usage"
              className={`${input} w-28`}
            />
          )}
          <button
            type="button"
            disabled={kind !== "none" && !word.trim()}
            onClick={() =>
              run(
                async () => {
                  const subject = await buildSubject(kind, word, usage);
                  await sendJson(`/api/pictures/${pictureId}`, "PATCH", {
                    subject,
                  });
                },
                kind === "none" ? "Detached" : "Re-attached",
              )
            }
            className="rounded bg-shodo-ink px-3 py-1 text-xs font-semibold text-shodo-paper disabled:opacity-40"
          >
            Save
          </button>
        </div>
      )}
      {error && <p className="text-xs text-shodo-stamp-red">{error}</p>}
    </div>
  );
}
