import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { ReviewItem } from "@/types";

/** How many items past the current one to scout for AI questions. */
const SCOUT_LOOKAHEAD = 3;
/** Max concurrent background question fetches (each may be a Gemini generation). */
const SCOUT_MAX_IN_FLIGHT = 2;

const AI_FACET = "AI-Generated-Question";

export interface ScoutedQuestion {
  question: string;
  answer: string;
  context: string | null;
  altAnswers: string[];
  questionId: string | null;
  isNew: boolean;
}

export interface ScoutEntry {
  status: "loading" | "ready" | "error";
  promise: Promise<ScoutEntry>;
  payload?: ScoutedQuestion;
  error?: string;
}

const isAiItem = (item: ReviewItem | undefined): item is ReviewItem =>
  item?.facet.facetType === AI_FACET;

const belongsToKu = (item: ReviewItem, kuId: string) =>
  item.facet.kuId === kuId || item.facet.source?.id === kuId;

async function requestQuestion(item: ReviewItem): Promise<ScoutedQuestion> {
  const topic = item.facet.data?.topic || item.facet.data?.content || "";
  const response = await apiFetch(
    `/api/questions/generate?topic=${encodeURIComponent(topic)}&facetId=${item.facet.id}&kuId=${item.facet.kuId}`,
  );
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || errData.message || "Failed to generate question");
  }
  const { question, answer, context, accepted_alternatives, questionId, isNew } = await response.json();
  return {
    question,
    answer,
    context: context || null,
    altAnswers: accepted_alternatives || [],
    questionId: questionId || null,
    isNew: isNew ?? false,
  };
}

/**
 * "Scout ahead" for AI-Generated-Question review items.
 *
 * - Prefetches questions for AI items in the next few queue positions (bounded concurrency),
 *   so they're usually ready by the time the learner reaches them.
 * - An AI item that is reached while still loading can be parked (taken out of the queue);
 *   when its question arrives, `reinsert` is called so the page can put it straight after the
 *   item currently being reviewed. The parked list is the only queue — short-lived, per session.
 *
 * Entries are keyed by facet id, so a failed item re-queued later in the session reuses the
 * same question (matching the backend's reuse behaviour) and nothing is ever fetched twice.
 */
export function useQuestionScout(
  reviewQueue: ReviewItem[],
  currentIndex: number,
  reinsert: (item: ReviewItem) => void,
) {
  const entries = useRef(new Map<string, ScoutEntry>());
  const parked = useRef(new Map<string, ReviewItem>());
  // Facets already retried after an error — one retry per session, so a persistent
  // failure can't loop (settle → re-render → retry → settle …).
  const retried = useRef(new Set<string>());
  // Bumped on reset so responses from a previous session are ignored.
  const generation = useRef(0);
  const reinsertRef = useRef(reinsert);
  reinsertRef.current = reinsert;
  // Re-render trigger when an entry settles or the parked list changes.
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const start = useCallback((item: ReviewItem): ScoutEntry => {
    const facetId = item.facet.id;
    const gen = generation.current;
    const entry: ScoutEntry = { status: "loading", promise: Promise.resolve(null as unknown as ScoutEntry) };
    entry.promise = requestQuestion(item)
      .then((payload) => {
        entry.status = "ready";
        entry.payload = payload;
        return entry;
      })
      .catch((err: unknown) => {
        entry.status = "error";
        entry.error = err instanceof Error ? err.message : "An unknown error occurred";
        console.error(`[QuestionScout] failed for facet ${facetId}:`, entry.error);
        return entry;
      })
      .then((settled) => {
        // Ignore responses from a previous session, or for an entry that was replaced
        // (manual retry) or dropped (regenerate-and-reset deleted the facet).
        if (gen !== generation.current || entries.current.get(facetId) !== entry) return settled;
        const parkedItem = parked.current.get(facetId);
        if (parkedItem) {
          parked.current.delete(facetId);
          reinsertRef.current(parkedItem);
        }
        bump();
        return settled;
      });
    entries.current.set(facetId, entry);
    return entry;
  }, [bump]);

  /** Get the entry for an item, starting a fetch if there isn't one (or retrying once after an error). */
  const ensure = useCallback(
    (item: ReviewItem, { retryOnError = false } = {}): ScoutEntry => {
      const facetId = item.facet.id;
      const existing = entries.current.get(facetId);
      if (!existing) return start(item);
      if (retryOnError && existing.status === "error" && !retried.current.has(facetId)) {
        retried.current.add(facetId);
        return start(item);
      }
      return existing;
    },
    [start],
  );

  // Background scouting: prefetch AI items in the lookahead window, bounded concurrency.
  // `version` is a deliberate trigger: when a fetch settles, a slot frees up for the next item.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is an intentional re-run trigger
  useEffect(() => {
    let inFlight = [...entries.current.values()].filter((e) => e.status === "loading").length;
    const end = Math.min(reviewQueue.length, currentIndex + 1 + SCOUT_LOOKAHEAD);
    for (let i = currentIndex + 1; i < end && inFlight < SCOUT_MAX_IN_FLIGHT; i++) {
      const item = reviewQueue[i];
      if (!isAiItem(item) || entries.current.has(item.facet.id)) continue;
      start(item);
      inFlight++;
    }
  }, [reviewQueue, currentIndex, version, start]);

  /** Manual retry (the "Retry question" button): always starts a fresh fetch. */
  const retry = useCallback((item: ReviewItem) => {
    start(item);
    bump();
  }, [start, bump]);

  /** Take a still-loading item out of circulation until its question arrives. */
  const park = useCallback((item: ReviewItem) => {
    parked.current.set(item.facet.id, item);
    bump();
  }, [bump]);

  /**
   * After an AI item has been shown: a requeued copy (failed answer) reuses the same
   * question, but it's no longer "new" — so the keep/request-new modal doesn't open twice.
   */
  const markSeen = useCallback((facetId: string) => {
    const entry = entries.current.get(facetId);
    if (entry?.payload?.isNew) entry.payload = { ...entry.payload, isNew: false };
  }, []);

  /** Drop a question the user rejected (request-new / report), so a requeued copy fetches a fresh one. */
  const forget = useCallback((facetId: string) => {
    entries.current.delete(facetId);
    retried.current.delete(facetId);
  }, []);

  /** Forget everything (new session / reload). */
  const reset = useCallback(() => {
    generation.current++;
    entries.current.clear();
    parked.current.clear();
    retried.current.clear();
    bump();
  }, [bump]);

  /** Drop entries and parked items for a KU (e.g. after an admin regenerate-and-reset deleted its facets). */
  const dropKu = useCallback((kuId: string) => {
    for (const [facetId, item] of parked.current) {
      if (belongsToKu(item, kuId)) {
        parked.current.delete(facetId);
        entries.current.delete(facetId);
      }
    }
    // Unparked entries carry no item, so match on what's still queued.
    for (const item of reviewQueue) {
      if (belongsToKu(item, kuId)) entries.current.delete(item.facet.id);
    }
    bump();
  }, [reviewQueue, bump]);

  return {
    ensure,
    retry,
    park,
    markSeen,
    forget,
    reset,
    dropKu,
    parkedCount: parked.current.size,
    /** Changes whenever an entry settles; include in effect deps that read entries. */
    version,
  };
}
