"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";

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

interface ScenarioOpportunity {
  kuId: string;
  content: string;
  type: string;
  newLevel: string;
}

interface DailyPlan {
  date: string;
  reviewsDue: number;
  suggestNewContent: boolean;
  threshold: number;
  recentPromotions: PromotedEntry[];
  topLeeches: LeechEntry[];
  practiceOpportunities?: ScenarioOpportunity[];
}

interface Props {
  plan: DailyPlan;
  learnCount: number;
  onClose: () => void;
}

const SHORT_LABELS: Record<number, string> = {
  0: "I", 1: "II", 2: "III", 3: "IV",
  4: "Kaisho I", 5: "Kaisho II", 6: "Gyosho", 7: "Sosho", 8: "Mushin",
};

function stageTransition(stage: number): string {
  const to = SHORT_LABELS[stage] ?? `${stage}`;
  const from = SHORT_LABELS[stage - 1];
  return from ? `${from} → ${to}` : to;
}

// Hex colours per stage — used as inline styles to bypass Tailwind purging
function stageLabelColor(stage: number): string {
  if (stage <= 3) return "#D64A38"; // stamp-red (Sumi-suri)
  if (stage <= 5) return "#60a5fa"; // blue-400  (Kaisho)
  if (stage === 6) return "#7B8D42"; // matcha    (Gyosho)
  if (stage === 7) return "#E08A46"; // persimmon (Sosho)
  return "#C7A04D";                  // gold      (Mushin)
}

function PromotionBox({ entry }: { entry: PromotedEntry }) {
  return (
    // Stays a dark tile in dark mode too — the stage colours are tuned for a dark background.
    <div className="flex flex-col items-center justify-center rounded-lg bg-shodo-ink dark:bg-shodo-paper-warm dark:ring-1 dark:ring-shodo-ink/15 px-3 py-3 text-center min-w-0">
      <span className="text-lg font-bold leading-tight truncate w-full text-center text-white">
        {entry.content}
      </span>
      <span
        className="mt-1 text-xs font-medium leading-tight"
        style={{ color: stageLabelColor(entry.srsStage) }}
      >
        {stageTransition(entry.srsStage)}
      </span>
    </div>
  );
}

