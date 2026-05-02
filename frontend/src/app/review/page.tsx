"use client";

import React, { useState, useEffect, useRef, FormEvent } from "react";
import Link from "next/link";
import { ReviewItem, ReviewFacet, KnowledgeUnit, Lesson, VocabLesson, KanjiLesson, GrammarLesson } from "@/types";
import * as wanakana from "wanakana";
import { logger } from "@/lib/logger";
import { QuestionFeedbackModal } from "@/components/QuestionFeedbackModal";
import EditKnowledgeUnitModal from "@/components/EditKnowledgeUnitModal";
import { getSrsLevelName, getSrsLevelIndex } from "@/utils/srs";
import { apiFetch } from "@/lib/api-client";
import SentenceAssemblyCard from "@/components/review/SentenceAssemblyCard";
import SentenceClozeCard from "@/components/review/SentenceClozeCard";
import VocabLessonView from "@/components/lessons/VocabLessonView";
import KanjiLessonView from "@/components/lessons/KanjiLessonView";
import GrammarLessonView from "@/components/lessons/GrammarLessonView";

type AnswerState = "unanswered" | "evaluating" | "correct" | "incorrect";

export default function ReviewPage() {
  const [reviewQueue, setReviewQueue] = useState<ReviewItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userAnswer, setUserAnswer] = useState("");
  const [answerState, setAnswerState] = useState<AnswerState>("unanswered");
  const [aiExplanation, setAiExplanation] = useState("");
  const [sessionFailureCounts, setSessionFailureCounts] = useState<
    Record<string, number>
  >({});

  // --- State for AI-Generated Questions ---
  const [isFetchingDynamicQuestion, setIsFetchingDynamicQuestion] =
    useState(false);
  const [dynamicQuestion, setDynamicQuestion] = useState<string | null>(null);
  const [dynamicAnswer, setDynamicAnswer] = useState<string | null>(null);
  const [dynamicContext, setDynamicContext] = useState<string | null>(null);
  const [dynamicAltAnswers, setDynamicAltAnswers] = useState<string[]>([]);
  const [dynamicQuestionId, setDynamicQuestionId] = useState<string | null>(
    null,
  );
  const [dynamicQuestionIsNew, setDynamicQuestionIsNew] = useState<boolean>(false);

  // --- Feedback Modal State ---
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);

  const [pendingSrsResult, setPendingSrsResult] = useState<
    "pass" | "fail" | null
  >(null);

  const [levelStatus, setLevelStatus] = useState<{
    direction: "up" | "down";
    newLevel: string;
  } | null>(null);

  // --- Edit Modal State ---
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingKu, setEditingKu] = useState<KnowledgeUnit | null>(null);

  // --- Inline Lesson Panel State ---
  const [showLesson, setShowLesson] = useState(false);
  const [lessonForReview, setLessonForReview] = useState<Lesson | null>(null);
  const [isFetchingLesson, setIsFetchingLesson] = useState(false);

  // --- Audio State ---
  const audioCache = useRef<Record<string, string>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchAndPlayAudio = async (text: string) => {
    if (audioCache.current[text]) {
      if (audioRef.current) {
        audioRef.current.src = audioCache.current[text];
        audioRef.current.play();
      }
      return;
    }
    
    try {
      const response = await apiFetch("/api/audio/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        audioCache.current[text] = url;
        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.play();
        }
      }
    } catch (e) {
      console.error("Failed to play audio", e);
    }
  };

  const currentItem = reviewQueue[currentIndex];

  const reviewCount = reviewQueue.length;

  const lastFetchedIndex = useRef<number | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);

  // --- Focus Next Button Effect ---
  const FOCUS_TIMEOUT_MS = 50;

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    if (answerState === "correct" || answerState === "incorrect") {
      // Small timeout to ensure render is complete and element is visible
      timeoutId = setTimeout(() => {
        nextButtonRef.current?.focus();
      }, FOCUS_TIMEOUT_MS);
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [answerState]);

  // Focus the answer input after AI-Generated question finishes loading
  useEffect(() => {
    if (
      currentItem?.facet.facetType === "AI-Generated-Question" &&
      !isFetchingDynamicQuestion &&
      dynamicQuestion
    ) {
      answerInputRef.current?.focus();
    }
  }, [isFetchingDynamicQuestion, dynamicQuestion, currentItem]);

  // --- Fetch Dynamic Question Logic ---
  const fetchDynamicQuestion = async (
    topic: string,
    facetId: string,
    kuId: string,
  ) => {
    setIsFetchingDynamicQuestion(true);
    setError(null);
    try {
      const response = await apiFetch(
        `/api/questions/generate?topic=${encodeURIComponent(topic)}&facetId=${facetId}&kuId=${kuId}`,
        // `/api/generate-question?topic=${encodeURIComponent(topic)}&facetId=${facetId}&kuId=${kuId}`,
      );
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to generate question");
      }
      const {
        question,
        answer,
        context,
        accepted_alternatives,
        questionId,
        isNew,
      } = await response.json();
      setDynamicQuestion(question);
      setDynamicAnswer(answer);
      setDynamicContext(context || null);
      setDynamicAltAnswers(accepted_alternatives || null);
      setDynamicQuestionId(questionId || null);
      setDynamicQuestionIsNew(isNew ?? false);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      else setError("An unknown error occurred");
    } finally {
      setIsFetchingDynamicQuestion(false);
    }
  };

  // --- Data Fetching ---
  useEffect(() => {
    const fetchDueItems = async () => {
      try {
        setIsLoading(true);
        setError(null);
        // TODO usenestjs backend service instead
        const response = await apiFetch("/api/reviews/facets?due=true");
        if (!response.ok) {
          throw new Error("Failed to fetch due review items");
        }
        const data: ReviewItem[] = await response.json();
        setReviewQueue(shuffleArray(data));
      } catch (err) {
        if (err instanceof Error) setError(err.message);
        else setError("An unknown error occurred");
      } finally {
        setIsLoading(false);
      }
    };
    fetchDueItems();
  }, []);

  // --- Effect to handle current item changes ---
  useEffect(() => {
    if (currentItem && currentItem.facet.facetType === "audio") {
      // Small timeout to let UI mount
      setTimeout(() => {
        fetchAndPlayAudio(currentItem.facet.data?.reading || currentItem.facet.data?.content);
      }, 50);
    }

    if (
      currentItem &&
      currentItem.facet.facetType === "AI-Generated-Question"
    ) {
      // --- FIX: Double Fetch Prevention ---
      // If we have already triggered a fetch for this exact index, do nothing.
      if (lastFetchedIndex.current === currentIndex) {
        return;
      }

      // Mark this index as fetched
      lastFetchedIndex.current = currentIndex;

      setDynamicQuestion(null);
      setDynamicAnswer(null);
      setDynamicAltAnswers([]);
      setDynamicContext(null);
      setDynamicQuestionId(null);
      setDynamicQuestionIsNew(false);

      const topic = currentItem.facet.data?.topic || currentItem.facet.data?.content || '';
      fetchDynamicQuestion(
        topic,
        currentItem.facet.id,
        currentItem.facet.kuId,
      );
    } else {
      setDynamicQuestion(null);
      setDynamicAnswer(null);
      setDynamicAltAnswers([]);
      setDynamicContext(null);
      setDynamicQuestionId(null);
      setDynamicQuestionIsNew(false);
    }
  }, [currentItem, currentIndex]); // Re-run whenever the currentItem OR the index changes

  function shuffleArray<T>(array: T[]): T[] {
    // Create a copy to avoid mutating the original state directly
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  }

  // --- Core SRS Logic ---

  const handleUpdateSrs = async (result: "pass" | "fail") => {
    if (!currentItem) return;
    try {
      const response = await apiFetch(
        `/api/reviews/facets/${currentItem.facet.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ result }),
        },
      );
      if (!response.ok) throw new Error("Failed to update SRS data");

      const data = await response.json();
      const newStage = data.newStage;
      const oldStage = currentItem.facet.srsStage || 0;

      const oldIndex = getSrsLevelIndex(oldStage);
      const newIndex = getSrsLevelIndex(newStage);

      if (newIndex > oldIndex) {
        setLevelStatus({
          direction: "up",
          newLevel: getSrsLevelName(newStage),
        });
      } else if (newIndex < oldIndex) {
        setLevelStatus({
          direction: "down",
          newLevel: getSrsLevelName(newStage),
        });
      }

      // SUCCESS! The API call finished and was OK.
      // *Now* we dispatch the event from the client.
      window.dispatchEvent(new Event("refreshStats"));
    } catch (err) {
      // SRS update failure is non-blocking — the user already saw their result and can continue.
      // Show a soft warning rather than a hard error so the review flow isn't disrupted.
      setError("SRS update failed — your answer was recorded but your schedule may not have updated. You can continue reviewing.");
    }
  };

  const recordFeedback = async (
    questionId: string,
    feedback: "keep" | "request-new" | "report",
  ) => {
    try {
      const res = await apiFetch(`/api/questions/${questionId}/feedback`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback }),
      });
      if (!res.ok) {
        console.error(`[ReviewPage] recordFeedback failed: ${res.status}`);
      }
    } catch (err) {
      console.error("Failed to record feedback", err);
    }
  };

  const isNewAiQuestion = (item: ReviewItem) => {
    if (item.facet.facetType !== "AI-Generated-Question") return false;
    return dynamicQuestionIsNew;
  };

  const handleEvaluateAnswer = async (e: FormEvent) => {
    e.preventDefault();
    if (answerState !== "unanswered" || !currentItem) return;

    // --- New: Short-circuit for empty answer ---
    if (userAnswer.trim() === "") {
      setAiExplanation("No answer provided.");

      // Check if we need to defer SRS update
      if (isNewAiQuestion(currentItem)) {
        setPendingSrsResult("fail");
        // Do NOT call handleUpdateSrs here
        await handleUpdateSrs("fail");
      }

      setAnswerState("incorrect");

      setAnswerState("incorrect");

      const facetId = currentItem.facet.id;
      const newFailureCount = (sessionFailureCounts[facetId] || 0) + 1;
      setSessionFailureCounts((prevCounts) => ({
        ...prevCounts,
        [facetId]: newFailureCount,
      }));
      if (newFailureCount < 2) {
        setReviewQueue((prevQueue) => [...prevQueue, currentItem]);
      }
      return;
    }
    // --- End New ---

    setAnswerState("evaluating");
    setError(null);
    setAiExplanation("");

    const expectedAnswers = getExpectedAnswer(currentItem); // Now using array
    const question = getQuestion(currentItem);
    const topic = currentItem.facet.data?.content || '';
    const questionType = getQuestionType(currentItem); // Get the question type
    // Use dynamicQuestionId if available (for AI questions), otherwise fallback to facet's currentQuestionId (though that might be stale)
    const questionId = dynamicQuestionId || currentItem.facet.currentQuestionId;

    // TODO This shouldn't work
    if (
      expectedAnswers.length === 0 &&
      currentItem.facet.facetType === "AI-Generated-Question"
    ) {
      setError("Waiting for dynamic question to load.");
      setAnswerState("unanswered");
      return;
    }

    try {
      const response = await apiFetch("/api/reviews/evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userAnswer,
          expectedAnswers,
          question,
          topic,
          questionType,
          questionId,
          kuId: currentItem.facet.kuId,
          facetType: currentItem.facet.facetType,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Evaluation API failed");
      }

      const { result, explanation } = await response.json();
      setAiExplanation(explanation);

      if (result === "pass") {
        if (isNewAiQuestion(currentItem)) {
          setPendingSrsResult("pass");
        } else {
          await handleUpdateSrs("pass");
        }
        setAnswerState("correct");
      } else {
        if (isNewAiQuestion(currentItem)) {
          setPendingSrsResult("fail");
        } else {
          await handleUpdateSrs("fail");
        }
        setAnswerState("incorrect");

        const facetId = currentItem.facet.id;
        const newFailureCount = (sessionFailureCounts[facetId] || 0) + 1;

        setSessionFailureCounts((prevCounts) => ({
          ...prevCounts,
          [facetId]: newFailureCount,
        }));

        // Only re-queue if failed less than 2 times in this session
        if (newFailureCount < 2) {
          setReviewQueue((prevQueue) => [...prevQueue, currentItem]);
        }
      }
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      else setError("An unknown error occurred");
      setAnswerState("unanswered");
    }
  };

  const handleSkip = () => {
    advanceToNext();
  };

  const handleShowLesson = async () => {
    if (showLesson) {
      setShowLesson(false);
      return;
    }
    if (lessonForReview) {
      setShowLesson(true);
      return;
    }
    if (!currentItem) return;
    setIsFetchingLesson(true);
    try {
      const res = await apiFetch("/api/lessons/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kuId: currentItem.facet.kuId }),
      });
      if (res.ok) {
        const data = await res.json() as Lesson;
        setLessonForReview(data);
        setShowLesson(true);
      }
    } catch (e) {
      console.error("Failed to fetch lesson for review", e);
    } finally {
      setIsFetchingLesson(false);
    }
  };

  const goToNextItem = () => {
    // If it's a new AI question and we haven't shown feedback yet
    const isNew = isNewAiQuestion(currentItem);

    if (isNew && pendingSrsResult) {
      setShowFeedbackModal(true);
      return;
    }

    advanceToNext();
  };

  const advanceToNext = () => {
    setUserAnswer("");
    setAnswerState("unanswered");
    setAiExplanation("");
    setError(null);
    setPendingSrsResult(null);
    setShowFeedbackModal(false);
    setLevelStatus(null);
    setShowLesson(false);
    setLessonForReview(null);
    // Use functional update to ensure we use the latest state
    setCurrentIndex((prevIndex) => prevIndex + 1);
  };

  // --- Edit Handlers ---
  const handleEditClick = async () => {
    if (!currentItem) return;
    try {
      const response = await apiFetch(`/api/knowledge-units/${currentItem.facet.kuId}`);
      if (response.ok) {
        const kuData = await response.json() as KnowledgeUnit;
        setEditingKu(kuData);
        setIsEditModalOpen(true);
      }
    } catch (err) {
      console.error("Failed to fetch KU for editing", err);
    }
  };

  const handleSaveKu = async (id: string, updates: Partial<KnowledgeUnit>) => {
    try {
      const response = await apiFetch(`/api/knowledge-units/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error("Failed to update unit");
      }

      window.dispatchEvent(new CustomEvent("refreshStats"));
    } catch (err) {
      console.error(err);
      alert("Failed to save changes");
    }
  };

  const handleFeedbackKeep = async () => {
    if (pendingSrsResult) await handleUpdateSrs(pendingSrsResult);
    if (dynamicQuestionId) await recordFeedback(dynamicQuestionId, "keep");
    advanceToNext();
  };

  const handleFeedbackRequestNew = async () => {
    if (dynamicQuestionId) await recordFeedback(dynamicQuestionId, "request-new");
    // Don't update SRS — facet stays due so it reappears with a fresh question next session
    advanceToNext();
  };

  const handleFeedbackUndecided = async () => {
    if (dynamicQuestionId) await recordFeedback(dynamicQuestionId, "report");
    if (pendingSrsResult) await handleUpdateSrs(pendingSrsResult);
    advanceToNext();
  };

  // --- Helper Functions ---

  const getQuestion = (item: ReviewItem): string | null => {
    const { facet } = item;
    switch (facet.facetType) {
      case "audio":
        return facet.data?.clozeSentence || facet.data?.contextExample?.sentence || "Context not found";
      case "AI-Generated-Question":
        return dynamicQuestion;
      case "Content-to-Definition":
      case "Content-to-Reading":
      case "Kanji-Component-Meaning":
      case "Kanji-Component-Reading":
        return facet.data?.content || "[No content]";
      case "Definition-to-Content":
        return facet.data?.definitions?.[0] || "[No Definition]";
      case "Reading-to-Content":
        return facet.data?.reading || "[No Reading]";
      default:
        return "Unknown Facet";
    }
  };

  const getQuestionType = (item: ReviewItem): string => {
    switch (item.facet.facetType) {
      case "AI-Generated-Question":
        return "Usage patterns";
      case "Content-to-Definition":
        return (item.facet.data?.kuType === "Grammar" || !item.facet.data?.reading)
          ? "Grammar Pattern → Meaning"
          : "Vocab Definition";
      case "Content-to-Reading":
        return "Vocab Reading";
      case "Kanji-Component-Meaning":
        return "Kanji Component Meaning";
      case "Kanji-Component-Reading":
        return "Kanji Component Reading";
      case "Definition-to-Content":
      case "Reading-to-Content":
        return "Vocab/Kanji";
      case "audio":
        return "Audio Comprehension";
      default:
        return "...";
    }
  };

  // Helper to check if we should auto-convert
  const isJapaneseInput = (item: ReviewItem) => {
    const type = item.facet.facetType;
    // Add any other types that expect Japanese input
    return (
      type === "Content-to-Reading" ||
      type === "Kanji-Component-Reading" ||
      type === "AI-Generated-Question"
    );
  };

  const getExpectedAnswer = (item: ReviewItem): string[] => {
    const { facet } = item;

    if (facet.facetType === "AI-Generated-Question") {
      return [...(dynamicAltAnswers ?? []), ...(dynamicAnswer ? [dynamicAnswer] : [])];
    }

    if (facet.facetType === "Definition-to-Content" || facet.facetType === "Reading-to-Content") {
      return facet.data?.content ? [facet.data.content] : [];
    }

    if (facet.facetType === "Content-to-Definition" || facet.facetType === "audio") {
      const defs: string[] = facet.data?.definitions ?? [];
      const parsed = Array.from(new Set(
        defs.flatMap((def: string) => def.split(/[,;]/))
            .map((def: string) => def.trim())
            .filter((def: string) => def.length > 0),
      ));
      if (parsed.length === 0 && facet.data?.topic) {
        return [facet.data.topic];
      }
      return parsed;
    }

    if (facet.facetType === "Content-to-Reading") {
      return facet.data?.reading ? [facet.data.reading] : [];
    }

    if (facet.facetType === "Kanji-Component-Meaning") {
      return (facet.data?.meaning || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter((s: string) => s);
    }

    if (facet.facetType === "Kanji-Component-Reading") {
      return facet.data?.onyomi ?? [];
    }

    logger.warn(`getExpectedAnswer: No answer path for facetType=${facet.facetType}`);
    return [];
  };

  // --- Render Logic ---

  if (isLoading) {
    return (
      <main className="container mx-auto max-w-2xl p-8 text-center">
        <p className="text-xl text-gray-400">Loading reviews...</p>
      </main>
    );
  }

  // Handle both "no items" and "all items done"
  if (!currentItem || currentIndex >= reviewQueue.length) {
    return (
      <main className="container mx-auto max-w-2xl p-8 text-center">
        <h1 className="text-4xl font-bold text-white mb-4">
          Session Complete!
        </h1>
        <p className="text-xl text-gray-400 mb-8">
          You've finished all your due reviews.
        </p>
        <Link
          href="/"
          className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-md shadow-md hover:bg-blue-700"
        >
          Back to Manage
        </Link>
      </main>
    );
  }

  const questionType = getQuestionType(currentItem);
  const questionText = getQuestion(currentItem);
  const isDynamicLoading =
    currentItem.facet.facetType === "AI-Generated-Question" &&
    !error &&
    (isFetchingDynamicQuestion || !questionText);

  return (
    <main className="container mx-auto max-w-2xl p-8">
      <header className="mb-6">
        <span className="text-lg text-gray-400">
          Item {currentIndex + 1} of {reviewCount}
        </span>
      </header>

      {error && (
        <div className={`border p-4 rounded-md mb-6 flex flex-col gap-3 ${
          error.startsWith("SRS update failed")
            ? "bg-yellow-900 border-yellow-600 text-yellow-100"
            : "bg-red-900 border-red-600 text-red-100"
        }`}>
          <div className="flex justify-between items-start gap-4">
            <p className="text-sm leading-snug">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-current opacity-60 hover:opacity-100 shrink-0 text-lg leading-none"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
          {/* Contextual escape hatches */}
          <div className="flex gap-3 flex-wrap">
            {answerState === "unanswered" && currentItem.facet.facetType === "AI-Generated-Question" && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setDynamicQuestion(null);
                  setDynamicAnswer(null);
                  setDynamicAltAnswers([]);
                  setDynamicContext(null);
                  lastFetchedIndex.current = null;
                  fetchDynamicQuestion(
                    currentItem.facet.data?.topic || currentItem.facet.data?.content || '',
                    currentItem.facet.id,
                    currentItem.facet.kuId,
                  );
                }}
                className="text-sm px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded font-medium"
              >
                Retry question
              </button>
            )}
            {answerState === "unanswered" && (
              <button
                type="button"
                onClick={() => { setError(null); advanceToNext(); }}
                className="text-sm px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded font-medium"
              >
                Skip item
              </button>
            )}
            {(answerState === "correct" || answerState === "incorrect") && (
              <button
                type="button"
                onClick={() => { setError(null); goToNextItem(); }}
                className="text-sm px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded font-medium"
              >
                Continue
              </button>
            )}
          </div>
        </div>
      )}

      {/* --- Sentence Assembly --- */}
      {currentItem.facet.facetType === "sentence-assembly" && (
        <SentenceAssemblyCard
          key={currentItem.facet.id}
          facet={currentItem.facet}
          onResult={handleUpdateSrs}
          onAdvance={advanceToNext}
          onSkip={advanceToNext}
        />
      )}

      {/* --- Sentence Cloze --- */}
      {currentItem.facet.facetType === "sentence-cloze" && (
        <SentenceClozeCard
          key={currentItem.facet.id}
          facet={currentItem.facet}
          onResult={handleUpdateSrs}
          onAdvance={advanceToNext}
          onSkip={advanceToNext}
        />
      )}

      {/* --- Review Card --- */}
      {currentItem.facet.facetType !== "sentence-assembly" && currentItem.facet.facetType !== "sentence-cloze" && (
      <div className="bg-gray-800 shadow-2xl rounded-lg p-8">
        {/* Question Area */}
        <div className="text-center mb-8 min-h-[160px] flex flex-col justify-center">
          <p className="text-lg font-semibold text-blue-300 mb-3 truncate px-4">
            {questionType}
          </p>

          {isDynamicLoading ? (
            <p className="text-3xl text-gray-400 animate-pulse">
              Generating question...
            </p>
          ) : (
            <>
              {/* Render Context ONLY if it's a dynamic quiz AND we have context */}
              {currentItem.facet.facetType === "AI-Generated-Question" &&
                dynamicContext && (
                  <p className="text-xl text-gray-300 mb-4 italic">
                    {dynamicContext}
                  </p>
                )}

              {/* Main Question Text */}
              <p
                className={`${currentItem.facet.facetType === "AI-Generated-Question" || currentItem.facet.facetType === "Definition-to-Content" || currentItem.facet.facetType === "audio" ? "text-2xl" : "text-5xl"} font-bold text-white break-words`}
              >
                {questionText || "[Question not loaded]"}
              </p>

              {currentItem.facet.facetType === "audio" && (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={() => fetchAndPlayAudio(currentItem.facet.data?.reading || currentItem.facet.data?.content)}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-500 hover:bg-blue-600 rounded-full text-white font-semibold transition-transform transform active:scale-95 shadow-md"
                  >
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M4.018 14L14.41 9 4.018 4v10z"></path>
                    </svg>
                    Play Audio
                  </button>
                  <audio ref={audioRef} style={{ display: 'none' }} />
                </div>
              )}
            </>
          )}
        </div>

        {/* Answer Form */}
        <form onSubmit={handleEvaluateAnswer} className="relative">
          <input
            ref={answerInputRef}
            key={currentItem.facet.id} // Force re-render (and autoFocus) on new item
            type="text"
            value={userAnswer}
            autoFocus
            onChange={(e) => {
              const input = e.target.value;

              // Only convert if it's a Reading question
              if (isJapaneseInput(currentItem)) {
                // toKana with IMEMode: true mimics real typing behavior
                // e.g., typing 'n' waits to see if 'a' comes next (な) or another 'n' (ん)
                const converted = wanakana.toKana(input, { IMEMode: true });
                setUserAnswer(converted);
              } else {
                // For meanings/definitions, just pass raw text
                setUserAnswer(input);
              }
            }}
            placeholder={
              isJapaneseInput(currentItem)
                ? "回答を入力して..."
                : currentItem.facet.facetType === "audio"
                  ? "Type the English meaning..."
                  : "Type your answer..."
            }
            disabled={answerState !== "unanswered" || isDynamicLoading}
            className="w-full p-4 bg-gray-700 border-2 border-gray-600 text-white text-xl rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-800 disabled:text-gray-500"
          />
          <div className="relative mt-4">
            <button
              type="submit"
              disabled={answerState !== "unanswered" || isDynamicLoading || !userAnswer.trim()}
              className="w-full px-6 py-4 bg-blue-600 text-white text-xl font-semibold rounded-md shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:bg-gray-500 disabled:cursor-wait"
            >
              {answerState === "evaluating" ? "Evaluating..." : "Submit Answer"}
            </button>

            <div className="flex gap-4 mt-4">
              <button
                type="button"
                onClick={handleSkip}
                disabled={answerState !== "unanswered" || isDynamicLoading}
                className="flex-1 px-6 py-3 bg-gray-500 text-white text-lg font-semibold rounded-md shadow-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:bg-gray-800 disabled:text-gray-500"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={handleShowLesson}
                disabled={isFetchingLesson}
                className="flex-1 px-6 py-3 bg-[#0A5C36] text-white text-lg font-semibold rounded-md shadow-md hover:bg-[#084a2b] focus:outline-none focus:ring-2 focus:ring-green-800 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:bg-gray-800 disabled:text-gray-500"
              >
                {isFetchingLesson ? "Loading..." : showLesson ? "Hide Lesson" : "Review Lesson"}
              </button>
            </div>

            {/* Level Change Notification Overlay */}
            {levelStatus && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 w-full">
                <div
                  className={`flex flex-col items-center justify-center p-6 rounded-lg shadow-xl border-2 animate-fade-slide-up mx-auto w-3/4 ${
                    levelStatus.direction === "up"
                      ? "bg-[#0A5C36] border-green-400 text-white"
                      : "bg-red-800 border-red-400 text-white"
                  }`}
                >
                  <span className="text-4xl font-bold mb-2">
                    {levelStatus.direction === "up" ? "▲" : "▼"}
                  </span>
                  <div className="text-center">
                    <p className="text-sm uppercase tracking-wider opacity-80 mb-1">
                      {levelStatus.direction === "up"
                        ? "Level Up"
                        : "Level Down"}
                    </p>
                    <p className="text-2xl font-bold">{levelStatus.newLevel}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </form>
      </div>

      )}

      {/* --- Answer Feedback Section --- */}
      {currentItem.facet.facetType !== "sentence-assembly" && currentItem.facet.facetType !== "sentence-cloze" && answerState !== "unanswered" && answerState !== "evaluating" && (
        <div
          className={`mt-8 p-6 rounded-lg ${
            answerState === "correct"
              ? "bg-green-800 border-green-600"
              : "bg-red-800 border-red-600"
          }`}
        >
          <h3 className="text-2xl font-semibold text-white mb-3">
            {answerState === "correct" ? "Correct" : "Incorrect"}
          </h3>
          <p className="text-lg text-gray-200 mb-2">
            <span className="font-semibold">Your answer:</span> {userAnswer}
          </p>
          {answerState === "incorrect" && (
            <p className="text-lg text-gray-200 mb-4">
              <span className="font-semibold">Correct answer:</span>{" "}
              {getExpectedAnswer(currentItem).join(" / ")}
            </p>
          )}
          {currentItem.facet.facetType === "audio" && (
            <div className="mb-4">
              <p className="text-lg text-gray-200">
                <span className="font-semibold">Word:</span>{" "}
                <span className="text-2xl font-bold text-white">{currentItem.facet.data?.content}</span>
                {currentItem.facet.data?.reading && currentItem.facet.data.reading !== currentItem.facet.data.content && (
                  <span className="ml-2 text-gray-300">({currentItem.facet.data.reading})</span>
                )}
              </p>
              <p className="text-lg text-gray-200 mt-2">
                <span className="font-semibold">In context:</span>{" "}
                {currentItem.facet.data?.contextExample?.sentence}
              </p>
            </div>
          )}
          {aiExplanation === "No answer provided." ? (
            <p className="text-lg text-gray-200 italic">{aiExplanation}</p>
          ) : (
            <p className="text-lg text-gray-200 italic">
              <span className="font-semibold">AI:</span> {aiExplanation}
            </p>
          )}

          {answerState === "incorrect" && currentItem && (
            <div className="mt-4">
              <button
                type="button"
                onClick={handleShowLesson}
                disabled={isFetchingLesson}
                className="px-4 py-2 bg-[#0A5C36] text-white font-semibold rounded-md hover:bg-[#084a2b] disabled:opacity-50"
              >
                {isFetchingLesson ? "Loading..." : showLesson ? "Hide Lesson" : `Review lesson on ${currentItem.facet.data?.content}`}
              </button>
            </div>
          )}

          <div className="mt-6 flex gap-4">
            <button
              onClick={handleEditClick}
              className="px-4 py-3 bg-gray-600 text-white font-semibold rounded-md shadow-md hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-gray-800"
            >
              Edit KU
            </button>
            <button
              ref={nextButtonRef}
              onClick={goToNextItem}
              className="flex-1 px-6 py-3 bg-blue-600 text-white font-semibold rounded-md shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* --- Inline Lesson Panel --- */}
      {showLesson && lessonForReview && (
        <div className="mt-6 bg-shodo-paper border border-shodo-ink/20 rounded-lg p-6 shadow-md">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-shodo-ink">Lesson</h2>
            <button
              type="button"
              onClick={() => setShowLesson(false)}
              className="text-shodo-ink-faint hover:text-shodo-ink text-sm"
            >
              Close
            </button>
          </div>
          {lessonForReview.type === "Vocab" && (
            <VocabLessonView lesson={lessonForReview as VocabLesson} readOnly />
          )}
          {lessonForReview.type === "Kanji" && (
            <KanjiLessonView lesson={lessonForReview as KanjiLesson} />
          )}
          {lessonForReview.type === "Grammar" && (
            <GrammarLessonView
              lesson={lessonForReview as GrammarLesson}
              selectedFacets={{}}
              onToggleFacet={() => {}}
            />
          )}
        </div>
      )}

      <EditKnowledgeUnitModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={handleSaveKu}
        knowledgeUnit={editingKu}
      />

      <QuestionFeedbackModal
        isOpen={showFeedbackModal}
        onKeep={handleFeedbackKeep}
        onRequestNew={handleFeedbackRequestNew}
        onReport={handleFeedbackUndecided}
      />
    </main>
  );
}
