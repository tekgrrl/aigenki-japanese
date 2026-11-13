"use client";

import { useState, useEffect, use, useRef, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Scenario, ChatMessage, ScenarioAttempt } from "@/types/scenario";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { Volume2, Mic, MicOff } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/providers/AuthProvider";
import ScenePicture from "@/components/scenarios/ScenePicture";
import GrammarPatternDisplay from "@/components/lessons/GrammarPatternDisplay";
import ScenePlayer from "@/components/scenarios/ScenePlayer";

const API_BASE_URL = "/api";

const ROLEPLAY_MIN_SRS_STAGE = 3; // default until ku-status answers: every item at Familiar (stage 3) before role-playing

function kuSrsBadge(srsStage: number | null | undefined): { text: string; className: string } | null {
  if (srsStage === undefined) return null; // no kuId, no badge
  if (srsStage === null) return { text: 'Enrolled', className: 'bg-slate-100 text-slate-500' };
  if (srsStage === 0) return { text: 'New', className: 'bg-slate-100 text-slate-500' };
  if (srsStage <= 2) return { text: `Apprentice · ${srsStage}`, className: 'bg-blue-100 text-blue-700' };
  if (srsStage <= 4) return { text: `Familiar · ${srsStage}`, className: 'bg-amber-100 text-amber-700' };
  if (srsStage <= 6) return { text: `Proficient · ${srsStage}`, className: 'bg-green-100 text-green-700' };
  return { text: 'Mastered', className: 'bg-purple-100 text-purple-700' };
}

