"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import * as wanakana from "wanakana";
import { ReviewFacet } from "@/types";
import InputModeBadge from "@/components/review/InputModeBadge";
import ReviewActionButtons from "@/components/review/ReviewActionButtons";

interface ClozeData {
  front: {
    sentenceWithBlank: string;
    hint: string;
  };
  back: {
    answer: string;
    fullSentence: string;
    accepted_alternatives?: string[];
  };
  goalTitle?: string;
}

interface Props {
  facet: ReviewFacet;
  onResult: (result: "pass" | "fail") => Promise<void>;
  onAdvance: () => void;
  onSkip: () => void;
  onShowLesson?: () => void;
  showLesson?: boolean;
  isFetchingLesson?: boolean;
  lessonPeeked?: boolean;
}

export default function SentenceClozeCard({ facet, onResult, onAdvance, onSkip, onShowLesson, showLesson, isFetchingLesson, lessonPeeked }: Props) {
  const { front, back, goalTitle } = facet.data as ClozeData;

  const [userAnswer, setUserAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (submitted) {
      setTimeout(() => nextButtonRef.current?.focus(), 50);
    }
  }, [submitted]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitted || isSubmitting || lessonPeeked) return;
    setIsSubmitting(true);

    const trimmed = userAnswer.trim();
    const allAnswers = [back.answer, ...(back.accepted_alternatives ?? [])];
    const correct = allAnswers.some(a => a.trim() === trimmed);

    setIsCorrect(correct);
    await onResult(correct ? "pass" : "fail");
    setSubmitted(true);
    setIsSubmitting(false);
  };

  const renderSentenceWithBlank = (sentence: string) => {
    const parts = sentence.split("[____]");
    if (parts.length === 1) return <span>{sentence}</span>;
    return (
      <>
        {parts[0]}
        <span className="inline-block border-b-2 border-blue-400 text-blue-400 px-1 mx-0.5 min-w-[4rem] text-center">
          {submitted ? back.answer : "＿＿＿"}
        </span>
        {parts[1]}
      </>
    );
  };

  return (
    <div className="bg-gray-800 shadow-2xl rounded-lg p-8 space-y-6">
      <div className="text-center">
        <p className="text-lg font-semibold text-blue-300 mb-1">Fill in the Blank</p>
        {goalTitle && <p className="text-sm text-gray-400">{goalTitle}</p>}
      </div>

      <div className="bg-gray-700 rounded-lg px-5 py-4 text-center space-y-2">
        <p className="text-2xl text-white font-medium leading-relaxed">
          {renderSentenceWithBlank(front.sentenceWithBlank)}
        </p>
        <p className="text-sm text-gray-400 italic">{front.hint}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex justify-end">
          <InputModeBadge mode="kana" />
        </div>
        <input
          key={facet.id}
          type="text"
          value={userAnswer}
          autoFocus
          onChange={e => setUserAnswer(wanakana.toKana(e.target.value, { IMEMode: true }))}
          placeholder="回答を入力して..."
          disabled={submitted || lessonPeeked}
          className={`w-full p-4 bg-gray-700 border-2 border-gray-600 text-white text-xl rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-800 disabled:text-gray-500 ${lessonPeeked ? "opacity-50 cursor-not-allowed" : ""}`}
        />

        {!submitted && (
          <ReviewActionButtons
            submitLabel={isSubmitting ? "Checking…" : "Submit"}
            submitType="submit"
            submitDisabled={userAnswer.trim() === "" || isSubmitting}
            onSkip={onSkip}
            skipDisabled={isSubmitting}
            onShowLesson={onShowLesson}
            showLesson={showLesson}
            isFetchingLesson={isFetchingLesson}
            lessonPeeked={lessonPeeked}
          />
        )}
      </form>

      {submitted && isCorrect !== null && (
        <div className={`rounded-lg p-5 space-y-3 ${isCorrect ? "bg-green-800" : "bg-red-800"}`}>
          <h3 className="text-xl font-semibold text-white">
            {isCorrect ? "Correct" : "Incorrect"}
          </h3>
          {!isCorrect && (
            <p className="text-gray-200">
              <span className="font-semibold">Answer: </span>
              <span className="text-white font-medium">{back.answer}</span>
            </p>
          )}
          <p className="text-gray-200">
            <span className="font-semibold">Full sentence: </span>
            <span className="text-white font-medium">{back.fullSentence}</span>
          </p>
          <button
            ref={nextButtonRef}
            onClick={onAdvance}
            className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
