"use client";

import React, { Fragment, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { ConceptKnowledgeUnit } from "@/types";
import { FuriganaText } from "@/components/FuriganaText";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function highlightClause(text: string, target: string) {
  if (!target) return <span>{text}</span>;
  const parts = text.split(target);
  if (parts.length === 1) return <span>{text}</span>;
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <span className="font-bold underline decoration-dotted decoration-shodo-ink/60 underline-offset-2">
              {target}
            </span>
          )}
        </Fragment>
      ))}
    </>
  );
}

function furiganaHighlight(text: string, target: string): React.ReactNode {
  if (!target) return <FuriganaText text={text} />;

  // Strip [reading] annotations to locate the plain-text target
  const stripped = text.replace(/\[[^\]]+\]/g, '');
  const idx = stripped.indexOf(target);
  if (idx === -1) return <FuriganaText text={text} />;

  // Build a map: stripped-text index → original-string index
  const strippedToOrig: number[] = [];
  let si = 0;
  let inBracket = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[') { inBracket = true; continue; }
    if (text[i] === ']') { inBracket = false; continue; }
    if (!inBracket) strippedToOrig[si++] = i;
  }

  const origStart = strippedToOrig[idx];
  let origEnd = strippedToOrig[idx + target.length - 1] + 1;
  // Include any [reading] bracket that immediately follows the last target character
  if (origEnd < text.length && text[origEnd] === '[') {
    const close = text.indexOf(']', origEnd);
    if (close !== -1) origEnd = close + 1;
  }

  return (
    <>
      <FuriganaText text={text.slice(0, origStart)} />
      <mark className="bg-shodo-accent/15 text-shodo-accent rounded px-0.5 not-italic">
        <FuriganaText text={text.slice(origStart, origEnd)} />
      </mark>
      <FuriganaText text={text.slice(origEnd)} />
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ConceptPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [concept, setConcept] = useState<(ConceptKnowledgeUnit & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Facet checklist state
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [hasFacets, setHasFacets] = useState(false);
  const [selectedMechanics, setSelectedMechanics] = useState<Record<number, boolean>>({});
  const [includeAiQuestion, setIncludeAiQuestion] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    Promise.all([
      apiFetch(`/api/concepts/${id}`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      apiFetch(`/api/user-concepts`).then(r => r.json()),
      apiFetch(`/api/user-concepts/${id}/facets`).then(r => r.json()),
    ])
      .then(([conceptData, userConcepts, facets]) => {
        setConcept(conceptData as ConceptKnowledgeUnit & { id: string });
        const enrolled = Array.isArray(userConcepts) && userConcepts.some((uc: any) => uc.conceptId === id);
        setIsEnrolled(enrolled);
        setHasFacets(Array.isArray(facets) && facets.length > 0);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [id]);

  const toggleMechanic = (index: number) => {
    setSelectedMechanics(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const handleStartLearning = async () => {
    const indices = Object.entries(selectedMechanics)
      .filter(([, checked]) => checked)
      .map(([i]) => Number(i));

    if (indices.length === 0 && !includeAiQuestion) {
      setSubmitError("Select at least one item.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await apiFetch(`/api/user-concepts/${id}/facets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mechanicIndices: indices, includeAiQuestion }),
      });
      if (!res.ok) throw new Error("Failed to create learning items");
      window.dispatchEvent(new Event("refreshStats"));
      router.push("/review");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "An unknown error occurred.");
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="container mx-auto max-w-3xl px-6 py-12">
        <p className="text-shodo-ink/50 animate-pulse">Loading concept…</p>
      </main>
    );
  }

  if (error || !concept) {
    return (
      <main className="container mx-auto max-w-3xl px-6 py-12">
        <p className="text-shodo-accent">{error ?? "Concept not found."}</p>
      </main>
    );
  }

  const { data } = concept;
  const showChecklist = isEnrolled && !hasFacets;

  return (
    <main className="container mx-auto max-w-3xl px-6 py-12 space-y-14">

      {/* Header */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-shodo-accent mb-2">
          Grammar Concept
        </p>
        <h1 className="text-4xl font-bold text-shodo-ink mb-1">{data.title}</h1>
        {data.reading && (
          <p className="text-lg text-shodo-ink/50 mb-5">{data.reading}</p>
        )}
        <p className="text-base text-shodo-ink/70 leading-relaxed">{data.overview}</p>
      </section>

      {/* Mechanics */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-shodo-ink/40 mb-5">
          Rules of Use
        </h2>
        <div className="space-y-4">
          {data.mechanics.map((m, i) => (
            <div key={i} className="border border-shodo-ink/10 rounded-xl p-5 space-y-4">
              <div className="flex items-start gap-4">
                <span className="text-xs font-bold text-shodo-accent mt-0.5 shrink-0 w-5 text-right">
                  {i + 1}
                </span>
                <div className="space-y-3 flex-1">
                  <p className="font-semibold text-shodo-ink">{m.goalTitle}</p>
                  <p className="text-sm text-shodo-ink/50 italic">{m.englishIntent}</p>
                  <code className="block bg-shodo-ink/5 text-shodo-ink/80 font-mono text-sm rounded-lg px-4 py-2">
                    {m.rule}
                  </code>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-wider text-shodo-ink/30">Simple</p>
                      <p className="text-base text-shodo-ink">{highlightClause(m.simpleExample.japanese, m.simpleExample.highlight)}</p>
                      <p className="text-xs text-shodo-ink/50">{m.simpleExample.english}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-wider text-shodo-ink/30">Natural</p>
                      <p className="text-base text-shodo-ink">{highlightClause(m.naturalExample.japanese, m.naturalExample.highlight)}</p>
                      <p className="text-xs text-shodo-ink/50">{m.naturalExample.english}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Examples */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-shodo-ink/40 mb-5">
          Examples
        </h2>
        <div className="space-y-4">
          {data.examples.map((ex, i) => (
            <div key={i} className="border border-shodo-ink/10 rounded-xl px-6 py-5 space-y-2">
              <p className="text-2xl text-shodo-ink leading-snug">
                {furiganaHighlight(ex.japanese, ex.targetGrammar)}
              </p>
              <p className="text-sm text-shodo-ink/65 border-t border-shodo-ink/8 pt-2 mt-2">{ex.english}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Choose What to Learn */}
      {showChecklist && (
        <section className="border border-shodo-ink/10 rounded-xl p-6 space-y-6">
          <h2 className="text-base font-semibold text-shodo-ink">Choose What to Learn</h2>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-shodo-ink/40">
              Sentence Structure
            </h3>
            {data.mechanics.map((m, i) => (
              <label
                key={i}
                className="flex items-start gap-3 p-4 border border-shodo-ink/10 rounded-lg hover:bg-shodo-ink/[0.02] cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-shodo-ink/30 text-shodo-accent focus:ring-shodo-accent/50"
                  checked={!!selectedMechanics[i]}
                  onChange={() => toggleMechanic(i)}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-shodo-ink">{m.goalTitle}</p>
                  <p className="text-sm text-shodo-ink/50 mt-0.5">{m.naturalExample.japanese}</p>
                </div>
              </label>
            ))}
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-shodo-ink/40">
              General Usage Patterns
            </h3>
            <label className="flex items-start gap-3 p-4 border border-shodo-ink/10 rounded-lg hover:bg-shodo-ink/[0.02] cursor-pointer transition-colors">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-shodo-ink/30 text-shodo-accent focus:ring-shodo-accent/50"
                checked={includeAiQuestion}
                onChange={() => setIncludeAiQuestion(prev => !prev)}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-shodo-ink">General usage patterns</p>
                <p className="text-sm text-shodo-ink/50 mt-0.5">Practice applying this concept through varied usage questions</p>
              </div>
            </label>
          </div>

          {submitError && <p className="text-sm text-shodo-accent">{submitError}</p>}

          <button
            onClick={handleStartLearning}
            disabled={isSubmitting}
            className={`w-full py-2.5 rounded-lg text-sm font-medium text-white transition-colors ${
              isSubmitting ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {isSubmitting ? "Saving…" : "Start Learning Selected Items"}
          </button>
        </section>
      )}

    </main>
  );
}
