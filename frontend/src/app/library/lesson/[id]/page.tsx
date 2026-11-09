import Link from "next/link";
import { notFound } from "next/navigation";
import { contentService } from "@/lib/content-service";
import {
  parseVocabLessonBody,
  parseKanjiLessonBody,
} from "@/lib/markdown-parser";
import LessonSlideStack from "@/components/learn/LessonSlideStack";
import { VocabLesson, KanjiLesson } from "@/types";

export default async function LibraryLessonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);

  const lessonContent = await contentService.getLesson(decodedId);

  if (!lessonContent) {
    notFound();
  }

  // Fetch parent topic to know type
  const topic = await contentService.getTopic(lessonContent.topicId);
  const type = topic?.type || "Vocab"; // Default to Vocab if unknown

  let parsedLesson: VocabLesson | KanjiLesson | null = null;

  if (type === "Vocab") {
    const partial = parseVocabLessonBody(lessonContent.body);

    // Merge in definition from topic if available and not in lesson
    if (
      topic?.definition &&
      (!partial.definitions || partial.definitions.length === 0)
    ) {
      partial.definitions = [topic.definition];
    }

    // Hydrate with metadata from topic/lesson
    parsedLesson = {
      ...partial,
      vocab: topic?.content || lessonContent.topicId, // Fallback
      // Ensure mandatory fields from Partial are handled or defaulted if necessary
      type: "Vocab",
      definitions: partial.definitions || [],
      meaning_explanation: partial.meaning_explanation || "",
      reading_explanation: partial.reading_explanation || "",
      partOfSpeech: (topic?.partOfSpeech as any) || "noun", // fallback cast
    } as VocabLesson;
  } else if (type === "Kanji") {
    const partial = parseKanjiLessonBody(lessonContent.body);
    parsedLesson = {
      ...partial,
      kanji: topic?.content || lessonContent.topicId,
      type: "Kanji",
      meaning: partial.meaning || "",
      onyomi: partial.onyomi || [],
      kunyomi: partial.kunyomi || [],
      // Radicals/Strokes might be missing from simple markdown, handle gracefully in View or default here
      strokeCount: 0,
      strokeImages: [],
      mnemonic_meaning: partial.mnemonic_meaning || "",
      mnemonic_reading: partial.mnemonic_reading || "",
    } as KanjiLesson;
  }

  return (
    <main className="container mx-auto max-w-4xl p-8">
      {/* --- Header / Breadcrumbs --- */}
      <header className="mb-8 border-b border-shodo-ink/10 pb-6">
        <div className="flex flex-col gap-2">
          <Link
            href={topic ? `/library/${topic.id}` : "/library"}
            className="text-sm text-shodo-indigo hover:text-shodo-indigo-dark hover:underline mb-2 block"
          >
            &larr; Back to {topic ? topic.content : "Library"}
          </Link>

          <h1 className="text-6xl font-bold text-shodo-ink mt-4 mb-2">
            {lessonContent.content || lessonContent.topicId}
          </h1>
          {lessonContent.partOfSpeech && (
            <p className="text-2xl text-gray-500 dark:text-gray-400 capitalize">
              {lessonContent.partOfSpeech}
            </p>
          )}
        </div>
      </header>

      {/* --- Lesson Body --- */}
      <article>
        {parsedLesson && (
          <LessonSlideStack
            loaded={{
              item: { kuId: decodedId, content: lessonContent.content || lessonContent.topicId, type },
              lesson: parsedLesson,
            }}
          />
        )}

        {!parsedLesson && (
          <div className="whitespace-pre-wrap font-serif text-lg leading-relaxed text-shodo-ink">
            {lessonContent.body}
          </div>
        )}
      </article>
    </main>
  );
}
