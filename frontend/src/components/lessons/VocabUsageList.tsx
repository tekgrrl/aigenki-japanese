import type { VocabLesson } from "@/types";

/**
 * A Vocab word's meanings as the meaning card tests them: one line per usage (its meaning,
 * plus its label when that says more), then any definitions no usage covers. Lessons whose
 * usages haven't been built show their definitions, as before.
 */
export function hasUsages(lesson: VocabLesson): boolean {
  return (lesson.usages?.length ?? 0) > 0;
}

export default function VocabUsageList({ lesson }: { lesson: VocabLesson }) {
  if (!hasUsages(lesson)) {
    const defs = lesson.definitions?.length ? lesson.definitions : lesson.definition ? [lesson.definition] : [];
    if (defs.length === 0) return <p className="text-shodo-ink-faint italic">No definitions available.</p>;
    return (
      <ul className="space-y-2">
        {defs.map((d, i) => (
          <li key={i} className="flex items-start gap-3 text-lg text-shodo-ink-light">
            <span className="text-shodo-ink-faint text-sm mt-1 w-5 shrink-0">{i + 1}.</span>
            {d}
          </li>
        ))}
      </ul>
    );
  }
  const usages = lesson.usages!;
  const also = lesson.usageSetAside ?? [];
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {usages.map((u, i) => (
          <li key={u.id} className="flex items-start gap-3 text-lg text-shodo-ink-light">
            <span className="text-shodo-ink-faint text-sm mt-1 w-5 shrink-0">{i + 1}.</span>
            <span>
              <span className="font-semibold text-shodo-ink">{u.meaning}</span>
              {u.label && u.label.toLowerCase() !== u.meaning.toLowerCase() && (
                <span className="text-shodo-ink-faint"> · {u.label}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {usages.length > 1 && (
        <p className="text-sm text-shodo-ink-faint">Reviews ask for each of these meanings before the word moves up.</p>
      )}
      {also.length > 0 && <p className="text-sm text-shodo-ink-faint">Also: {also.join("; ")}</p>}
    </div>
  );
}
