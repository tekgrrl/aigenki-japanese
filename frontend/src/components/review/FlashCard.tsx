"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { ReviewFacet } from "@/types";

type Step = "drill" | "graduate" | "simulate" | "complete";

interface FlashData {
  kind: "scenario";
  step: Step;
  scenarioId: string;
  scenarioTitle: string;
  grammarContent: string;
}

interface Props {
  facet: ReviewFacet;
  onAdvance: () => void;
}

const STEP_TEXT: Record<Step, { title: (t: string) => string; body: string }> =
  {
    drill: {
      title: (t) => `Read through “${t}”`,
      body: "Go through the scenario's dialogue. Its key words and grammar join your reviews.",
    },
    graduate: {
      title: (t) => `Get “${t}”'s words and grammar to Familiar`,
      body: "The roleplay opens once every key word and grammar point reaches Familiar. Your normal reviews get them there.",
    },
    simulate: {
      title: (t) => `Start the roleplay in “${t}”`,
      body: "Every key word and grammar point is at Familiar: the roleplay is open.",
    },
    complete: {
      title: (t) => `Finish the roleplay in “${t}”`,
      body: "Play your part through to the end of the scenario.",
    },
  };

/**
 * A one-and-done Flash card: a step of a Grammar point's scenario chain. It's done
 * when the scenario itself gets there (the backend syncs it), not by answering here.
 */
export default function FlashCard({ facet, onAdvance }: Props) {
  const router = useRouter();
  const data = facet.data as FlashData;
  const text = STEP_TEXT[data.step] ?? STEP_TEXT.drill;
  const [progress, setProgress] = useState<{
    ready: number;
    total: number;
  } | null>(null);
  const [acking, setAcking] = useState(false);

  // The waiting step shows how far along the scenario's key items are.
  useEffect(() => {
    if (data.step !== "graduate") return;
    apiFetch(`/api/scenarios/${data.scenarioId}/ku-status`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          s: {
            items: Record<string, { minSrsStage: number | null }>;
            minStage: number;
          } | null,
        ) => {
          if (!s?.items) return;
          const all = Object.values(s.items);
          setProgress({
            ready: all.filter((i) => (i.minSrsStage ?? -1) >= s.minStage)
              .length,
            total: all.length,
          });
        },
      )
      .catch(() => {});
  }, [data.step, data.scenarioId]);

  // Seeing the card is all it asks: either button hides it for the first SRS interval
  // (8h). It comes back if the step still isn't done, or moves on sooner if it is.
  const seen = async () => {
    setAcking(true);
    try {
      await apiFetch(`/api/reviews/flash/${facet.id}/ack`, { method: "POST" });
    } catch (e) {
      console.error("[flash] acknowledge failed", e);
    }
  };

  return (
    <div className="bg-gray-800 shadow-2xl rounded-lg p-8 text-center space-y-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-300">
        Scenario · {data.grammarContent}
      </p>
      <h2 className="text-2xl font-bold text-white">
        {text.title(data.scenarioTitle || "your scenario")}
      </h2>
      <p className="text-gray-300">{text.body}</p>
      {progress && (
        <p className="text-gray-200 font-medium">
          {progress.ready}/{progress.total} at Familiar
        </p>
      )}
      <div className="flex justify-center gap-3 pt-2">
        <button
          type="button"
          disabled={acking}
          onClick={async () => {
            await seen();
            router.push(`/scenarios/${data.scenarioId}`);
          }}
          className="rounded-lg bg-shodo-paper px-4 py-2 text-sm font-semibold text-shodo-ink hover:opacity-90 disabled:opacity-40"
        >
          Open scenario
        </button>
        <button
          type="button"
          disabled={acking}
          onClick={async () => {
            await seen();
            onAdvance();
          }}
          className="rounded-lg border border-gray-500 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-700 disabled:opacity-40"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
