import React from "react";

interface FuriganaTextProps {
  text: string;
  /** Classes for the reading (rt), e.g. to keep it legible on a coloured background. */
  rtClassName?: string;
}

export const FuriganaText: React.FC<FuriganaTextProps> = ({ text, rtClassName = "text-xs text-gray-500 dark:text-gray-400" }) => {
  // Regex to find Kanji[Reading] pattern
  // Capture group 1: Kanji range
  // Capture group 2: Kana range (Hiragana/Katakana)
  // (々 repeats the previous kanji, e.g. 人々; ー appears in some readings.)
  const regex = /([\u4e00-\u9faf\u3005]+)\[([ぁ-んァ-ンー]+)\]/g;

  // split with capturing groups results in an array pattern:
  // [ "TextBefore", "Kanji", "Reading", "TextBetween", "Kanji", "Reading", "TextAfter" ]
  const parts = text.split(regex);

  return (
    <span>
      {parts.map((part: string, i: number) => {
        // 1. Normal Text (Index 0, 3, 6...)
        if (i % 3 === 0) {
          return <span key={i}>{part}</span>;
        }

        // 2. Kanji (Index 1, 4, 7...) - Render the Ruby container
        if (i % 3 === 1) {
          const reading = parts[i + 1]; // The next item is guaranteed to be the reading
          return (
            <ruby key={i} className="mx-0.5">
              {part}
              <rp>(</rp>
              <rt className={rtClassName}>
                {reading}
              </rt>
              <rp>)</rp>
            </ruby>
          );
        }

        // 3. Reading (Index 2, 5, 8...) - Already handled in the previous step
        return null;
      })}
    </span>
  );
};
