/** A link to WaniKani's page for one kanji, opened in a new tab (for reinforcing kanji with WK). */
export default function WaniKaniLink({ kanji, className = "" }: { kanji: string; className?: string }) {
  return (
    <a
      href={`https://www.wanikani.com/kanji/${encodeURIComponent(kanji)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`underline underline-offset-2 ${className}`}
    >
      Open {kanji} on WaniKani ↗
    </a>
  );
}
