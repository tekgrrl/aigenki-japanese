"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface Status {
  eligible: boolean;
  reason?: string;
  facetCount: number;
}

/**
 * Admin: send your enrolled Vocab word back to Start Learning so it's relearned with
 * audio-first slides and enrolled audio-first. For pictures made after the lesson was
 * already under way. Checks on click (no fetch per card), then asks for a second click.
 */
export default function AudioFirstSwitch({ kuId }: { kuId: string }) {
  const [state, setState] = useState<
    "idle" | "checking" | "confirm" | "working" | "done"
  >("idle");
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const check = async () => {
    setState("checking");
    setMessage(null);
    try {
      const res = await apiFetch(`/api/reviews/audio-first/${kuId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Check failed (${res.status})`);
      }
      const s = (await res.json()) as Status;
      setStatus(s);
      if (s.eligible) setState("confirm");
      else {
        setMessage(s.reason ?? "Not possible for this word");
        setState("idle");
      }
    } catch (e) {
      setMessage((e as Error).message);
      setState("idle");
    }
  };

  const confirm = async () => {
    setState("working");
    try {
      const res = await apiFetch(`/api/reviews/audio-first/${kuId}`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Failed (${res.status})`);
      }
      setMessage(
        "Back in your lessons: it'll be taught audio-first next session",
      );
      setState("done");
    } catch (e) {
      setMessage((e as Error).message);
      setState("idle");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {state === "confirm" && status ? (
        <>
          <button
            type="button"
            onClick={confirm}
            className="rounded bg-shodo-ink px-3 py-1 font-semibold text-shodo-paper"
          >
            Back to lessons (deletes {status.facetCount} facet
            {status.facetCount === 1 ? "" : "s"})
          </button>
          <button
            type="button"
            onClick={() => setState("idle")}
            className="underline text-shodo-ink-light"
          >
            Cancel
          </button>
        </>
      ) : state !== "done" ? (
        <button
          type="button"
          disabled={state === "checking" || state === "working"}
          onClick={check}
          title="Relearn this word audio-first: deletes its facets and puts it back in Start Learning"
          className="underline text-shodo-ink-light disabled:opacity-40"
        >
          {state === "checking"
            ? "Checking…"
            : state === "working"
              ? "Working…"
              : "Teach audio-first…"}
        </button>
      ) : null}
      {message && (
        <span
          className={
            state === "done" ? "text-shodo-ink" : "text-shodo-persimmon"
          }
        >
          {message}
        </span>
      )}
    </div>
  );
}
