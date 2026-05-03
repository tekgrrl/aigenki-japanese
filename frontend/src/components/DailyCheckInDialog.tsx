"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

interface PromotedEntry {
  kuId: string;
  content: string;
  type: string;
  srsStage: number;
}

interface LeechEntry {
  kuId: string;
  content: string;
  type: string;
  consecutiveFailures: number;
}

interface DailyPlan {
  date: string;
  reviewsDue: number;
  suggestNewContent: boolean;
  threshold: number;
  recentPromotions: PromotedEntry[];
  topLeeches: LeechEntry[];
}

interface Props {
  plan: DailyPlan;
  onClose: () => void;
}

const SRS_LABELS: Record<number, string> = {
  0: "Sumi-suri I",
  1: "Sumi-suri II",
  2: "Sumi-suri III",
  3: "Sumi-suri IV",
  4: "Kaisho I",
  5: "Kaisho II",
  6: "Gyosho",
  7: "Sosho",
  8: "Mushin",
};

export default function DailyCheckInDialog({ plan, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const reviewColor =
    plan.reviewsDue === 0
      ? "text-green-600"
      : plan.reviewsDue < plan.threshold
      ? "text-amber-600"
      : "text-red-600";

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="backdrop:bg-shodo-ink/40 rounded-2xl border border-shodo-ink/10 bg-shodo-paper p-0 shadow-xl w-full max-w-lg mx-auto"
    >
      <div className="flex flex-col gap-5 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-shodo-ink">Today's Check-in</h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-shodo-ink/50 hover:bg-shodo-ink/5 hover:text-shodo-ink transition-colors"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>

        {/* Reviews Due */}
        <div className="rounded-xl border border-shodo-ink/10 bg-shodo-ink/[0.02] p-4">
          <div className="text-sm font-medium text-shodo-ink/60 mb-1">Reviews due</div>
          <div className={`text-3xl font-bold ${reviewColor}`}>
            {plan.reviewsDue}
          </div>
          {plan.reviewsDue >= plan.threshold && (
            <p className="mt-1 text-sm text-shodo-ink/70">
              Focus on reviews before starting new material.
            </p>
          )}
          {plan.reviewsDue > 0 && (
            <Link
              href="/review"
              onClick={onClose}
              className="mt-3 inline-block rounded-lg bg-shodo-ink px-4 py-2 text-sm font-medium text-shodo-paper hover:bg-shodo-ink/80 transition-colors"
            >
              Start Reviews
            </Link>
          )}
          {plan.reviewsDue === 0 && (
            <p className="mt-1 text-sm text-green-600 font-medium">All clear!</p>
          )}
        </div>

        {/* Recent Promotions */}
        {plan.recentPromotions.length > 0 && (
          <div>
            <div className="text-sm font-medium text-shodo-ink/60 mb-2">
              Promoted in the last 24h
            </div>
            <ul className="flex flex-col gap-1">
              {plan.recentPromotions.map((p) => (
                <li
                  key={`${p.kuId}-${p.srsStage}`}
                  className="flex items-center justify-between rounded-lg border border-shodo-ink/10 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-shodo-ink">{p.content}</span>
                  <span className="text-xs text-shodo-ink/50 ml-2 shrink-0">
                    → {SRS_LABELS[p.srsStage] ?? `Stage ${p.srsStage}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Top Leeches */}
        {plan.topLeeches.length > 0 && (
          <div>
            <div className="text-sm font-medium text-shodo-ink/60 mb-2">
              Struggling with
            </div>
            <ul className="flex flex-col gap-1">
              {plan.topLeeches.map((l) => (
                <li
                  key={l.kuId}
                  className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-shodo-ink">{l.content}</span>
                  <span className="text-xs text-red-500 ml-2 shrink-0">
                    {l.consecutiveFailures}× failed
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* New content nudge */}
        {plan.suggestNewContent && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            Your review load is under control — a good day to learn something new.
            <Link
              href="/learn"
              onClick={onClose}
              className="ml-2 font-medium underline underline-offset-2 hover:text-green-900"
            >
              Go to Learn
            </Link>
          </div>
        )}

        {/* Dismiss */}
        <button
          onClick={onClose}
          className="w-full rounded-lg border border-shodo-ink/20 py-2 text-sm text-shodo-ink/70 hover:bg-shodo-ink/5 transition-colors"
        >
          Let's go
        </button>
      </div>
    </dialog>
  );
}
