"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { KnowledgeUnit, VocabLesson, VocabKnowledgeUnit, KanjiLesson, GrammarLesson } from "@/types";
import ReportContentIssue, { lessonLabel } from "@/components/lessons/ReportContentIssue";
import KuMetaTags from "@/components/lessons/KuMetaTags";
import LessonSlideStack from "@/components/learn/LessonSlideStack";
import { LoadedItem, fetchLesson } from "@/components/learn/LessonSlides";
import { FuriganaText } from "@/components/FuriganaText";
import { buildFuriganaMarkup, stripFurigana } from "@/lib/furigana";
import { audioFirstPictures } from "@/lib/pictures";
import { apiFetch } from "@/lib/api-client";

type Facet = { facetType: string };
type Scenario = { id: string; title: string; sourceContextSentence?: string };

/**
 * A learning item's lesson: its slides on one page (the same slides Start Learning shows), read
 * only. Plus practising an example in a scenario and reporting a problem with the lesson. An item
 * still waiting for its lesson points to Start Learning, the only way to start one. Learners don't
 * edit lessons or choose card types.
 */
export default function LearnItemPage() {
  const params = useParams();
  const kuId = Array.isArray(params.kuId) ? params.kuId[0] : params.kuId;
  const fetched = useRef(false);

  const [ku, setKu] = useState<KnowledgeUnit | null>(null);
  const [loaded, setLoaded] = useState<LoadedItem | null>(null);
  const [facets, setFacets] = useState<Facet[] | null>(null);
  const [scenarios, setScenarios] = useState<Record<string, Scenario>>({});
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);

  const loadFacets = useCallback(async (id: string): Promise<Facet[]> => {
    const res = await apiFetch(`/api/reviews/facets?kuId=${id}`);
    const list = res.ok ? await res.json() : [];
    const result = Array.isArray(list) ? (list as Facet[]) : [];
    setFacets(result);
    return result;
  }, []);

  useEffect(() => {
    if (!kuId || fetched.current) return;
    fetched.current = true; // React Strict Mode mounts twice in dev
    (async () => {
      try {
        const kuRes = await apiFetch(`/api/knowledge-units/${kuId}`);
        if (!kuRes.ok) throw new Error(kuRes.status === 404 ? "Learning item not found." : "Couldn't load the learning item");
        const kuData = (await kuRes.json()) as KnowledgeUnit;
        setKu(kuData);
        const item = { kuId: kuData.id, content: kuData.content, type: kuData.type };
        const [lesson, itemFacets, scenarioRes] = await Promise.all([
          fetchLesson(item, new AbortController().signal),
          loadFacets(kuData.id),
          apiFetch(`/api/scenarios?sourceKuId=${kuData.id}`),
        ]);
        // An audio-first word is shown as Start Learning teaches it: picture and sound, no kanji.
        const pictures = kuData.type === "Vocab" ? await audioFirstPictures(kuData.id, itemFacets) : [];
        setLoaded({ item, lesson, ...(pictures.length ? { pictures } : {}) });
        if (scenarioRes.ok) {
          const list = (await scenarioRes.json()) as Scenario[];
          setScenarios(Object.fromEntries(list.filter((s) => s.sourceContextSentence).map((s) => [s.sourceContextSentence!, s])));
        }
      } catch (e: any) {
        setError(e.message ?? "Something went wrong");
      }
    })();
  }, [kuId, loadFacets]);

  /** Writes a roleplay scenario around one example sentence (about a minute), then links to it. */
  const practise = async (sentence: string) => {
    if (!ku) return;
    setGenerating(sentence);
    setError(null);
    try {
      const res = await apiFetch("/api/tutor/generate-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme: "Practice vocabulary in context",
          sourceType: "context-example",
          sourceContextSentence: sentence,
          targetVocab: ku.content,
          sourceKuId: ku.id,
          strict: true,
        }),
      });
      if (!res.ok) throw new Error("Couldn't write the scenario");
      const { id } = (await res.json()) as { id: string };
      setScenarios((s) => ({ ...s, [sentence]: { id, title: "", sourceContextSentence: sentence } }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(null);
    }
  };

  const lesson = loaded?.lesson;
  // Audio-first: the word is taught by picture and sound only, so nothing on the page shows it written.
  const audioFirst = !!loaded?.pictures?.length;
  const title = !ku || !lesson
    ? "…"
    : audioFirst
      ? "New word · listen"
      : lesson.type === "Vocab"
      ? <FuriganaText text={buildFuriganaMarkup(ku.content, (lesson as VocabLesson).component_kanji ?? [])} />
      : lesson.type === "Kanji"
        ? (lesson as KanjiLesson).kanji || ku.content
        : (lesson as GrammarLesson).title || ku.content;
  const examples = lesson?.type === "Vocab" && !audioFirst ? (lesson as VocabLesson).context_examples ?? [] : [];

  return (
    <main className="container mx-auto max-w-2xl p-8">
      <header className="mb-8">
        <h1 className={`font-bold text-shodo-ink mb-2 break-all ${audioFirst ? "text-3xl" : lesson?.type === "Grammar" ? "text-4xl" : "text-6xl"}`}>
          {title}
        </h1>
        {lesson?.type === "Vocab" && (
          <KuMetaTags
            partOfSpeech={(lesson as VocabLesson).partOfSpeech}
            conjugationType={(lesson as VocabLesson).conjugationType}
            jlptLevel={ku?.type === "Vocab" ? (ku as VocabKnowledgeUnit).data.jlptLevel : null}
            wanikaniLevel={ku?.type === "Vocab" ? (ku as VocabKnowledgeUnit).data.wanikaniLevel : null}
          />
        )}
        {lesson?.type === "Grammar" && <p className="text-xl text-shodo-ink-light">Grammar pattern</p>}
        {lesson && ku && (
          <div className="mt-3">
            <ReportContentIssue kuId={ku.id} kuContent={lessonLabel(lesson) ?? ku.content} lesson={lesson} />
          </div>
        )}
      </header>

      {error && <p className="mb-6 rounded-md border border-shodo-stamp-red/40 p-4 text-shodo-stamp-red">{error}</p>}
      {!loaded && !error && <p className="text-center text-shodo-ink-light">Loading lesson…</p>}

      {loaded && <LessonSlideStack loaded={loaded} />}

      {/* Waiting for its lesson (no cards yet): only Start Learning starts it, oldest first. */}
      {loaded && facets !== null && facets.length === 0 && (
        <section className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-shodo-ink/10 pt-6">
          <p className="text-sm text-shodo-ink-light">Waiting for its lesson: Start Learning teaches it.</p>
          <Link
            href="/learn/session"
            className="rounded-lg bg-shodo-ink px-5 py-2.5 font-medium text-shodo-paper hover:bg-shodo-ink/80"
          >
            Start Learning
          </Link>
        </section>
      )}

      {examples.length > 0 && ku && (
        <section className="mt-8 border-t border-shodo-ink/10 pt-6">
          <h2 className="mb-1 font-semibold text-shodo-ink">Practice in a scenario</h2>
          <p className="mb-4 text-sm text-shodo-ink-light">
            A roleplay built around one of these sentences, where you use <strong>{ku.content}</strong> yourself.
          </p>
          <ul className="space-y-3">
            {examples.map((ex) => {
              const existing = scenarios[ex.sentence];
              return (
                <li key={ex.sentence} className="flex items-start justify-between gap-4 rounded-md border border-shodo-ink/10 p-3">
                  <span className="flex flex-col">
                    <span className="text-shodo-ink">{stripFurigana(ex.sentence)}</span>
                    <span className="text-sm text-shodo-ink-light">{stripFurigana(ex.translation)}</span>
                  </span>
                  {existing ? (
                    <a href={`/scenarios/${existing.id}`} className="shrink-0 text-sm text-shodo-indigo hover:underline">
                      View scenario →
                    </a>
                  ) : (
                    <button
                      onClick={() => practise(ex.sentence)}
                      disabled={generating !== null}
                      className="shrink-0 rounded-md border border-shodo-ink/20 px-3 py-1.5 text-sm text-shodo-ink hover:bg-shodo-ink/5 disabled:opacity-40"
                    >
                      {generating === ex.sentence ? "Writing it… (about a minute)" : "Practice this"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
