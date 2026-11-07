"use client";

interface Props {
  submitLabel: string;
  submitType?: "button" | "submit";
  onSubmit?: () => void;
  submitDisabled?: boolean;
  /** "xl" matches the standard answer-input review card; "lg" matches sentence-assembly. */
  size?: "lg" | "xl";
  onSkip: () => void;
  skipDisabled?: boolean;
  onShowLesson?: () => void;
  showLesson?: boolean;
  isFetchingLesson?: boolean;
  /** The lesson was opened before answering: Submit is off and only Skip is left. */
  lessonPeeked?: boolean;
}

/**
 * The "Submit (full width) / Skip + Review Lesson (side by side)" button group
 * shared by every review card type. Extracted so the layout can't drift between
 * facet-specific cards again.
 */
export default function ReviewActionButtons({
  submitLabel,
  submitType = "button",
  onSubmit,
  submitDisabled,
  size = "lg",
  onSkip,
  skipDisabled,
  onShowLesson,
  showLesson,
  isFetchingLesson,
  lessonPeeked,
}: Props) {
  const submitSizeClasses = size === "xl" ? "py-4 text-xl" : "py-3 text-lg";

  return (
    <div>
      <button
        type={submitType}
        onClick={submitType === "button" ? onSubmit : undefined}
        disabled={submitDisabled || lessonPeeked}
        className={`w-full px-6 ${submitSizeClasses} bg-blue-600 text-white font-semibold rounded-md shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:bg-gray-500 ${lessonPeeked ? "opacity-50 disabled:cursor-not-allowed" : "disabled:cursor-wait"}`}
      >
        {lessonPeeked ? "Locked: lesson opened" : submitLabel}
      </button>
      {lessonPeeked && <LessonPeekedNote />}

      <SkipLessonRow
        className="mt-4"
        onSkip={onSkip}
        skipDisabled={skipDisabled}
        onShowLesson={onShowLesson}
        showLesson={showLesson}
        isFetchingLesson={isFetchingLesson}
      />
    </div>
  );
}

/** Shown under a disabled answer control once the lesson has been opened before answering. */
export function LessonPeekedNote({
  className = "text-gray-400",
}: {
  className?: string;
}) {
  return (
    <p className={`mt-2 text-sm text-center ${className}`}>
      You opened the lesson, so this one can&apos;t be answered now. Skip it and
      it&apos;ll come back next session.
    </p>
  );
}

interface SkipLessonRowProps {
  className?: string;
  onSkip: () => void;
  skipDisabled?: boolean;
  onShowLesson?: () => void;
  showLesson?: boolean;
  isFetchingLesson?: boolean;
}

/** Skip + Review Lesson side by side. Also used on its own by cards with no Submit (picture choice). */
export function SkipLessonRow({
  className = "",
  onSkip,
  skipDisabled,
  onShowLesson,
  showLesson,
  isFetchingLesson,
}: SkipLessonRowProps) {
  return (
    <div className={`flex gap-4 ${className}`}>
      <button
        type="button"
        onClick={onSkip}
        disabled={skipDisabled}
        className="flex-1 px-6 py-3 bg-gray-500 text-white text-lg font-semibold rounded-md shadow-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:bg-gray-800 disabled:text-gray-500"
      >
        Skip
      </button>
      {onShowLesson && (
        <button
          type="button"
          onClick={onShowLesson}
          disabled={isFetchingLesson}
          className="flex-1 px-6 py-3 bg-[#0A5C36] text-white text-lg font-semibold rounded-md shadow-md hover:bg-[#084a2b] focus:outline-none focus:ring-2 focus:ring-green-800 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:bg-gray-800 disabled:text-gray-500"
        >
          {isFetchingLesson
            ? "Loading..."
            : showLesson
              ? "Hide Lesson"
              : "Review Lesson"}
        </button>
      )}
    </div>
  );
}
