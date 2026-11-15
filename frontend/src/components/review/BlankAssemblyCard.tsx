"use client";

/**
 * Grammar review: a sentence assembly with blanks, built from the lesson's marked examples. The
 * learner orders the pieces (leaving decoys and spare blanks out) and types the blanks, then
 * submits once: a pass needs the order and every blank right. Saying the whole sentence also passes;
 * a spoken attempt that doesn't match isn't a fail (recognition is unreliable), the learner tries
 * again or builds it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as wanakana from "wanakana";
import { Volume2 } from "lucide-react";
import ReviewActionButtons from "./ReviewActionButtons";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { AssemblyCard, blankSlots, checkBlanks, checkOrder, sentenceMatches, typedPerBlank } from "@/lib/assembly-check";
import { LearnableTerm, useFragmentFlag } from "./FragmentFlag";
import type { Props as AssemblyProps } from "./SentenceAssemblyCard";

function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Outcome =
  | { pass: true; how: "built" | "spoken"; said?: string }
  | { pass: false; orderOk: boolean; joined: string; blankOk: boolean[]; typed: string[] };

export default function BlankAssemblyCard({
  card, learnableTerms, title, onResult, onAdvance, onSkip, onSpeak, onShowLesson, showLesson, isFetchingLesson, lessonPeeked,
}: AssemblyProps & {
  card: AssemblyCard;
  learnableTerms: LearnableTerm[];
  /** The Grammar point's English title, shown as the header (never the pattern: that's often the blank). */
  title: string;
}) {
  const [pool, setPool] = useState<number[]>(() => shuffled(card.pieces.length));
  const [placed, setPlaced] = useState<number[]>([]);
  // Typed text per blank chip, keyed by chip, so it moves with the chip when it's re-placed.
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const speech = useSpeechRecognition();
  const [unheard, setUnheard] = useState<string | null>(null);
  const flag = useFragmentFlag(learnableTerms);
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  const slots = useMemo(() => blankSlots(card, placed), [card, placed]);
  const done = outcome !== null;

  useEffect(() => {
    if (done) setTimeout(() => nextButtonRef.current?.focus(), 50);
  }, [done]);

  const place = (p: number) => {
    if (done || flag.swallowClick()) return;
    setPool(prev => prev.filter(x => x !== p));
    setPlaced(prev => [...prev, p]);
  };
  const unplace = (p: number) => {
    if (done) return;
    setPlaced(prev => prev.filter(x => x !== p));
    setPool(prev => [...prev, p]);
  };

  const finish = async (result: Outcome) => {
    setSubmitting(true);
    setOutcome(result);
    onSpeak?.(card.answer);
    await onResult(result.pass ? "pass" : "fail");
    setSubmitting(false);
  };

  const submit = async () => {
    if (done || submitting || lessonPeeked || placed.length === 0) return;
    const order = checkOrder(card, placed);
    const blankOk = checkBlanks(card, placed, typed);
    if (order.ok && blankOk.every(Boolean)) return finish({ pass: true, how: "built" });
    return finish({ pass: false, orderOk: order.ok, joined: order.joined, blankOk, typed: typedPerBlank(card, placed, typed) });
  };

  const submitSpeech = async () => {
    if (done || submitting || lessonPeeked) return;
    if (speech.isListening) speech.stop();
    const said = speech.transcript;
    if (sentenceMatches(card, said)) return finish({ pass: true, how: "spoken", said });
    setUnheard(said);
  };

  const hasDecoys = card.pieces.some(p => p.distractor);

  return (
    <div className="bg-gray-800 shadow-2xl rounded-lg p-8 space-y-6">
      <div className="text-center">
        <p className="text-lg font-semibold text-blue-300 mb-1">Sentence Structure</p>
        {title && <p className="text-sm text-gray-400">{title}</p>}
      </div>

      <div className="bg-gray-700 rounded-lg px-5 py-4 text-center space-y-2">
        <p className="text-xs uppercase tracking-widest text-gray-400">Translate</p>
        <p className="text-xl text-white font-medium">{card.english}</p>
        {card.hints.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {card.hints.map((h, i) => <span key={i} className="text-xs px-2 py-0.5 rounded-full border border-blue-300 text-blue-200">{h}</span>)}
          </div>
        )}
      </div>

      <div>
        <p className="text-xs uppercase tracking-widest text-gray-400 mb-2">Your answer</p>
        <div className="min-h-[52px] flex flex-wrap items-center gap-2 p-3 bg-gray-900 rounded-lg border-2 border-gray-600">
          {placed.length === 0 && <p className="text-gray-600 text-sm">Tap pieces below to build the sentence, then type the blanks…</p>}
          {placed.map(p => {
            const k = slots.get(p);
            if (k === undefined) {
              return (
                <button key={p} onClick={() => unplace(p)} disabled={done} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-base rounded-md font-medium disabled:cursor-default">
                  {card.pieces[p].text}
                </button>
              );
            }
            const wrong = outcome && !outcome.pass && outcome.orderOk && outcome.blankOk[k] === false;
            return (
              <span key={p} className="flex items-center gap-1">
                <input
                  value={typed[p] ?? ""}
                  onChange={e => { const v = wanakana.toKana(e.target.value, { IMEMode: true }); setTyped(prev => ({ ...prev, [p]: v })); }}
                  onKeyDown={e => { if (e.key === "Enter") void submit(); }}
                  disabled={done}
                  placeholder="＿＿"
                  className={`w-24 rounded-md border-2 bg-gray-800 px-2 py-1 text-base text-white ${wrong ? "border-red-400" : "border-dashed border-blue-400"}`}
                />
                {!done && <button onClick={() => unplace(p)} title="Remove" className="text-xs text-gray-500 hover:text-gray-300">×</button>}
              </span>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-widest text-gray-400 mb-2">Pieces{hasDecoys ? " (some don't belong)" : ""}</p>
        <div className="flex flex-wrap gap-2">
          {pool.map(p => {
            const text = card.pieces[p].text;
            return (
              <button
                key={p}
                onClick={() => place(p)}
                {...(text ? flag.pressHandlers(text) : {})}
                disabled={done}
                className={`px-3 py-1.5 text-base rounded-md font-medium select-none disabled:opacity-40 ${text === null ? "border-2 border-dashed border-gray-400 text-gray-300" : "bg-gray-600 hover:bg-gray-500 text-white"}`}
              >
                {text ?? "＿＿"}
              </button>
            );
          })}
        </div>
      </div>

      {flag.panel}

      {!done && speech.supported && (
        <div className="flex items-center gap-3 text-sm">
          <button onClick={speech.isListening ? speech.stop : () => { setUnheard(null); speech.start(); }} disabled={lessonPeeked} className="px-3 py-1.5 rounded-md border border-gray-500 text-gray-200 hover:bg-gray-700 disabled:opacity-40">
            {speech.isListening ? "Stop" : "Or say it"}
          </button>
          {speech.transcript && (
            <>
              <span className="text-gray-300">{speech.transcript}</span>
              <button onClick={submitSpeech} disabled={speech.isListening || submitting || lessonPeeked} className="px-3 py-1.5 rounded-md bg-gray-600 text-white hover:bg-gray-500 disabled:opacity-40">
                Submit what I said
              </button>
            </>
          )}
          {unheard !== null && <span className="text-amber-300">That didn&apos;t match. Try again, or build it above.</span>}
        </div>
      )}

      {!done && (
        <ReviewActionButtons
          submitLabel={submitting ? "Checking…" : "Submit"}
          onSubmit={submit}
          submitDisabled={placed.length === 0 || submitting}
          onSkip={onSkip}
          onShowLesson={onShowLesson}
          showLesson={showLesson}
          isFetchingLesson={isFetchingLesson}
          lessonPeeked={lessonPeeked}
        />
      )}

      {outcome && (
        <div className={`rounded-lg p-5 space-y-3 ${outcome.pass ? "bg-green-800" : "bg-red-800"}`}>
          <h3 className="text-xl font-semibold text-white">{outcome.pass ? "Correct" : "Incorrect"}</h3>
          {outcome.pass && outcome.how === "spoken" && <p className="text-gray-200">Heard: <span className="text-white font-medium">{outcome.said}</span></p>}
          {!outcome.pass && (
            outcome.orderOk ? (
              <ul className="text-gray-200 text-sm space-y-1">
                {card.blanks.map((b, k) => !outcome.blankOk[k] && (
                  <li key={k}>Blank {k + 1}: you typed “{outcome.typed[k] || "(nothing)"}”, it should be {b.accept.map(a => `“${a}”`).join(" or ")}</li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-200 text-sm">Your answer: <span className="text-white">{outcome.joined}</span></p>
            )
          )}
          <p className="text-gray-200 flex items-center flex-wrap gap-x-2">
            <span className="font-semibold">{outcome.pass ? "Sentence:" : "Correct answer:"}</span>
            <span className="text-white font-medium">{card.answer}</span>
            {onSpeak && (
              <button type="button" onClick={() => onSpeak(card.answer)} title="Replay audio" aria-label="Replay audio" className="p-1.5 rounded-full text-gray-200 hover:text-white hover:bg-white/10">
                <Volume2 className="w-5 h-5" />
              </button>
            )}
          </p>
          {!outcome.pass && onShowLesson && (
            <button type="button" onClick={onShowLesson} disabled={isFetchingLesson} className="inline-block px-4 py-2 bg-[#0A5C36] text-white font-semibold rounded-md hover:bg-[#084a2b] disabled:opacity-50">
              {isFetchingLesson ? "Loading..." : showLesson ? "Hide Lesson" : "Review Lesson"}
            </button>
          )}
          <button ref={nextButtonRef} onClick={onAdvance} className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