export default function ScenarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Unwrap params using React.use() - Next.js 15+ pattern
  const { id } = use(params);

  const [scenario, setScenario] = useState<Scenario | null>(null);
  const { isAdmin } = useAuth();
  const [publishStatus, setPublishStatus] = useState<string | null>(null);
  const [includeScriptWords, setIncludeScriptWords] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Chat State - initialize from scenario if available
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [userMessage, setUserMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  // UI State
  const [kuStatus, setKuStatus] = useState<Record<string, { maxSrsStage: number | null; minSrsStage: number | null }>>({});
  /** The backend's Role Play gate (Key Vocabulary and Key Grammar), and the stage it requires. */
  const [roleplayReady, setRoleplayReady] = useState(false);
  const [readyMinStage, setReadyMinStage] = useState(ROLEPLAY_MIN_SRS_STAGE);
  const [keyGrammar, setKeyGrammar] = useState<{ kuId: string; content: string; title: string }[]>([]);
  const [kuStatusLoading, setKuStatusLoading] = useState(false);

  // Hint state
  const [hintUnlocked, setHintUnlocked] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const lastInteractionAtRef = useRef<number>(Date.now());

  // Audio Hooks
  const { playBlob, isPlaying: isAudioPlaying } = useAudioPlayer();
  const {
    isListening,
    transcript,
    start: startListening,
    stop: stopListening,
    supported: isSpeechSupported,
  } = useSpeechRecognition();
  const historyLengthRef = useRef(0);

  // Helper to play TTS
  const playTts = async (text: string) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/audio/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("TTS fetch failed");
      const blob = await res.blob();
      playBlob(blob);
    } catch (e) {
      console.error("TTS error", e);
    }
  };

  // Effect: Auto-play new AI messages
  useEffect(() => {
    if (chatHistory.length > historyLengthRef.current) {
      const lastMsg = chatHistory[chatHistory.length - 1];
      // Only play if it's AI (or not user/system) and we are in simulation
      // adjusting condition to be safe: speaker !== 'user'
      if (lastMsg.speaker !== "user" && scenario?.state === "simulate") {
        playTts(lastMsg.text);
      }
      historyLengthRef.current = chatHistory.length;
    }
  }, [chatHistory, scenario?.state]);

  // Effect: Update input with speech transcript
  useEffect(() => {
    if (isListening) {
      setUserMessage(transcript);
    }
  }, [transcript, isListening]);

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  useEffect(() => {
    fetchScenario();
  }, [id]);

  // After a scene is drawn, pick up just the new picture (a full refetch would also reset chat state).
  const refreshScenePicture = useCallback(async () => {
    const res = await apiFetch(`${API_BASE_URL}/scenarios/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as Scenario;
    setScenario((prev) => (prev ? { ...prev, setting: { ...prev.setting, picture: data.setting.picture } } : prev));
  }, [id]);

  const fetchScenario = async () => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/scenarios/${id}`);
      if (!res.ok) throw new Error("Failed to load scenario");
      const data = await res.json();
      setScenario(data);

      // Sync chat history from backend if available
      if (data.chatHistory) {
        setChatHistory(data.chatHistory);
      } else {
        setChatHistory([]);
      }
      return data;
    } catch (err) {
      setError("Could not load scenario");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Update ref after initial load so we don't auto-play history
  useEffect(() => {
    if (scenario && scenario.chatHistory) {
      historyLengthRef.current = scenario.chatHistory.length;
    }
  }, [scenario]);

  // Fetch live KU status for the drill vocab grid
  useEffect(() => {
    if (scenario?.state !== 'drill' && scenario?.state !== 'simulate') return;
    setKuStatusLoading(true);
    apiFetch(`${API_BASE_URL}/scenarios/${id}/ku-status`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.items) {
          setKuStatus(data.items);
          setRoleplayReady(data.ready === true);
          if (typeof data.minStage === "number") setReadyMinStage(data.minStage);
          if (Array.isArray(data.grammar)) setKeyGrammar(data.grammar);
        }
        setKuStatusLoading(false);
      })
      .catch(() => setKuStatusLoading(false));
  }, [id, scenario?.state]);

  const [advancing, setAdvancing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Next user line from the script, used as hint text
  const nextHintLine = useMemo(() => {
    if (!scenario || scenario.state !== "simulate") return null;
    const userSpeaker = scenario.roles?.user;
    const userTurnCount = chatHistory.filter((m) => m.speaker === "user").length;
    const userLines = scenario.dialogue.filter((l) => l.speaker === userSpeaker);
    return userLines[userTurnCount] ?? null;
  }, [chatHistory, scenario]);

  // Unlock hint button 30s after last interaction, reset on each send
  useEffect(() => {
    if (scenario?.state !== "simulate") return;
    setHintUnlocked(false);
    const timer = setTimeout(() => setHintUnlocked(true), 30_000);
    return () => clearTimeout(timer);
  }, [chatHistory.length, scenario?.state]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    // Stop listening immediately to avoid picking up TTS
    if (isListening) {
      stopListening();
    }

    if (!userMessage.trim() || isSending) return;

    setHintUnlocked(false);
    setHintVisible(false);
    setIsSending(true);
    const currentMessage = userMessage;
    setUserMessage("");

    // Optimistic UI update
    const optimisticMsg: ChatMessage = {
      speaker: "user",
      text: currentMessage,
      timestamp: Date.now(),
    };
    const newHistory = [...chatHistory, optimisticMsg];
    setChatHistory(newHistory);

    try {
      const res = await apiFetch(`${API_BASE_URL}/scenarios/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userMessage: currentMessage }),
      });

      if (!res.ok) throw new Error("Failed to send message");
      if (!res.ok) throw new Error("Failed to send message");
      const fullHistory = await res.json();

      // Backend returns the full updated history
      setChatHistory(fullHistory);

      // Check if the scene is finished based on the last message
      if (fullHistory.length > 0) {
        const lastMsg = fullHistory[fullHistory.length - 1];
        if (lastMsg.sceneFinished) {
          setScenario((prev) =>
            prev
              ? {
                  ...prev,
                  isObjectiveMet: true,
                  chatHistory: fullHistory, // Ensure history is also synced in scenario object
                }
              : null,
          );
        } else {
          // Also sync history to scenario object to be safe
          setScenario((prev) =>
            prev
              ? {
                  ...prev,
                  chatHistory: fullHistory,
                }
              : null,
          );
        }
      }
    } catch (err) {
      console.error(err);
      // Revert or show error (for now just alert)
      alert("Failed to send message. Please try again.");
    } finally {
      setIsSending(false);
    }
  };

  // History View State
  const [viewingHistory, setViewingHistory] = useState<ScenarioAttempt | null>(
    null,
  );

  const handleAdvance = async () => {
    if (!scenario) return;

    // If already in drill mode, allow advancing to Simulate
    if (scenario.state === "drill") {
      // Proceed to advance to 'simulate'
    } else if (scenario.state === "simulate") {
      // Check if objective met before finishing
      if (!scenario.isObjectiveMet) {
        if (
          !confirm(
            "The scenario goal hasn't been met yet. Ending now might result in a lower score. Continue?",
          )
        ) {
          return;
        }
      }
    } else if (scenario.state === "completed") {
      return;
    }

    setAdvancing(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/scenarios/${id}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeScriptWords: scenario.state === "encounter" && includeScriptWords }),
      });
      if (!res.ok) throw new Error("Failed to advance scenario");

      // Refresh scenario data to reflect new state
      const updated = await fetchScenario();
      if (scenario.state === "encounter") {
        window.dispatchEvent(new CustomEvent("refreshStats"));
        const added = scenario.extractedKUs.length + (includeScriptWords ? scenario.secondaryKUs?.length ?? 0 : 0);
        setToast(`${added} items added to your learning queue`);
        setTimeout(() => setToast(null), 4000);
      } else if (scenario.state === "drill") {
        // Moved to simulate
      } else if (scenario.state === "simulate" && updated) {
        const liveCount = (updated.liveExtractedKUs?.length ?? 0) + (updated.liveGrammarMatches?.length ?? 0);
        if (liveCount > 0) {
          window.dispatchEvent(new CustomEvent("refreshStats"));
          setToast(`${liveCount} new item${liveCount === 1 ? '' : 's'} added from your conversation`);
          setTimeout(() => setToast(null), 4000);
        }
      }
    } catch (err) {
      console.error(err);
      alert("Failed to start drilling. Please try again.");
    } finally {
      setAdvancing(false);
    }
  };

  /** Admin: copy this scenario's content into the shared pool learners choose from. */
  const handlePublish = async () => {
    setPublishStatus("Publishing…");
    try {
      const res = await apiFetch(`/api/scenarios/${id}/publish`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setPublishStatus(res.ok ? `Published to the pool (${body.poolId})` : `Publish failed: ${body.message ?? res.status}`);
    } catch (e) {
      setPublishStatus(`Publish failed: ${(e as Error).message}`);
    }
  };

  const handleReset = async (archive: boolean) => {
    if (
      !confirm(
        archive
          ? "Replay this scenario? Use this to try a different approach."
          : "Restart session? This will clear your chat history.",
      )
    )
      return;
    try {
      await apiFetch(`${API_BASE_URL}/scenarios/${id}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive }),
      });
      // Reload page to reset state completely
      window.location.reload();
    } catch (e) {
      console.error(e);
      alert("Failed to reset session.");
    }
  };

  const searchParams = useSearchParams();
  const router = useRouter(); // We need router for back()
  const fromLibrary = searchParams.get("from") === "library";

  const handleBackToLibrary = () => {
    router.back();
  };

  if (loading)
    return (
      <div className="p-10 text-center text-slate-500">Loading Scene...</div>
    );
  if (error || !scenario)
    return <div className="p-10 text-center text-red-500">{error}</div>;

  // Readiness gate for drill → simulate transition
  // Key Vocabulary and Key Grammar both gate the roleplay; the backend decides (ku-status `ready`).
  const linkedKUs = [
    ...scenario.extractedKUs.filter(ku => ku.kuId).map(ku => ({ kuId: ku.kuId! })),
    ...(scenario.grammarMatches ?? []).filter(g => g.kuId).map(g => ({ kuId: g.kuId })),
  ];
  const readyKUs = linkedKUs.filter(ku => (kuStatus[ku.kuId]?.minSrsStage ?? -1) >= readyMinStage);
  const isReadyForRoleplay = !kuStatusLoading && roleplayReady;

  // If viewing history, show a simplified report card for that attempt
  if (viewingHistory) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-8 pb-24">
        <button
          onClick={() => setViewingHistory(null)}
          className="text-slate-500 hover:text-slate-800 mb-4"
        >
          ← Back to Current Session
        </button>

        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="bg-slate-100 p-6 border-b border-slate-200">
            <h2 className="text-xl font-bold text-slate-800">Past Attempt</h2>
            <div className="text-sm text-slate-500">
              {new Date(
                viewingHistory.completedAt.seconds * 1000,
              ).toLocaleDateString()}
            </div>
            <div className="flex gap-1 text-amber-500 mt-2">
              {[...Array(5)].map((_, i) => (
                <span
                  key={i}
                  className={
                    i < viewingHistory.evaluation.rating
                      ? "opacity-100"
                      : "opacity-30"
                  }
                >
                  ★
                </span>
              ))}
            </div>
          </div>
          <div className="p-8 space-y-6">
            <div>
              <h3 className="font-bold text-slate-900 mb-2">Feedback</h3>
              <p className="text-slate-600 bg-slate-50 p-4 rounded-lg">
                {viewingHistory.evaluation.feedback}
              </p>
            </div>
            {/* Chat History for this attempt */}
            <div>
              <h3 className="font-bold text-slate-900 mb-4">Transcript</h3>
              <div className="space-y-4 max-h-96 overflow-y-auto p-4 bg-slate-50 rounded-lg border border-slate-200">
                {viewingHistory.chatHistory.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col ${msg.speaker === "user" ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-3 text-sm ${
                        msg.speaker === "user"
                          ? "bg-indigo-100 text-indigo-900"
                          : "bg-white border border-slate-200 text-slate-800"
                      }`}
                    >
                      <div className="font-bold text-xs opacity-70 mb-1">
                        {msg.speaker === "user" ? (scenario.roles?.user ?? "You") : (msg.roleName ?? (Array.isArray(scenario.roles?.ai) ? scenario.roles.ai[0] : scenario.roles?.ai) ?? "AI")}
                      </div>
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 pb-24">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg font-semibold animate-in fade-in slide-in-from-top-2">
          {toast}
        </div>
      )}

      {fromLibrary && (
        <button
          onClick={handleBackToLibrary}
          className="mb-2 text-sm text-slate-500 hover:text-indigo-600 transition-colors flex items-center gap-1"
        >
          ← Back to Library
        </button>
      )}

      {scenario?.sourceKuId && (
        <a
          href={`/learn/${scenario.sourceKuId}`}
          className="mb-2 text-sm text-slate-500 hover:text-indigo-600 transition-colors flex items-center gap-1"
        >
          ← Back to Lesson
        </a>
      )}

      {/* Header Info */}
      <header className="border-b border-slate-200 pb-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="flex gap-2 mb-2">
              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 text-xs font-bold rounded">
                {scenario.difficultyLevel}
              </span>
              <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-bold rounded uppercase">
                {scenario.state} Phase
              </span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900">
              {scenario.title}
            </h1>
            <p className="text-slate-600 mt-2 text-lg">
              {scenario.description}
            </p>
          </div>
          {isAdmin && !scenario.poolId && (
            <div className="flex flex-col items-end gap-1 shrink-0">
              <button
                onClick={handlePublish}
                disabled={publishStatus === "Publishing…"}
                className="text-sm px-3 py-1.5 rounded bg-shodo-ink text-shodo-paper disabled:opacity-50"
              >
                Publish to pool
              </button>
              {publishStatus && <span className="text-xs text-slate-500">{publishStatus}</span>}
            </div>
          )}
          {/* Session Controls */}
          {scenario.state === "simulate" && (
            <button
              onClick={() => handleReset(false)}
              className="text-sm text-slate-500 hover:text-red-600 underline"
            >
              Restart Session
            </button>
          )}
        </div>

        {/* Setting / Context Box */}
        <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-700 border border-slate-200">
          <p>
            <strong>📍 Location:</strong> {scenario.setting.location}
          </p>
          <p>
            <strong>👥 Goal:</strong> {scenario.setting.goal}
          </p>
          <ScenePicture
            scenarioId={id}
            visualPrompt={scenario.setting.visualPrompt}
            file={scenario.setting.picture?.file}
            onDrawn={refreshScenePicture}
          />
        </div>
      </header>

      {isAdmin && scenario.poolId && (
        <PoolAdminPanel poolId={scenario.poolId} onChanged={fetchScenario} />
      )}

      {/* The learner can always go back to the play-through */}
      {/* (A completed scenario without an evaluation falls through to the script view below.) */}
      {(scenario.state === "simulate" || (scenario.state === "completed" && scenario.evaluation)) && (
        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer font-medium text-slate-700">Watch the scene again</summary>
          <div className="mt-4">
            <ScenePlayer dialogue={scenario.dialogue} userRole={scenario.roles?.user} title="The scene" />
          </div>
        </details>
      )}

      {/* Conditional Render: Report Card */}
      {scenario.state === "completed" && scenario.evaluation ? (
        <section className="space-y-8">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-4">
            {(() => {
              const rating = scenario.evaluation!.rating;
              const headerBg = rating <= 2 ? "bg-red-600" : rating <= 4 ? "bg-amber-500" : "bg-green-600";
              const emoji = rating <= 2 ? "😓" : rating <= 4 ? "👍" : "🎉";
              const title = rating <= 2 ? "Keep Practising" : rating <= 4 ? "Good Effort!" : "Mission Complete!";
              return (
                <div className={`${headerBg} text-white p-6 text-center`}>
                  <div className="text-4xl mb-2">{emoji}</div>
                  <h2 className="text-3xl font-bold mb-2">{title}</h2>
                  <div className="flex justify-center gap-1 text-amber-300 text-2xl">
                    {[...Array(5)].map((_, i) => (
                      <span key={i} className={i < rating ? "opacity-100" : "opacity-30"}>★</span>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="p-8 space-y-8">
              {/* General Feedback */}
              <div>
                <h3 className="font-bold text-slate-900 mb-2">
                  Sensei's Feedback
                </h3>
                <p className="text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-100">
                  {scenario.evaluation.feedback}
                </p>
              </div>

              {/* Corrections */}
              {scenario.evaluation.corrections.length > 0 && (
                <div>
                  <h3 className="font-bold text-slate-900 mb-4">
                    Corrections & Improvements
                  </h3>
                  <div className="space-y-4">
                    {scenario.evaluation.corrections
                      .filter((c) => c.original && c.correction)
                      .map((c, idx) => (
                        <div
                          key={idx}
                          className="border border-slate-200 rounded-lg p-4 bg-slate-50/50"
                        >
                          <div className="flex flex-col md:flex-row gap-4 mb-2">
                            <div className="flex-1">
                              <div className="text-xs text-red-500 font-bold uppercase mb-1">
                                You Said
                              </div>
                              <div
                                className="text-slate-800 line-through decoration-red-300"
                                title={c.original}
                              >
                                {c.original.length > 200
                                  ? c.original.substring(0, 200) + "..."
                                  : c.original}
                              </div>
                            </div>
                            <div className="hidden md:block text-slate-300 text-2xl">
                              →
                            </div>
                            <div className="flex-1">
                              <div className="text-xs text-green-600 font-bold uppercase mb-1">
                                Better
                              </div>
                              <div className="text-green-800 font-medium">
                                {c.correction}
                              </div>
                            </div>
                          </div>
                          <p className="text-sm text-slate-500 border-t border-slate-200 pt-2 mt-2">
                            💡 {c.explanation}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Tiered guidance */}
              {(() => {
                const rating = scenario.evaluation!.rating;
                if (rating <= 2) return (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
                    You're still learning this one. Work through the grammar notes and vocabulary below, then come back and try again when you feel ready.
                  </div>
                );
                if (rating <= 4) return (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                    You did well, but there's room to improve. Study the notes and vocabulary again, then come back aiming for {rating === 3 ? "4 or even 5" : "5"} stars.
                  </div>
                );
                return (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
                    Outstanding! You've fully mastered this scenario. When you're ready, you can try a harder version — look for the option to regenerate at the next JLPT level from the scenarios library.
                  </div>
                );
              })()}

              <div className="pt-6 border-t border-slate-100 flex justify-between items-center">
                {scenario.evaluation.outcome === "failed" ? (
                  <>
                    <button
                      onClick={() => handleReset(true)}
                      className="px-6 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors shadow-sm"
                    >
                      ↺ Retake Lesson
                    </button>
                    <button
                      onClick={() => window.location.reload()} // Just reload to see script again (Read-Only Encounter effectively)
                      className="px-6 py-3 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition-colors"
                    >
                      Review Materials
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleReset(true)}
                      className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
                    >
                      ↺ Practice Roleplay
                    </button>
                    <button
                      onClick={() => (window.location.href = "/scenarios")}
                      className="px-6 py-3 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition-colors"
                    >
                      Return to Dashboard
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Past Attempts Section */}
          {scenario.pastAttempts && scenario.pastAttempts.length > 0 && (
            <div className="mt-8 border-t border-slate-200 pt-8">
              <h3 className="text-xl font-bold text-slate-800 mb-4">History</h3>
              <div className="grid gap-4 md:grid-cols-2">
                {scenario.pastAttempts.map((attempt, i) => (
                  <button
                    key={i}
                    onClick={() => setViewingHistory(attempt)}
                    className="text-left p-4 bg-white border border-slate-200 rounded-lg hover:border-indigo-300 transition-colors group"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-bold text-slate-700">
                        Attempt #{scenario.pastAttempts!.length - i}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(
                          attempt.completedAt.seconds * 1000,
                        ).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex gap-1 text-amber-400 text-sm">
                      {[...Array(5)].map((_, starI) => (
                        <span
                          key={starI}
                          className={
                            starI < attempt.evaluation.rating
                              ? "opacity-100"
                              : "opacity-30"
                          }
                        >
                          ★
                        </span>
                      ))}
                    </div>
                    <div className="text-xs text-indigo-600 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      View Details →
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : scenario.state === "simulate" ? (
        <section className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden flex flex-col h-[600px]">
          <div className="bg-indigo-600 text-white p-4 font-bold flex justify-between items-center">
            <span>Roleplay Session</span>
            <span className="text-xs bg-indigo-500 px-2 py-1 rounded">
              Live AI
            </span>
          </div>

          {/* Chat History */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {chatHistory.length === 0 && (
              <div className="text-center text-slate-400 mt-10 italic">
                Start the conversation...
              </div>
            )}
            {chatHistory.map((msg, idx) => (
              <div
                key={idx}
                className={`flex flex-col ${msg.speaker === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl p-4 ${
                    msg.speaker === "user"
                      ? "bg-indigo-600 text-white rounded-tr-none"
                      : "bg-white border border-slate-200 text-slate-800 rounded-tl-none shadow-sm"
                  }`}
                >
                  <div className="text-xs opacity-70 mb-1 flex items-center gap-2">
                    <span>{msg.speaker === "user" ? (scenario.roles?.user ?? "You") : (msg.roleName ?? (Array.isArray(scenario.roles?.ai) ? scenario.roles.ai[0] : scenario.roles?.ai) ?? "AI")}</span>
                    {msg.speaker !== "user" && (
                      <button
                        onClick={() => playTts(msg.text)}
                        className="opacity-50 hover:opacity-100 hover:bg-black/10 rounded p-0.5 transition-all"
                        title="Replay Audio"
                      >
                        <Volume2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="text-lg">{msg.text}</div>
                </div>
                {/* Correction Display */}
                {msg.correction && (
                  <div className="mt-2 text-sm bg-orange-50 text-orange-800 p-2 rounded border border-orange-100 max-w-[80%] animate-in fade-in slide-in-from-top-1">
                    <strong>Wait:</strong> {msg.correction}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Goal Achieved Banner */}
          {chatHistory.length > 0 &&
            chatHistory[chatHistory.length - 1].sceneFinished && (
              <div className="bg-green-100 border-t border-green-200 p-3 text-center animate-in slide-in-from-bottom-2">
                <div className="text-green-800 font-bold flex items-center justify-center gap-2">
                  <span>🎉</span>
                  <span>Goal Achieved! You can finish the session now.</span>
                </div>
              </div>
            )}

          {/* Input Area */}
          <div className="p-4 bg-white border-t border-slate-200">
            {hintVisible && nextHintLine && (
              <div className="mb-3 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 animate-in fade-in slide-in-from-bottom-1">
                <span className="font-semibold text-amber-600 text-xs uppercase tracking-wide mr-2">Hint</span>
                {nextHintLine.translation}
              </div>
            )}
            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                type="text"
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                placeholder="Type your response in Japanese..."
                className="flex-1 px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                disabled={isSending}
              />
              {isSpeechSupported && (
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`px-4 py-3 rounded-lg font-bold transition-all border ${
                    isListening
                      ? "bg-red-50 text-red-600 border-red-200 animate-pulse ring-2 ring-red-100"
                      : "bg-white text-slate-400 border-slate-200 hover:text-slate-600 hover:bg-slate-50"
                  }`}
                  title={isListening ? "Stop Listening" : "Start Listening"}
                >
                  <Mic
                    size={20}
                    className={isListening ? "fill-current" : ""}
                  />
                </button>
              )}
              {hintUnlocked && nextHintLine && (
                <button
                  type="button"
                  onClick={() => setHintVisible((v) => !v)}
                  className="px-4 py-3 rounded-lg font-bold text-sm border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors animate-in fade-in"
                >
                  {hintVisible ? "Hide" : "Hint"}
                </button>
              )}
              <button
                type="submit"
                disabled={isSending || !userMessage.trim()}
                className={`px-6 py-3 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors ${
                  isSending || !userMessage.trim()
                    ? "opacity-50 cursor-not-allowed"
                    : ""
                }`}
              >
                {isSending ? "..." : "Send"}
              </button>
            </form>
          </div>
        </section>
      ) : (
        <>
          {/* Main Stage: the play-through */}
          <ScenePlayer dialogue={scenario.dialogue} userRole={scenario.roles?.user} />

          {/* Grammar Notes (Genki Style) */}
          {scenario.grammarNotes && scenario.grammarNotes.length > 0 && (
            <section className="mt-12 pt-8 border-t border-slate-200">
              <h2 className="text-xl font-bold text-slate-800 mb-6">
                Grammar Notes
              </h2>
              <div className="grid gap-6">
                {scenario.grammarNotes.map((note, idx) => (
                  <div
                    key={idx}
                    className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-lg"
                  >
                    <h3 className="font-bold text-amber-900 mb-2">
                      {note.title}
                    </h3>
                    <p className="text-amber-800 mb-3 text-sm leading-relaxed">
                      {note.explanation}
                    </p>
                    <div className="bg-white/60 p-2 rounded text-amber-900 text-sm font-mono">
                      <span className="font-medium">{note.exampleInContext.japanese}</span>
                      <span className="ml-2 text-amber-700 font-sans font-normal">({note.exampleInContext.english})</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Key Vocabulary Widget - Only show if NOT completed (or maybe show in report card? No, let's hide it in report card for now to reduce noise) */}
      {scenario.state !== "completed" && (
        <section className="mt-12 pt-8 border-t border-slate-200">
          <h2 className="text-xl font-bold text-slate-800 mb-6">
            Key Vocabulary
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {scenario.extractedKUs.map((ku, idx) => {
              const status = ku.kuId ? kuStatus[ku.kuId] : undefined;
              // minSrsStage (not max) — this is the same value the roleplay-readiness
              // gate checks, so a KU never shows "Familiar" while a different, unreviewed
              // facet of the same word is what's actually still blocking roleplay.
              const badge = kuSrsBadge(status?.minSrsStage ?? (ku.kuId ? null : undefined));
              return (
                <div
                  key={idx}
                  className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden"
                >
                  {badge && (
                    <div className={`absolute top-0 right-0 text-xs px-2 py-1 rounded-bl-lg font-semibold ${badge.className}`}>
                      {badge.text}
                    </div>
                  )}
                  <div className="text-center">
                    <div className="text-sm text-slate-500 mb-1">{ku.reading}</div>
                    <div className="text-2xl font-bold text-slate-800 mb-2">{ku.content}</div>
                    <div className="text-sm text-slate-600 font-medium">{ku.meaning}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Key Grammar: gates the roleplay alongside Key Vocabulary */}
      {scenario.state !== "completed" && keyGrammar.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-bold text-slate-800 mb-6">
            Key Grammar
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {keyGrammar.map((g) => {
              const badge = kuSrsBadge(kuStatus[g.kuId]?.minSrsStage ?? null);
              const example = scenario.grammarMatches?.find(m => m.kuId === g.kuId)?.exampleFromConversation;
              return (
                <div
                  key={g.kuId}
                  className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm relative overflow-hidden"
                >
                  {badge && (
                    <div className={`absolute top-0 right-0 text-xs px-2 py-1 rounded-bl-lg font-semibold ${badge.className}`}>
                      {badge.text}
                    </div>
                  )}
                  <GrammarPatternDisplay pattern={g.content} size="compact" className="text-xl font-bold text-slate-800" />
                  {g.title && <div className="text-sm text-slate-600 font-medium">{g.title}</div>}
                  {example?.japanese && <div className="mt-2 text-sm text-slate-500">{example.japanese}</div>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Action Footer */}
      {/* Only show if NOT completed, because Report Card has its own button */}
      {scenario.state !== "completed" && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 shadow-lg">
          <div className="max-w-4xl mx-auto">
            {scenario.state === "encounter" ? (
              <div className="space-y-2">
                {(scenario.secondaryKUs?.length ?? 0) > 0 && (
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" checked={includeScriptWords} onChange={e => setIncludeScriptWords(e.target.checked)} />
                    Also learn the other words in the script ({scenario.secondaryKUs!.length})
                  </label>
                )}
                <button
                  onClick={handleAdvance}
                  disabled={advancing}
                  className={`w-full py-4 text-lg rounded-xl font-bold transition-colors shadow-sm bg-indigo-600 hover:bg-indigo-700 text-white ${advancing ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {advancing ? "Processing..." : "Start Learning Vocab and Grammar"}
                </button>
              </div>
            ) : (
              <div className="flex justify-between items-center">
                {scenario.state === "drill" ? (
                  <div className="text-sm">
                    {kuStatusLoading ? (
                      <span className="text-slate-400">Checking vocab progress...</span>
                    ) : (
                      <span className={readyKUs.length === linkedKUs.length ? "text-green-600 font-medium" : "text-slate-500"}>
                        {readyKUs.length}/{linkedKUs.length} words and grammar reviewed
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">
                    {scenario.extractedKUs.length} items extracted
                  </div>
                )}
                <div className="flex flex-col items-end gap-1">
                  <button
                    onClick={handleAdvance}
                    disabled={
                      advancing ||
                      (scenario.state === "drill" && !isReadyForRoleplay) ||
                      (scenario.state === "simulate" && chatHistory.length === 0)
                    }
                    title={scenario.state === "drill" && !isReadyForRoleplay ? `${readyKUs.length}/${linkedKUs.length} words and grammar points at Familiar (SRS stage 3): all of them need to be there first` : undefined}
                    className={`px-8 py-3 rounded-lg font-bold transition-colors shadow-sm ${
                      scenario.state === "drill"
                        ? isReadyForRoleplay
                          ? "bg-purple-600 hover:bg-purple-700 text-white"
                          : "bg-slate-300 text-slate-500 cursor-not-allowed"
                        : scenario.state === "simulate"
                          ? scenario.isObjectiveMet
                            ? "bg-green-600 hover:bg-green-700 text-white"
                            : "bg-amber-500 hover:bg-amber-600 text-white"
                          : "bg-green-600 hover:bg-green-700 text-white"
                    } ${advancing || (scenario.state === "simulate" && chatHistory.length === 0) ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {advancing
                      ? "Processing..."
                      : scenario.state === "drill"
                        ? "Start Roleplay →"
                        : scenario.state === "simulate"
                          ? scenario.isObjectiveMet
                            ? "Complete Mission"
                            : "End Session Early"
                          : "Completed"}
                  </button>
                  {scenario.state === "drill" && !isReadyForRoleplay && !kuStatusLoading && (
                    <button
                      onClick={handleAdvance}
                      disabled={advancing}
                      className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-600 transition-colors disabled:opacity-50"
                    >
                      Start anyway
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Admin, on a pool scenario: write its simulation brief and (re)build its script words. Reads the
 * pool doc itself, not this page's merged copy (the admin's own progress could hide the pool's list).
 */
function PoolAdminPanel({ poolId, onChanged }: { poolId: string; onChanged: () => unknown }) {
  const [brief, setBrief] = useState("");
  const [scriptWords, setScriptWords] = useState(0);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/scenarios/pool/${poolId}`);
    if (!res.ok) return;
    const body = await res.json();
    setBrief(body.simulationBrief ?? "");
    setDraft(body.simulationBrief ?? "");
    setScriptWords(body.scriptWords ?? 0);
  }, [poolId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, call: () => Promise<Response>, done: (body: any) => string) => {
    setBusy(true);
    setStatus(label);
    try {
      const res = await call();
      const body = await res.json().catch(() => ({}));
      setStatus(res.ok ? done(body) : `Failed: ${body.message ?? res.status}`);
      if (res.ok) await Promise.all([load(), onChanged()]);
    } catch (e) {
      setStatus(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-dashed border-slate-300 p-4 space-y-3 text-sm">
      <h2 className="font-semibold text-slate-700">Pool scenario (admin) · {poolId}</h2>
      <div>
        <label className="block text-xs text-slate-500 mb-1">
          Simulation brief: what the role play adds to the scene (shared by every learner)
        </label>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={3}
          className="w-full rounded border border-slate-300 p-2 text-slate-800"
          placeholder="e.g. The train is delayed; the traveller has to ask about another way to get there."
        />
        <button
          disabled={busy || draft === brief}
          onClick={() => run("Saving…", () => apiFetch(`/api/scenarios/pool/${poolId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ simulationBrief: draft }),
          }), () => "Brief saved.")}
          className="mt-1 px-3 py-1 rounded bg-shodo-ink text-shodo-paper disabled:opacity-40"
        >
          Save brief
        </button>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-slate-600">Script words: {scriptWords}</span>
        <button
          disabled={busy}
          onClick={() => run("Finding script words…", () => apiFetch(`/api/scenarios/pool/${poolId}/script-words`, { method: "POST" }), b => `Found ${b.count} script words.`)}
          className="px-3 py-1 rounded border border-slate-300 text-slate-700 disabled:opacity-40"
        >
          Find script words
        </button>
      </div>
      {status && <p className="text-xs text-slate-500">{status}</p>}
    </section>
  );
}
