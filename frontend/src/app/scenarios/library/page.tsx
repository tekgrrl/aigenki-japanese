"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Scenario, ScenarioDifficulty } from "@/types/scenario";
import { apiFetch } from "@/lib/api-client";

// TODO: Align with dashboard config
const API_BASE_URL = "http://localhost:3000/api";

const JLPT_LEVELS: { value: ScenarioDifficulty; label: string }[] = [
  { value: "N5", label: "N5 — Beginner" },
  { value: "N4", label: "N4 — Basic" },
  { value: "N3", label: "N3 — Intermediate" },
  { value: "N2", label: "N2 — Business" },
  { value: "N1", label: "N1 — Advanced" },
];

const LEVEL_RANK: Record<string, number> = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 };

interface ScenarioTemplate {
  id: string;
  title: string;
  description: string;
  baseTheme: string;
  defaultLevel: string;
  tags: string[];
}

function ScenarioLibraryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize tab from URL or default to 'core'
  const initialTab =
    searchParams.get("tab") === "scenarios" ? "scenarios" : "core";
  const [activeTab, setActiveTab] = useState<"core" | "scenarios">(initialTab);

  // Sync state if URL changes (e.g. back button)
  useEffect(() => {
    const tab = searchParams.get("tab") === "scenarios" ? "scenarios" : "core";
    setActiveTab(tab);
  }, [searchParams]);

  const handleTabChange = (tab: "core" | "scenarios") => {
    setActiveTab(tab);
    // Update URL without full reload
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "scenarios") {
      params.set("tab", "scenarios");
    } else {
      params.delete("tab");
    }
    router.replace(`/scenarios/library?${params.toString()}`);
  };

  // Data State
  const [templates, setTemplates] = useState<ScenarioTemplate[]>([]);
  const [archives, setArchives] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [userJlptLevel, setUserJlptLevel] = useState<ScenarioDifficulty | null>(null);

  // Modal State
  const [selectedTemplate, setSelectedTemplate] =
    useState<ScenarioTemplate | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] =
    useState<ScenarioDifficulty>("N5");
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [tplRes, archRes, userRes] = await Promise.all([
          apiFetch(`${API_BASE_URL}/scenarios/templates`),
          apiFetch(`${API_BASE_URL}/scenarios`),
          apiFetch(`${API_BASE_URL}/users/me`),
        ]);
        if (tplRes.ok) setTemplates(await tplRes.json());
        if (archRes.ok) setArchives(await archRes.json());
        if (userRes.ok) {
          const userData = await userRes.json();
          if (userData.preferences?.jlptLevel) {
            setUserJlptLevel(userData.preferences.jlptLevel as ScenarioDifficulty);
          }
        }
      } catch (error) {
        console.error("Failed to load library data", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleRunTemplate = async () => {
    if (!selectedTemplate) return;
    setIsGenerating(true);

    try {
      const res = await apiFetch("/api/tutor/generate-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          difficulty: selectedDifficulty,
          theme: selectedTemplate.baseTheme,
        }),
      });

      if (!res.ok) throw new Error("Generation failed");

      const data = await res.json();
      router.push(`/scenarios/${data.id}`);
    } catch (error) {
      console.error(error);
      alert("Failed to start scenario");
      setIsGenerating(false);
    }
  };

  const handleRunAgain = async (scenario: Scenario) => {
    // "Run Again as New" - uses the same settings but creates a fresh scenario
    setIsGenerating(true);
    try {
      const res = await apiFetch("/api/tutor/generate-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          difficulty: scenario.difficultyLevel,
          theme: scenario.setting.goal || scenario.title,
        }),
      });

      if (!res.ok) throw new Error("regeneration failed");
      const data = await res.json();
      router.push(`/scenarios/${data.id}`);
    } catch (e) {
      console.error(e);
      setIsGenerating(false);
    }
  };

  const handleReplay = async (id: string) => {
    if (
      !confirm(
        "This will reset the current session. Previous history will be archived. Continue?",
      )
    )
      return;

    try {
      await apiFetch(`${API_BASE_URL}/scenarios/${id}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive: true }),
      });
      router.push(`/scenarios/${id}`);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <header className="flex items-center gap-4">
        <Link
          href="/scenarios"
          className="text-slate-400 hover:text-slate-600 transition-colors"
        >
          ← Back to Dashboard
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-slate-800">
            Scenario Library
          </h1>
          <p className="text-slate-500">
            Explore core scenarios or revisit your past journeys.
          </p>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex gap-8">
          <button
            onClick={() => handleTabChange("core")}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === "core"
                ? "border-indigo-500 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
            }`}
          >
            Core Library
          </button>
          <button
            onClick={() => handleTabChange("scenarios")}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === "scenarios"
                ? "border-indigo-500 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
            }`}
          >
            My Scenarios ({archives.length})
          </button>
        </nav>
      </div>

      {loading ? (
        <div className="text-center py-20 text-slate-400">
          Loading library...
        </div>
      ) : (
        <main>
          {activeTab === "core" && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow p-6 flex flex-col h-full"
                >
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-2">
                      <span className="bg-indigo-50 text-indigo-700 text-xs px-2 py-1 rounded-md font-medium uppercase tracking-wide">
                        {tpl.defaultLevel}
                      </span>
                      <div className="flex gap-1">
                        {tpl.tags.map((tag) => (
                          <span key={tag} className="text-xs text-slate-400">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 mb-2">
                      {tpl.title}
                    </h3>
                    <p className="text-slate-600 text-sm">{tpl.description}</p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedTemplate(tpl);
                      setSelectedDifficulty(tpl.defaultLevel as ScenarioDifficulty);
                    }}
                    className="mt-6 w-full py-2 bg-indigo-50 text-indigo-600 font-medium rounded-lg hover:bg-indigo-100 transition-colors"
                  >
                    Run Scenario
                  </button>
                </div>
              ))}
            </div>
          )}

          {activeTab === "scenarios" && (
            <div className="space-y-4">
              {archives.length === 0 && (
                <p className="text-slate-500 text-center py-10">
                  No past scenarios found.
                </p>
              )}
              {archives.map((scenario) => (
                <div
                  key={scenario.id}
                  className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col md:flex-row gap-6 items-start md:items-center justify-between"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold text-slate-800">
                        {scenario.title}
                      </h3>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          scenario.state === "completed"
                            ? "bg-green-100 text-green-800"
                            : "bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        {scenario.state.toUpperCase()}
                      </span>
                      <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-xs font-medium">
                        {scenario.difficultyLevel}
                      </span>
                    </div>
                    <p className="text-slate-500 text-sm mb-3">
                      {scenario.description}
                    </p>

                    {/* Vocab Chips */}
                    {scenario.extractedKUs &&
                      scenario.extractedKUs.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {scenario.extractedKUs.slice(0, 5).map((ku, i) => (
                            <span
                              key={i}
                              className="text-xs border border-slate-200 px-2 py-1 rounded bg-slate-50 text-slate-600"
                            >
                              {ku.content}
                            </span>
                          ))}
                          {scenario.extractedKUs.length > 5 && (
                            <span className="text-xs text-slate-400 px-1 py-1">
                              +{scenario.extractedKUs.length - 5} more
                            </span>
                          )}
                        </div>
                      )}
                  </div>

                  <div className="flex gap-3 w-full md:w-auto">
                    <Link
                      href={`/scenarios/${scenario.id}?from=library`}
                      className="flex-1 md:flex-none"
                    >
                      <button className="w-full px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors">
                        View
                      </button>
                    </Link>
                    {scenario.state === "completed" && (
                      <button
                        onClick={() => handleReplay(scenario.id)}
                        className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg font-medium hover:bg-indigo-100 transition-colors"
                      >
                        Replay
                      </button>
                    )}
                    {/* <button
                                            onClick={() => handleRunAgain(scenario)}
                                            className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg font-medium hover:bg-indigo-100 transition-colors"
                                        >
                                            Run as New
                                        </button> */}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {/* Run Template Modal */}
      {selectedTemplate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <h3 className="text-xl font-bold text-slate-800">Start Scenario</h3>
            <div className="space-y-4">
              <p className="text-slate-600">
                <strong>Template:</strong> {selectedTemplate.title}
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Select Difficulty
                </label>
                <select
                  value={selectedDifficulty}
                  onChange={(e) =>
                    setSelectedDifficulty(e.target.value as ScenarioDifficulty)
                  }
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                >
                  {JLPT_LEVELS.map(({ value, label }) => {
                    const isUserLevel = value === userJlptLevel;
                    const isRecommended = value === selectedTemplate?.defaultLevel;
                    if (isUserLevel && isRecommended) {
                      return <option key={value} value={value}>{value} — Your Current Level</option>;
                    }
                    const tag = isUserLevel ? "Your Level" : isRecommended ? "Recommended" : null;
                    return (
                      <option key={value} value={value}>
                        {label}{tag ? ` — ${tag}` : ""}
                      </option>
                    );
                  })}
                </select>
                {(() => {
                  if (!userJlptLevel || selectedDifficulty === userJlptLevel) return null;
                  const selectedRank = LEVEL_RANK[selectedDifficulty] ?? 0;
                  const userRank = LEVEL_RANK[userJlptLevel] ?? 0;
                  const msg = selectedRank > userRank
                    ? "The generated scenario may be too hard at your current level."
                    : "The generated scenario may be too easy for your current level.";
                  return (
                    <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      {msg}
                    </p>
                  );
                })()}
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setSelectedTemplate(null)}
                className="flex-1 py-2 text-slate-600 font-medium hover:bg-slate-50 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleRunTemplate}
                disabled={isGenerating}
                className="flex-1 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {isGenerating ? "Building..." : "Start"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScenarioLibrary() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-slate-400">Loading library...</div>}>
      <ScenarioLibraryContent />
    </Suspense>
  );
}
