"use client";

/**
 * Assembly lab (admin): mark which fragments of each Grammar example are the pattern, then try
 * the blanks assembly card the backend builds from them (POST /lessons/assembly-card, no AI).
 * An experiment harness: nothing here touches learners' review cards.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as wanakana from "wanakana";
import { apiFetch } from "@/lib/api-client";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import type { GrammarLesson, KnowledgeUnit } from "@/types";

type Example = GrammarLesson["examples"][number];
type ListedKu = KnowledgeUnit & { hasLesson?: boolean };

interface AssemblyCard {
  pieces: { text: string | null; blank?: number }[];
  blanks: { answer: string; accept: string[] }[];
  answer: string;
  english: string;
  alternatives: string[];
}

const LEVELS = ["N5", "N4", "N3", "N2", "N1"] as const;

/** Same rule as SentenceAssemblyCard: trailing punctuation and spaces don't count. */
const normalize = (s: string) => s.replace(/[。、！？!?\.]+$/u, "").replace(/[\s　]+/g, "").trim();

function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function AssemblyLabPage() {
  const [level, setLevel] = useState<string>("N5");
  const [kus, setKus] = useState<ListedKu[]>([]);
  const [kuId, setKuId] = useState<string | null>(null);
  const [examples, setExamples] = useState<Example[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [trial, setTrial] = useState<{ index: number; card: AssemblyCard; key: number } | null>(null);

  useEffect(() => {
    (async () => {
      const res = await apiFetch(`/api/knowledge-units/browse?type=Grammar&jlptLevel=${level}&pageSize=200`);
      setKus(res.ok ? (await res.json()).items : []);
    })();
  }, [level]);

  const openLesson = useCallback(async (id: string) => {
    if (dirty && !confirm("Discard unsaved marks?")) return;
    setKuId(id);
    setExamples(null);
    setTrial(null);
    setDirty(false);
    setStatus(null);
    const res = await apiFetch(`/api/lessons?kuId=${id}`);
    const lesson = res.ok ? await res.json() : null;
    setExamples(lesson?.examples ?? []);
  }, [dirty]);

  const changeExample = (index: number, change: Partial<Example>) => {
    setExamples(prev => prev && prev.map((ex, i) => (i === index ? { ...ex, ...change } : ex)));
    setDirty(true);
    if (trial?.index === index) setTrial(null);
  };

  const toggleMark = (index: number, fragment: number) => {
    const ex = examples![index];
    const marks = new Set(ex.patternFragments ?? []);
    if (marks.has(fragment)) marks.delete(fragment); else marks.add(fragment);
    changeExample(index, { patternFragments: marks.size ? [...marks].sort((a, b) => a - b) : undefined });
  };

  const tryExample = async (index: number) => {
    setStatus(null);
    const res = await apiFetch("/api/lessons/assembly-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ example: examples![index] }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTrial(null);
      setStatus(`Example ${index + 1}: ${body.message ?? `HTTP ${res.status}`}`);
      return;
    }
    setTrial({ index, card: body, key: Date.now() });
  };

  const save = async () => {
    if (!kuId || !examples) return;
    setStatus("Saving…");
    const res = await apiFetch(`/api/lessons/${kuId}/global`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: { examples } }),
    });
    setStatus(res.ok ? "Saved." : `Save failed (HTTP ${res.status})`);
    if (res.ok) setDirty(false);
  };

  const selected = kus.find(k => k.id === kuId);

  return (
    <div className="container mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-shodo-ink">Assembly lab</h1>
        <p className="text-sm text-shodo-ink/50 mt-1">
          Click fragments to mark the grammar pattern, then try the card: build the sentence around the blanks,
          fill them in, or say it. Learners&apos; review cards aren&apos;t affected.
        </p>
      </header>

      <div className="grid grid-cols-[16rem_1fr] gap-6">
        <aside className="space-y-3">
          <select
            value={level}
            onChange={e => setLevel(e.target.value)}
            className="w-full rounded border border-shodo-mist bg-shodo-paper px-2 py-1 text-sm text-shodo-ink"
          >
            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <ul className="max-h-[70vh] overflow-y-auto divide-y divide-shodo-mist border border-shodo-mist rounded">
            {kus.map(ku => (
              <li key={ku.id}>
                <button
                  disabled={!ku.hasLesson}
                  onClick={() => openLesson(ku.id)}
                  title={ku.hasLesson ? undefined : "No lesson yet"}
                  className={`w-full text-left px-3 py-2 text-sm ${ku.id === kuId ? "bg-shodo-ink/10" : "hover:bg-shodo-ink/5"} ${ku.hasLesson ? "text-shodo-ink" : "text-shodo-ink-faint cursor-not-allowed"}`}
                >
                  {ku.content}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="space-y-4">
          {!kuId && <p className="text-shodo-ink-faint">Choose a Grammar point with a lesson.</p>}
          {selected && (
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-shodo-ink">{selected.content}</h2>
              <button
                onClick={save}
                disabled={!dirty}
                className="text-sm px-4 py-1.5 rounded bg-shodo-ink text-shodo-paper disabled:opacity-40"
              >
                Save marks
              </button>
            </div>
          )}
          {status && <p className="text-sm text-shodo-ink-light">{status}</p>}
          {kuId && examples === null && <p className="text-shodo-ink-faint">Loading…</p>}

          {examples?.map((ex, i) => (
            <ExampleRow
              key={i}
              index={i}
              example={ex}
              onToggle={f => toggleMark(i, f)}
              onFragments={fragments => changeExample(i, { fragments, patternFragments: undefined })}
              onTry={() => tryExample(i)}
            >
              {trial?.index === i && <Trial key={trial.key} card={trial.card} />}
            </ExampleRow>
          ))}
        </main>
      </div>
    </div>
  );
}

function ExampleRow({ index, example, onToggle, onFragments, onTry, children }: {
  index: number;
  example: Example;
  onToggle: (fragment: number) => void;
  onFragments: (fragments: string[]) => void;
  onTry: () => void;
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const marks = new Set(example.patternFragments ?? []);

  const apply = () => {
    const parts = draft.split("|").filter(p => p !== "");
    if (parts.join("") !== example.japanese) {
      setError("The pieces must join back into the sentence exactly.");
      return;
    }
    onFragments(parts);
    setEditing(false);
    setError(null);
  };

  return (
    <section className="rounded border border-shodo-mist p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-shodo-ink">{index + 1}. {example.japanese}</p>
          <p className="text-sm text-shodo-ink-faint">{example.english}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => { setEditing(e => !e); setDraft(example.fragments.join("|")); setError(null); }}
            className="text-xs px-3 py-1 rounded border border-shodo-mist text-shodo-ink-light hover:border-shodo-indigo hover:text-shodo-indigo"
          >
            {editing ? "Cancel" : "Edit fragments"}
          </button>
          <button
            onClick={onTry}
            className="text-xs px-3 py-1 rounded bg-shodo-ink text-shodo-paper"
          >
            Try
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {example.fragments.map((f, fi) => (
          <button
            key={fi}
            onClick={() => onToggle(fi)}
            className={`px-3 py-1 rounded border text-base ${marks.has(fi)
              ? "border-shodo-stamp-red bg-shodo-stamp-red/10 text-shodo-stamp-red"
              : "border-shodo-mist text-shodo-ink hover:bg-shodo-ink/5"}`}
          >
            {f}
          </button>
        ))}
      </div>

      {editing && (
        <div className="space-y-1">
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="flex-1 rounded border border-shodo-mist bg-shodo-paper px-2 py-1 text-shodo-ink"
            />
            <button onClick={apply} className="text-xs px-3 py-1 rounded bg-shodo-ink text-shodo-paper">Apply</button>
          </div>
          <p className="text-xs text-shodo-ink-faint">Separate pieces with |. Applying clears this example&apos;s marks.</p>
          {error && <p className="text-xs text-shodo-stamp-red">{error}</p>}
        </div>
      )}

      {children}
    </section>
  );
}

/** Runs one blanks assembly card: order the pieces, fill the blanks, optionally say the sentence. */
function Trial({ card }: { card: AssemblyCard }) {
  const [pool, setPool] = useState<number[]>(() => shuffled(card.pieces.length));
  const [placed, setPlaced] = useState<number[]>([]);
  const [orderResult, setOrderResult] = useState<string | null>(null);
  const [typed, setTyped] = useState<string[]>(() => card.blanks.map(() => ""));
  const [blankResults, setBlankResults] = useState<boolean[] | null>(null);
  const speech = useSpeechRecognition();
  const [speechResult, setSpeechResult] = useState<string | null>(null);

  // Blank chips look the same, so the k-th blank placed stands for the k-th blank of the sentence.
  const blankAt = useMemo(() => {
    const at = new Map<number, number>();
    placed.filter(p => card.pieces[p].text === null).forEach((p, k) => at.set(p, k));
    return at;
  }, [placed, card]);

  const place = (p: number) => { setPool(prev => prev.filter(x => x !== p)); setPlaced(prev => [...prev, p]); setOrderResult(null); };
  const unplace = (p: number) => { setPlaced(prev => prev.filter(x => x !== p)); setPool(prev => [...prev, p]); setOrderResult(null); };

  const matchesSentence = (s: string) => [card.answer, ...card.alternatives].some(a => normalize(a) === normalize(s));

  const checkOrder = () => {
    const joined = placed.map(p => card.pieces[p].text ?? card.blanks[blankAt.get(p)!].answer).join("");
    setOrderResult(matchesSentence(joined) ? "✓ Order accepted" : `✗ Order not accepted: ${joined}`);
  };

  const checkBlanks = () => {
    setBlankResults(card.blanks.map((b, k) =>
      b.accept.some(a => wanakana.toHiragana(normalize(a)) === wanakana.toHiragana(normalize(typed[k]))),
    ));
  };

  const checkSpeech = () => {
    const t = speech.transcript;
    setSpeechResult(matchesSentence(t)
      ? `✓ Heard the sentence: ${t}`
      : `✗ Heard: ${t || "(nothing)"} · expected: ${card.answer}`);
  };

  const chip = "px-3 py-1 rounded border text-base";
  const allPlaced = pool.length === 0;

  return (
    <div className="mt-2 rounded bg-shodo-ink/5 p-4 space-y-4">
      <p className="text-sm text-shodo-ink-light">{card.english}</p>

      <div>
        <p className="text-xs text-shodo-ink-faint mb-1">1. Build the sentence (tap to place, tap again to remove)</p>
        <div className="min-h-10 flex flex-wrap gap-2 items-center border-b border-shodo-mist pb-2">
          {placed.map(p => {
            const k = blankAt.get(p);
            if (k === undefined) {
              return <button key={p} onClick={() => unplace(p)} className={`${chip} border-shodo-mist bg-shodo-paper text-shodo-ink`}>{card.pieces[p].text}</button>;
            }
            return (
              <span key={p} className="flex items-center gap-1">
                <input
                  value={typed[k]}
                  onChange={e => { const v = wanakana.toKana(e.target.value, { IMEMode: true }); setTyped(prev => prev.map((x, j) => (j === k ? v : x))); setBlankResults(null); }}
                  placeholder="＿＿"
                  className={`w-24 rounded border px-2 py-1 text-base bg-shodo-paper ${blankResults ? (blankResults[k] ? "border-shodo-matcha" : "border-shodo-stamp-red") : "border-dashed border-shodo-ink-faint"}`}
                />
                <button onClick={() => unplace(p)} title="Remove" className="text-xs text-shodo-ink-faint">×</button>
              </span>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {pool.map(p => (
            <button key={p} onClick={() => place(p)} className={`${chip} ${card.pieces[p].text === null ? "border-dashed border-shodo-ink-faint text-shodo-ink-faint" : "border-shodo-mist bg-shodo-paper text-shodo-ink"}`}>
              {card.pieces[p].text ?? "＿＿"}
            </button>
          ))}
        </div>
        <button onClick={checkOrder} disabled={!allPlaced} className="mt-2 text-xs px-3 py-1 rounded border border-shodo-mist disabled:opacity-40">Check order</button>
        {orderResult && <p className="text-sm mt-1 text-shodo-ink">{orderResult}</p>}
      </div>

      <div>
        <p className="text-xs text-shodo-ink-faint mb-1">2. Fill the blanks in the sentence above</p>
        <button onClick={checkBlanks} disabled={!allPlaced} className="text-xs px-3 py-1 rounded border border-shodo-mist disabled:opacity-40">Check blanks</button>
        {blankResults && (
          <ul className="text-sm mt-1 text-shodo-ink">
            {card.blanks.map((b, k) => (
              <li key={k}>{blankResults[k] ? "✓" : "✗"} blank {k + 1}: typed “{typed[k]}”, accepts {b.accept.map(a => `“${a}”`).join(" or ")}</li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-xs text-shodo-ink-faint mb-1">3. Or say the whole sentence</p>
        {speech.supported ? (
          <div className="flex gap-2 items-center">
            <button onClick={speech.isListening ? speech.stop : speech.start} className="text-xs px-3 py-1 rounded border border-shodo-mist">
              {speech.isListening ? "Stop" : "Speak"}
            </button>
            <button onClick={checkSpeech} disabled={speech.isListening} className="text-xs px-3 py-1 rounded border border-shodo-mist disabled:opacity-40">Check speech</button>
            <span className="text-sm text-shodo-ink-light">{speech.transcript}</span>
          </div>
        ) : (
          <p className="text-xs text-shodo-ink-faint">Speech recognition isn&apos;t available in this browser.</p>
        )}
        {speechResult && <p className="text-sm mt-1 text-shodo-ink">{speechResult}</p>}
      </div>
    </div>
  );
}
