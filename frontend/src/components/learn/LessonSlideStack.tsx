"use client";

import { LoadedItem, renderSlide, slideCount, TYPE_COLORS, useLessonAudio } from "@/components/learn/LessonSlides";

/**
 * A lesson as its slides, all on one page (stacked cards you scroll through). Nothing plays by
 * itself here (every slide opens at once); the learner taps the play buttons. The same slides
 * Start Learning shows one at a time; used wherever a lesson is shown outside that slideshow:
 * the lesson page, the Review Lesson panel and the library lesson page.
 */
export default function LessonSlideStack({ loaded }: { loaded: LoadedItem }) {
  const { audioRef, playAudio } = useLessonAudio();
  const typeColor = TYPE_COLORS[loaded.item.type] ?? "var(--shodo-ink-light)";
  const count = slideCount(loaded);

  return (
    <div className="space-y-4">
      <audio ref={audioRef} />
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border p-6 sm:p-8"
          style={{
            backgroundColor: `color-mix(in srgb, ${typeColor} 5%, transparent)`,
            borderColor: `color-mix(in srgb, ${typeColor} 20%, transparent)`,
          }}
        >
          {renderSlide(loaded, i, playAudio, { autoPlay: false })}
        </div>
      ))}
    </div>
  );
}
