"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { apiFetch } from "@/lib/api-client";
import AudioFirstSwitch from "@/components/admin/AudioFirstSwitch";
import { KnowledgeUnit } from "@/types";
import {
  QueueItem,
  LoadedItem,
  slideCount,
  renderSlide,
  fetchLessonWithRetry,
  useLessonAudio,
  TYPE_COLORS,
} from "@/components/learn/LessonSlides";

const SUPPORTED_TYPES = new Set(["Vocab", "Kanji", "Grammar"]);

// `from` comes from a URL query param, so it's fully attacker-controlled — a crafted
// link (?from=https://evil.com or ?from=javascript:...) must not be usable as a
// navigation target. Only allow same-origin relative paths: single leading "/", and
// reject "//" or "/\" (both get browser-normalized to a protocol-relative external URL).
function isSafeRelativePath(path: string | null): path is string {
  if (!path) return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//") || path.startsWith("/\\")) return false;
  return true;
}

export default function PreviewLessonPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const params = useParams();
  const searchParams = useSearchParams();
  const kuId = params?.id as string;
  const rawFrom = searchParams.get("from");
  const backHref = isSafeRelativePath(rawFrom) ? rawFrom : `/admin/knowledge-units/${kuId}/edit`;

  const [ku, setKu] = useState<KnowledgeUnit | null>(null);
  const [loaded, setLoaded] = useState<LoadedItem | null>(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [relabelling, setRelabelling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { audioRef, playAudio } = useLessonAudio();

  const load = useCallback(async () => {
    if (!kuId) return;
    setStatus("loading");
    setErrorMsg(null);
    try {
      const kuRes = await apiFetch(`/api/knowledge-units/${kuId}/global`);
      if (!kuRes.ok) throw new Error("Knowledge unit not found");
      const kuData: KnowledgeUnit = await kuRes.json();
      setKu(kuData);

      if (!SUPPORTED_TYPES.has(kuData.type)) {
        setStatus("ready");
        setLoaded(null);
        return;
      }

      const item: QueueItem = { kuId, content: kuData.content, type: kuData.type };
      const lesson = await fetchLessonWithRetry(item);
      setLoaded({ item, lesson });
      setSlideIdx(0);
      setStatus("ready");
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to load preview");
      setStatus("error");
    }
  }, [kuId]);

  useEffect(() => {
    if (!isAdmin) return;
    load();
  }, [isAdmin, load]);

  const handleRelabel = async () => {
    setRelabelling(true);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/lessons/${kuId}/relabel-usages`, { method: "POST" });
      if (!res.ok) throw new Error(`Relabel failed (${res.status})`);
      const { usages, saved } = (await res.json()) as { usages: (string | null)[]; saved: boolean };
      setNotice(
        saved
          ? `Relabelled: ${[...new Set(usages.filter(Boolean))].join(" · ")}`
          : "Usages unchanged: building failed or was rejected, the lesson has no examples, or its examples changed meanwhile (see backend log).",
      );
      await load();
    } catch (e) {
      setNotice((e as Error).message || "Relabel failed");
    } finally {
      setRelabelling(false);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await apiFetch(`/api/lessons/regenerate/${kuId}`, { method: "POST" });
      if (!res.ok) throw new Error("Regenerate failed");
      await load();
    } catch (e: any) {
      setErrorMsg(e.message || "Regenerate failed");
    } finally {
      setRegenerating(false);
    }
  };

  if (authLoading) return null;

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center">
        <h1 className="text-xl font-bold text-shodo-ink mb-2">Not authorized</h1>
        <p className="text-shodo-ink-light">This preview is admin-only.</p>
      </div>
    );
  }

  const header = ku && (
    <div className="flex items-center justify-between mb-8">
      <div>
        {/* Intentionally a hard navigation, not router.push/<Link>: the destination page
            (the KU list) reads a ?openEdit= param on mount to reopen the correct modal, and
            Next's client-side router cache can restore a previously-visited page's component
            instance without re-running that mount effect, silently reopening the wrong (or no)
            modal. A full reload guarantees a fresh mount. backHref is validated above — never
            pass an unvalidated `from` value here. */}
        <button
          onClick={() => { window.location.href = backHref; }}
          className="text-sm text-shodo-ink-light hover:text-shodo-indigo transition-colors"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-shodo-ink font-sans mt-1">
          Preview — {ku.content}
        </h1>
        <p className="text-xs text-shodo-ink-light font-mono">{ku.type} · {kuId}</p>
        {notice && <p className="text-xs text-shodo-persimmon mt-1">{notice}</p>}
        {ku.type === "Vocab" && <div className="mt-1"><AudioFirstSwitch kuId={kuId} /></div>}
      </div>
      <div className="flex gap-2">
      {ku.type === "Vocab" && (
        <button
          type="button"
          onClick={handleRelabel}
          disabled={relabelling || regenerating}
          title="Re-run usage labelling on this lesson's examples"
          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
            relabelling
              ? "border-shodo-ink/10 text-shodo-ink-light/50 cursor-not-allowed"
              : "border-shodo-ink/20 text-shodo-ink hover:bg-shodo-paper-dark"
          }`}
        >
          {relabelling ? "Relabelling…" : "Relabel usages"}
        </button>
      )}
      <button
        onClick={handleRegenerate}
        disabled={regenerating}
        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
          regenerating
            ? "border-shodo-ink/10 text-shodo-ink-light/50 cursor-not-allowed"
            : "border-shodo-ink/20 text-shodo-ink hover:bg-shodo-paper-dark"
        }`}
      >
        {regenerating ? "Regenerating…" : "Regenerate"}
      </button>
      </div>
    </div>
  );

  if (status === "loading") {
    return (
      <main className="container mx-auto max-w-2xl p-8">
        {header}
        <p className="text-shodo-ink-light">Loading…</p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="container mx-auto max-w-2xl p-8">
        {header}
        <div className="bg-red-100 border border-red-300 text-red-800 px-4 py-3 rounded text-sm">
          {errorMsg}
        </div>
      </main>
    );
  }

  if (ku && !SUPPORTED_TYPES.has(ku.type)) {
    return (
      <main className="container mx-auto max-w-2xl p-8">
        {header}
        <p className="text-shodo-ink-light">
          Preview isn&apos;t available for {ku.type} knowledge units — the learning-card
          slideshow only supports Vocab, Kanji, and Grammar.
        </p>
      </main>
    );
  }

  if (!loaded) {
    return (
      <main className="container mx-auto max-w-2xl p-8">
        {header}
        <p className="text-shodo-ink-light">No lesson available to preview.</p>
      </main>
    );
  }

  const slides = slideCount(loaded);
  const isFirstSlide = slideIdx === 0;
  const isLastSlide = slideIdx >= slides - 1;
  const typeColor = TYPE_COLORS[loaded.item.type] ?? "var(--shodo-ink-light)";

  return (
    <main className="container mx-auto max-w-2xl p-8">
      <audio ref={audioRef} />
      {header}

      <div className="flex justify-end -mt-4 mb-4">
        <span className="text-xs text-shodo-ink-faint">
          Slide {slideIdx + 1} of {slides}
        </span>
      </div>

      <div
        key={slideIdx}
        className="min-h-[400px] rounded-xl border p-8 animate-in fade-in duration-300"
        style={{
          backgroundColor: `color-mix(in srgb, ${typeColor} 5%, transparent)`,
          borderColor: `color-mix(in srgb, ${typeColor} 20%, transparent)`,
        }}
      >
        {renderSlide(loaded, slideIdx, playAudio)}
      </div>

      <div className="flex items-center gap-4 mt-8 pt-6 border-t border-shodo-ink/10">
        <button
          onClick={() => setSlideIdx(s => Math.max(0, s - 1))}
          disabled={isFirstSlide}
          className="px-5 py-2.5 rounded-lg border border-shodo-ink/20 text-shodo-ink-light font-medium hover:bg-shodo-paper-dark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← Back
        </button>

        <div className="flex-1 flex justify-center gap-1.5">
          {Array.from({ length: slides }).map((_, i) => (
            <div
              key={i}
              className="h-1.5 w-1.5 rounded-full transition-colors"
              style={{ backgroundColor: i === slideIdx ? typeColor : "color-mix(in srgb, var(--shodo-ink) 20%, transparent)" }}
            />
          ))}
        </div>

        <button
          onClick={() => setSlideIdx(s => Math.min(slides - 1, s + 1))}
          disabled={isLastSlide}
          className="px-6 py-2.5 rounded-lg text-shodo-paper font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ backgroundColor: typeColor }}
        >
          Next →
        </button>
      </div>
    </main>
  );
}
