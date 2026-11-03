"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface Word {
  kuId: string;
  content: string;
  meaning: string;
}

interface Props {
  kanji: string;
  /** The word whose sequence this review belongs to; listed first. */
  fromKuId?: string;
}

/**
 * Up to three words using a kanji, shown on its review so it's clear why the kanji is
 * there: the word that introduced it first, then the user's other words, then common ones.
 */
export default function KanjiWordsLine({ kanji, fromKuId }: Props) {
  const [words, setWords] = useState<Word[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ char: kanji });
    if (fromKuId) params.set("from", fromKuId);
    apiFetch(`/api/kanji/words?${params}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Word[]) => setWords(data))
      .catch((err) => {
        if ((err as Error).name !== "AbortError") console.error("[KanjiWordsLine]", err);
      });
    return () => controller.abort();
  }, [kanji, fromKuId]);

  if (!words?.length) return null;
  return (
    <div className="mt-4 flex justify-center gap-8">
      {words.map((w) => (
        <div key={w.kuId} className="flex flex-col items-center">
          <span className="text-lg font-semibold text-white">{w.content}</span>
          {w.meaning && <span className="text-sm text-gray-400">{w.meaning}</span>}
        </div>
      ))}
    </div>
  );
}
