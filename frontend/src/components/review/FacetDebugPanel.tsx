"use client";

import { useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { apiFetch } from "@/lib/api-client";
import { JsonDisplay } from "@/components/JSONDisplay";
import ReportContentIssue from "@/components/lessons/ReportContentIssue";
import { ReviewFacet, KnowledgeUnit } from "@/types";

interface Props {
  facet: ReviewFacet;
  /** Called after a successful regenerate-and-reset, so the review page can move past the now-deleted facet. */
  onRegenerated?: (kuId: string) => void;
}

type RegenState = "idle" | "confirm" | "running" | "done" | "error";

export default function FacetDebugPanel({ facet, onRegenerated }: Props) {
  const { isAdmin } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [targetKu, setTargetKu] = useState<KnowledgeUnit | null>(null);
  const [originKu, setOriginKu] = useState<KnowledgeUnit | null>(null);
  const [regenState, setRegenState] = useState<RegenState>("idle");
  const [regenMessage, setRegenMessage] = useState<string | null>(null);

  if (!isAdmin) return null;

  // Kanji-Component-* facets target the component kanji's own kuId but are
  // gated by the parent Vocab/Grammar word's sequence via source.id — surface
  // that distinction rather than only showing the facet's direct target.
  const originId = facet.source?.id && facet.source.id !== facet.kuId ? facet.source.id : null;

  const handleToggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !targetKu && !loading) {
      setLoading(true);
      try {
        const fetches: Promise<Response>[] = [apiFetch(`/api/knowledge-units/${facet.kuId}`)];
        if (originId) fetches.push(apiFetch(`/api/knowledge-units/${originId}`));

        const [kuRes, originRes] = await Promise.all(fetches);
        if (kuRes.ok) setTargetKu(await kuRes.json());
        if (originRes?.ok) setOriginKu(await originRes.json());
      } finally {
        setLoading(false);
      }
    }
  };

  // Regeneration rebuilds the lesson the facet's sequence came from (the parent word for
  // kanji-component facets). Concepts and scenarios regenerate differently — not offered.
  const regenKuId = originId ?? facet.kuId;
  const regenLabel = (originId ? originKu?.content : targetKu?.content) ?? regenKuId;
  const canRegenerate = facet.sourceCollection !== "concepts" && facet.sourceCollection !== "scenarios";

  const handleRegenerate = async () => {
    setRegenState("running");
    setRegenMessage(null);
    try {
      const res = await apiFetch(`/api/reviews/regenerate-and-reset/${regenKuId}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Request failed (${res.status})`);
      }
      const { facetsDeleted, facetsCreated } = await res.json();
      setRegenState("done");
      setRegenMessage(`Regenerated. Deleted ${facetsDeleted} review item(s), created ${facetsCreated}.`);
      // Brief pause so the result is readable before the card advances.
      setTimeout(() => onRegenerated?.(regenKuId), 1500);
    } catch (err) {
      console.error("[FacetDebugPanel] regenerate-and-reset failed", err);
      setRegenState("error");
      // The request can fail (e.g. a proxy timeout) while the backend carries on and deletes
      // this KU's facets anyway — so move past them either way rather than leaving stale
      // items in the session that would 404 when answered. If it really failed, they simply
      // come back next session.
      setRegenMessage(
        `${err instanceof Error ? err.message : "Request failed"} — it may still be running; check the backend console. Skipping this item.`,
      );
      setTimeout(() => onRegenerated?.(regenKuId), 2500);
    }
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={handleToggle}
        className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
      >
        {expanded ? "▾" : "▸"} 🛠 Debug
      </button>

      {expanded && (
        <div className="mt-2 rounded-lg border border-gray-600 bg-gray-900 p-4 space-y-3 text-sm text-gray-300">
          {loading ? (
            <p className="text-gray-400">Loading…</p>
          ) : (
            <>
              <div className="space-y-1">
                <p>
                  <span className="text-gray-500">facetType:</span> {facet.facetType}
                </p>
                <p>
                  <span className="text-gray-500">srsStage:</span> {facet.srsStage}
                  {facet.sequenceStage !== undefined && (
                    <>
                      {" "}
                      · <span className="text-gray-500">sequenceStage:</span> {facet.sequenceStage}
                    </>
                  )}
                </p>
                <p>
                  <span className="text-gray-500">kuId:</span> {facet.kuId}
                  {targetKu && <span className="text-gray-400"> ({targetKu.content})</span>}
                </p>
                {originId && (
                  <p>
                    <span className="text-gray-500">originated from:</span> {originId}
                    {originKu && <span className="text-gray-400"> ({originKu.content})</span>}
                  </p>
                )}
              </div>

              {facet.data && <JsonDisplay data={facet.data} />}

              {canRegenerate && (
                <div className="pt-2 border-t border-gray-700 space-y-2">
                  {regenState === "idle" && (
                    <button
                      type="button"
                      onClick={() => setRegenState("confirm")}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded-md transition-colors"
                    >
                      Regenerate lesson &amp; reset reviews
                    </button>
                  )}
                  {regenState === "confirm" && (
                    <div className="space-y-2">
                      <p className="text-xs text-amber-300">
                        Regenerates the lesson for <span className="font-semibold">{regenLabel}</span> and deletes your
                        review items and SRS progress for it. New items start from scratch.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleRegenerate}
                          className="px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs font-medium rounded-md transition-colors"
                        >
                          Confirm regenerate
                        </button>
                        <button
                          type="button"
                          onClick={() => setRegenState("idle")}
                          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded-md transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {regenState === "running" && <p className="text-xs text-gray-400">Regenerating… (can take ~30s)</p>}
                  {(regenState === "done" || regenState === "error") && regenMessage && (
                    <p className={`text-xs ${regenState === "done" ? "text-green-300" : "text-red-300"}`}>{regenMessage}</p>
                  )}
                </div>
              )}

              <div className="pt-2 border-t border-gray-700">
                <ReportContentIssue kuId={regenKuId} kuContent={regenLabel} tone="dark" />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
