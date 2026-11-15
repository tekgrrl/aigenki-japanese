"use client";

/**
 * "I don't know this" flag for sentence-assembly pieces (issue #222): long-press a piece to flag
 * the learnable word inside it, without disturbing the tap that places it. Pieces bundle particles
 * with their word ("先生は"), so the flag offers the matching learnableTerm (a dictionary-form word
 * the lesson generator picked out), and only when there is one. Shared by both assembly cards.
 */
import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";

const LONG_PRESS_MS = 500;

export interface LearnableTerm {
  term: string;
  surfaceForm: string;
  reading: string;
  meaning: string;
}

export function useFragmentFlag(learnableTerms: LearnableTerm[] | undefined) {
  const [flagTerm, setFlagTerm] = useState<LearnableTerm | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  const termIn = (fragment: string) => (learnableTerms ?? []).find(t => fragment.includes(t.surfaceForm || t.term));

  const cancelPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  /** Pointer handlers for a piece button. */
  const pressHandlers = (fragment: string) => ({
    onPointerDown: () => {
      longPressTriggered.current = false;
      const match = termIn(fragment);
      if (!match) return;
      pressTimer.current = setTimeout(() => {
        longPressTriggered.current = true;
        setFlagTerm(match);
      }, LONG_PRESS_MS);
    },
    onPointerUp: cancelPress,
    onPointerLeave: cancelPress,
    title: termIn(fragment) ? "Long-press if you don't know this" : undefined,
  });

  /** Call first in a piece's click handler: true when the click ended a long press (ignore it). */
  const swallowClick = () => {
    if (!longPressTriggered.current) return false;
    longPressTriggered.current = false;
    return true;
  };

  const choose = async (choice: "exclude" | "enroll") => {
    if (!flagTerm) return;
    setSending(true);
    try {
      const res = await apiFetch("/api/learner-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: flagTerm.term, kuType: "Vocab", choice, context: "sentence-assembly" }),
      });
      if (!res.ok) throw new Error("Flag request failed");
      setMessage(choice === "exclude" ? "Got it — won't show this for a while." : "Added to your learning queue.");
    } catch {
      setMessage("Something went wrong — try again later.");
    } finally {
      setSending(false);
      setTimeout(() => { setFlagTerm(null); setMessage(null); }, 2500);
    }
  };

  const panel = flagTerm ? (
    <div className="rounded-lg border border-gray-600 bg-gray-900 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-300">
          Don&apos;t know <span className="text-white font-semibold">{flagTerm.term}</span>
          {flagTerm.reading && flagTerm.reading !== flagTerm.term && <span className="text-gray-400"> ({flagTerm.reading})</span>}
          {flagTerm.meaning && <span className="text-gray-400"> — {flagTerm.meaning}</span>}?
        </p>
        <button onClick={() => { setFlagTerm(null); setMessage(null); }} className="text-gray-500 hover:text-gray-300 text-sm shrink-0" aria-label="Dismiss">✕</button>
      </div>
      {message ? (
        <p className="text-sm text-green-300">{message}</p>
      ) : (
        <div className="flex gap-3">
          <button onClick={() => choose("exclude")} disabled={sending} className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-md transition-colors disabled:opacity-50">
            Not now
          </button>
          <button onClick={() => choose("enroll")} disabled={sending} className="flex-1 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-sm rounded-md transition-colors disabled:opacity-50">
            Help me learn this
          </button>
        </div>
      )}
    </div>
  ) : null;

  return { pressHandlers, swallowClick, panel };
}