export default function DailyCheckInDialog({ plan, learnCount, onClose }: Props) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [showAllPromotions, setShowAllPromotions] = useState(false);
  const [opportunities, setOpportunities] = useState(plan.practiceOpportunities ?? []);
  const [practicingKuId, setPracticingKuId] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handlePractice(opp: ScenarioOpportunity) {
    setPracticingKuId(opp.kuId);
    try {
      const existingRes = await apiFetch(`/api/scenarios?sourceKuId=${encodeURIComponent(opp.kuId)}`);
      if (existingRes.ok) {
        const existing = await existingRes.json();
        if (Array.isArray(existing) && existing.length > 0) {
          dialogRef.current?.close();
          router.push(`/scenarios/${existing[0].id}`);
          return;
        }
      }

      const isVocab = opp.type === "Vocab";
      const genRes = await apiFetch("/api/tutor/generate-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isVocab
            ? { sourceType: "context-example", targetVocab: opp.content, sourceKuId: opp.kuId, strict: true }
            : { sourceType: "grammar-pattern", pattern: opp.content, sourceKuId: opp.kuId, strict: true },
        ),
      });
      if (genRes.ok) {
        const { id } = await genRes.json();
        dialogRef.current?.close();
        router.push(`/scenarios/${id}`);
      }
    } catch (e) {
      console.error("Failed to start scenario practice", e);
    } finally {
      setPracticingKuId(null);
    }
  }

  async function handleDismissOpportunity(kuId: string) {
    setOpportunities(prev => prev.filter(o => o.kuId !== kuId));
    try {
      await apiFetch(`/api/daily-plan/opportunities/${encodeURIComponent(kuId)}/dismiss`, { method: "PATCH" });
    } catch (e) {
      console.error("Failed to dismiss practice opportunity", e);
    }
  }

  const reviewColor =
    plan.reviewsDue === 0
      ? "text-shodo-matcha"
      : plan.reviewsDue < plan.threshold
      ? "text-shodo-persimmon"
      : "text-shodo-stamp-red";

  const visiblePromotions = plan.recentPromotions.slice(0, 4);
  const hiddenPromotions = plan.recentPromotions.slice(4);

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

        {/* Reviews Due + Available Lessons + image */}
        <div className="flex gap-3 items-stretch">
          {/* Reviews Due */}
          <div className="flex-1 rounded-xl border border-shodo-ink/10 bg-shodo-ink/[0.02] p-4 flex flex-col">
            <div className="text-sm font-medium text-shodo-ink/60 mb-1">Reviews due</div>
            <div className={`text-3xl font-bold ${reviewColor}`}>
              {plan.reviewsDue}
            </div>
            {plan.reviewsDue >= plan.threshold && (
              <p className="mt-1 text-xs text-shodo-ink/70">
                Focus on reviews before new material.
              </p>
            )}
            {plan.reviewsDue === 0 && (
              <p className="mt-1 text-xs text-shodo-matcha font-medium">All clear!</p>
            )}
            {plan.reviewsDue > 0 && (
              <Link
                href="/review"
                onClick={onClose}
                className="mt-auto pt-3 inline-block rounded-lg bg-shodo-ink px-3 py-2 text-sm font-medium text-shodo-paper hover:bg-shodo-ink/80 transition-colors text-center"
              >
                Start Reviews
              </Link>
            )}
          </div>

          {/* Available Lessons */}
          <div className="flex-1 rounded-xl border border-shodo-ink/10 bg-shodo-ink/[0.02] p-4 flex flex-col">
            <div className="text-sm font-medium text-shodo-ink/60 mb-1">Available lessons</div>
            <div className="text-3xl font-bold text-shodo-ink">
              {learnCount > 0 ? learnCount : "~10"}
            </div>
            <Link
              href="/learn/session"
              onClick={onClose}
              className="mt-auto pt-3 rounded-lg bg-shodo-ink px-3 py-2 text-sm font-medium text-shodo-paper hover:bg-shodo-ink/80 transition-colors text-center w-full"
            >
              Start Learning
            </Link>
          </div>

          {/* Portrait image */}
          <div className="shrink-0 rounded-xl overflow-hidden w-20">
            <img src="/daily.png" alt="" className="h-full w-full object-cover" />
          </div>
        </div>

        {/* Recent Promotions */}
        {plan.recentPromotions.length > 0 && (
          <div>
            <div className="text-sm font-medium text-shodo-ink/60 mb-2">
              Promoted in the last 24h
            </div>
            <div className="grid grid-cols-4 gap-2">
              {visiblePromotions.map((p, i) => (
                <PromotionBox key={`${p.kuId}-${p.srsStage}-${i}`} entry={p} />
              ))}
            </div>

            {hiddenPromotions.length > 0 && (
              <>
                <button
                  onClick={() => setShowAllPromotions(v => !v)}
                  className="mt-2 text-xs text-shodo-indigo hover:underline underline-offset-2 transition-colors"
                >
                  {showAllPromotions
                    ? "Show less"
                    : `Show all ${plan.recentPromotions.length}`}
                </button>
                {showAllPromotions && (
                  <div className="mt-2 grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                    {hiddenPromotions.map((p, i) => (
                      <PromotionBox key={`${p.kuId}-${p.srsStage}-${i}`} entry={p} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Practice Opportunities */}
        {opportunities.length > 0 && (
          <div>
            <div className="text-sm font-medium text-shodo-ink/60 mb-2">
              Ready to practice
            </div>
            <ul className="flex flex-col gap-2">
              {opportunities.map((opp) => (
                <li
                  key={opp.kuId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-shodo-indigo/20 bg-shodo-indigo/5 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-shodo-ink">{opp.content}</span>
                    <span className="ml-2 text-xs text-shodo-ink/60">
                      reached {opp.newLevel}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handlePractice(opp)}
                      disabled={practicingKuId === opp.kuId}
                      className="rounded-lg bg-shodo-indigo px-3 py-1.5 text-xs font-medium text-shodo-paper hover:bg-shodo-indigo/80 transition-colors disabled:opacity-50 disabled:cursor-wait"
                    >
                      {practicingKuId === opp.kuId ? "Starting…" : "Practice in a Scenario"}
                    </button>
                    <button
                      onClick={() => handleDismissOpportunity(opp.kuId)}
                      className="rounded-lg border border-shodo-ink/10 bg-shodo-ink/5 px-2 py-1.5 text-xs text-shodo-ink/60 hover:bg-shodo-ink/10 hover:text-shodo-ink transition-colors"
                    >
                      Not now
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Top Leeches */}
        {plan.topLeeches.length > 0 && (
          <div>
            <div className="text-sm font-medium text-shodo-ink/60 mb-2">
              Worth revisiting
            </div>
            <ul className="flex flex-col gap-1">
              {plan.topLeeches.map((l) => (
                <li
                  key={l.kuId}
                  className="flex items-center justify-between rounded-lg border border-shodo-stamp-red/20 bg-shodo-stamp-red/5 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-shodo-ink">{l.content}</span>
                  <span className="text-xs text-shodo-stamp-red ml-2 shrink-0">
                    {l.consecutiveFailures} attempts
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* New content nudge */}
        {plan.suggestNewContent && (
          <div className="rounded-xl border border-shodo-matcha/30 bg-shodo-matcha/10 p-4 text-sm text-shodo-ink">
            Your review load is under control — a good day to learn something new.
            <Link
              href="/learn"
              onClick={onClose}
              className="ml-2 font-medium text-shodo-matcha underline underline-offset-2 hover:opacity-80"
            >
              Go to Learn
            </Link>
          </div>
        )}

        {/* Primary CTA — routes to whatever's actually next, not just a dismiss */}
        <button
          onClick={() => {
            onClose();
            if (plan.reviewsDue > 0) router.push("/review");
            else if (plan.suggestNewContent) router.push("/learn");
          }}
          className="w-full rounded-lg border border-shodo-ink/20 py-2 text-sm text-shodo-ink/70 hover:bg-shodo-ink/5 transition-colors"
        >
          Let's go
        </button>
      </div>
    </dialog>
  );
}
