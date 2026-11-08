import React from "react";
import { VocabLesson } from "@/types";
import { FuriganaText } from "@/components/FuriganaText";
import RevealableText from "@/components/RevealableText";
import EditableSection from "./EditableSection";
import VocabUsageList, { hasUsages } from "./VocabUsageList";

interface VocabLessonViewProps {
  lesson: VocabLesson;
  onSaveSection?: (sectionKey: string, newContent: string) => Promise<void>;
  readOnly?: boolean;
  hideContext?: boolean;
  hideComponentKanji?: boolean;
}

export default function VocabLessonView({
  lesson,
  onSaveSection,
  readOnly = false,
  hideContext = false,
  hideComponentKanji = false,
}: VocabLessonViewProps) {
  return (
    <>
      {/* --- Meaning Section --- */}
      <EditableSection
        title="Meaning"
        content={lesson.meaning_explanation}
        sectionKey="meaning_explanation"
        onSave={onSaveSection}
        readOnly={readOnly}
      />

      {/* Usages (what the meaning card tests), or the definitions for lessons without them */}
      <div className="bg-shodo-paper-dark p-6 rounded-lg shadow-lg mb-8 border border-shodo-ink/5">
        <h2 className="text-2xl font-semibold mb-4 text-shodo-ink">
          {hasUsages(lesson) ? "Meanings" : "Definitions"}
        </h2>
        <VocabUsageList lesson={lesson} />
      </div>

      {/* --- Reading Section --- */}
      <EditableSection
        title="Reading"
        content={lesson.reading_explanation}
        sectionKey="reading_explanation"
        onSave={onSaveSection}
        readOnly={readOnly}
      />

      {/* --- Context Examples --- */}
      {!hideContext && (
        <div className="bg-shodo-paper-dark p-6 rounded-lg shadow-lg mb-8 border border-shodo-ink/5">
          <h2 className="text-2xl font-semibold mb-4 text-shodo-ink">
            Context Examples
          </h2>
          <ul className="space-y-4">
            {lesson.context_examples && lesson.context_examples.length > 0 ? (
              lesson.context_examples.map((ex, i) => (
                <li
                  key={i}
                  className="p-4 bg-shodo-paper-warm rounded-md"
                >
                  {/* Japanese Sentence with Furigana */}
                  <p className="text-2xl text-shodo-ink mb-2">
                    <FuriganaText text={ex.sentence} />
                  </p>

                  {/* English Translation (Revealable) */}
                  <p className="text-md leading-relaxed">
                    <RevealableText text={ex.translation} />
                  </p>
                </li>
              ))
            ) : (
              <p className="text-shodo-ink-faint italic">
                No context examples provided.
              </p>
            )}
          </ul>
        </div>
      )}

      {/* --- Component Kanji --- */}
      {!hideComponentKanji && (
        <div className="bg-shodo-paper-dark p-6 rounded-lg shadow-lg mb-8 border border-shodo-ink/5">
          <h2 className="text-2xl font-semibold mb-4 text-shodo-ink">
            Component Kanji
          </h2>
          <ul className="space-y-2">
            {lesson.component_kanji && lesson.component_kanji.length > 0 ? (
              lesson.component_kanji.map((k, i) => (
                <li
                  key={`${k.kanji}-${i}`}
                  className="flex items-center space-x-4 p-3 bg-shodo-paper-warm rounded-md"
                >
                  <span className="text-3xl text-shodo-ink">
                    {k.kanji}
                  </span>
                  <div>
                    <p className="text-lg text-shodo-ink-light">
                      {k.reading}
                    </p>
                    <p className="text-md text-shodo-ink-light">
                      {k.meaning}
                    </p>
                  </div>
                </li>
              ))
            ) : (
              <p className="text-shodo-ink-faint italic">
                No component kanji provided.
              </p>
            )}
          </ul>
        </div>
      )}
    </>
  );
}
