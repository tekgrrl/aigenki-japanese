"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { ConceptKnowledgeUnit } from "@/types";

interface UserConceptEntry {
  id: string;
  conceptId: string;
  startedAt: { _seconds: number };
  lastSeenAt?: { _seconds: number };
  concept: ConceptKnowledgeUnit & { id: string };
}

function ConceptLibraryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialTab = searchParams.get("tab") === "mine" ? "mine" : "core";
  const [activeTab, setActiveTab] = useState<"core" | "mine">(initialTab);

  useEffect(() => {
    const tab = searchParams.get("tab") === "mine" ? "mine" : "core";
    setActiveTab(tab);
  }, [searchParams]);

  const handleTabChange = (tab: "core" | "mine") => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "mine") {
      params.set("tab", "mine");
    } else {
      params.delete("tab");
    }
    router.replace(`/concepts/library?${params.toString()}`);
  };

  const [allConcepts, setAllConcepts] = useState<(ConceptKnowledgeUnit & { id: string })[]>([]);
  const [allLoading, setAllLoading] = useState(true);
  const [myConcepts, setMyConcepts] = useState<UserConceptEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);

  // Core Library: every concept in the shared collection, newest first.
  useEffect(() => {
    apiFetch("/api/concepts")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: (ConceptKnowledgeUnit & { id: string })[]) => setAllConcepts(data))
      .catch((err) => console.error("[ConceptLibrary] Failed to fetch concepts:", err))
      .finally(() => setAllLoading(false));
  }, []);

  useEffect(() => {
    apiFetch("/api/user-concepts")
      .then((res) => res.json())
      .then((data: UserConceptEntry[]) => setMyConcepts(data))
      .catch((err) => console.error("[ConceptLibrary] Failed to fetch:", err))
      .finally(() => setLoading(false));
  }, []);

  const handleLearn = async (conceptId: string) => {
    setEnrollingId(conceptId);
    try {
      const res = await apiFetch("/api/user-concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptId }),
      });
      if (!res.ok) throw new Error("Enrollment failed");
      router.push(`/concepts/${conceptId}`);
    } catch (err) {
      console.error("[ConceptLibrary] Enroll error:", err);
      setEnrollingId(null);
    }
  };

  return (
    <div className="container mx-auto max-w-5xl px-6 py-12 space-y-8">
      <header className="flex items-center gap-4">
        <Link
          href="/concepts"
          className="text-shodo-ink/30 hover:text-shodo-ink/60 transition-colors text-sm"
        >
          ← Back
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-shodo-ink">Concept Library</h1>
          <p className="text-shodo-ink/50 mt-0.5">Browse grammar concepts and your saved entries.</p>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-shodo-ink/10">
        <nav className="-mb-px flex gap-8">
          <button
            onClick={() => handleTabChange("core")}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === "core"
                ? "border-shodo-accent text-shodo-accent"
                : "border-transparent text-shodo-ink/40 hover:text-shodo-ink/70 hover:border-shodo-ink/20"
            }`}
          >
            Core Library
          </button>
          <button
            onClick={() => handleTabChange("mine")}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === "mine"
                ? "border-shodo-accent text-shodo-accent"
                : "border-transparent text-shodo-ink/40 hover:text-shodo-ink/70 hover:border-shodo-ink/20"
            }`}
          >
            My Concepts {!loading && `(${myConcepts.length})`}
          </button>
        </nav>
      </div>

      {(loading && activeTab === "mine") || (allLoading && activeTab === "core") ? (
        <p className="text-center py-20 text-shodo-ink/30 animate-pulse">Loading…</p>
      ) : (
        <main>
          {activeTab === "core" && (
            <div className="space-y-3">
              {allConcepts.length === 0 && (
                <p className="text-center py-10 text-shodo-ink/40">No concepts in the library yet.</p>
              )}
              {allConcepts.map((concept) => (
                <div
                  key={concept.id}
                  className="border border-shodo-ink/10 rounded-xl px-6 py-5 flex flex-col md:flex-row gap-4 md:items-center justify-between hover:border-shodo-ink/20 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-shodo-ink">{concept.data.title}</h3>
                    <p className="text-sm text-shodo-ink/50 mt-0.5 line-clamp-2">{concept.data.overview}</p>
                  </div>
                  <button
                    onClick={() => handleLearn(concept.id)}
                    disabled={enrollingId === concept.id}
                    className="shrink-0 px-4 py-2 bg-shodo-ink text-shodo-paper rounded-lg text-sm font-medium hover:bg-shodo-ink/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {enrollingId === concept.id ? "Starting…" : "Learn"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {activeTab === "mine" && (
            <div className="space-y-3">
              {myConcepts.length === 0 && (
                <p className="text-center py-10 text-shodo-ink/40">
                  No concepts yet. Generate one from the{" "}
                  <Link href="/concepts" className="text-shodo-accent hover:underline">
                    dashboard
                  </Link>{" "}
                  or start a Core concept above.
                </p>
              )}
              {myConcepts.map((entry) => (
                <div
                  key={entry.id}
                  className="border border-shodo-ink/10 rounded-xl px-6 py-5 flex flex-col md:flex-row gap-4 md:items-center justify-between hover:border-shodo-ink/20 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-shodo-ink truncate">{entry.concept.data.title}</h3>
                    <p className="text-sm text-shodo-ink/50 mt-0.5 line-clamp-2">
                      {entry.concept.data.overview}
                    </p>
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <span className="text-xs border border-shodo-ink/10 text-shodo-ink/40 px-2 py-0.5 rounded-full">
                        {entry.concept.data.mechanics.length} mechanics
                      </span>
                      <span className="text-xs border border-shodo-ink/10 text-shodo-ink/40 px-2 py-0.5 rounded-full">
                        {entry.concept.data.examples.length} examples
                      </span>
                    </div>
                  </div>
                  <Link href={`/concepts/${entry.conceptId}`} className="shrink-0">
                    <button className="px-4 py-2 border border-shodo-ink/15 text-shodo-ink/60 rounded-lg text-sm font-medium hover:bg-shodo-ink/5 transition-colors">
                      View
                    </button>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </main>
      )}
    </div>
  );
}

export default function ConceptLibrary() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-shodo-ink/30">Loading library…</div>}>
      <ConceptLibraryContent />
    </Suspense>
  );
}
