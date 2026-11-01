"use client";

import { useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { apiFetch } from "@/lib/api-client";
import { JsonDisplay } from "@/components/JSONDisplay";
import ReportContentIssue from "@/components/lessons/ReportContentIssue";
import { ReviewFacet, KnowledgeUnit } from "@/types";

interface Props {
  facet: ReviewFacet;
}

export default function FacetDebugPanel({ facet }: Props) {
  const { isAdmin } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [targetKu, setTargetKu] = useState<KnowledgeUnit | null>(null);
  const [originKu, setOriginKu] = useState<KnowledgeUnit | null>(null);

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

  // Reports target the lesson the facet's sequence came from (the parent word for kanji-component facets).
  const reportKuId = originId ?? facet.kuId;
  const reportLabel = (originId ? originKu?.content : targetKu?.content) ?? reportKuId;

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

              <div className="pt-2 border-t border-gray-700">
                <ReportContentIssue kuId={reportKuId} kuContent={reportLabel} tone="dark" />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
