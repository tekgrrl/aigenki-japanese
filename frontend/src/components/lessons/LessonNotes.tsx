import type { ReactNode } from "react";

/**
 * Renders AI-generated lesson notes, which are mostly plain paragraphs but occasionally
 * use a small markdown subset: `#` headings, `-`/`*`/`•` and `1.` lists, **bold**,
 * *italic* / _italic_ and `code`. Deliberately tiny (no dependency, no HTML injection):
 * anything else is shown as plain text.
 */

const LIST_ITEM = /^\s*(?:[-*•]|\d+\.)\s+/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`)/g;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (/^(\*\*|__).+(\*\*|__)$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^`.+`$/.test(part)) return <code key={i} className="font-mono text-[0.95em]">{part.slice(1, -1)}</code>;
    if (/^[*_].+[*_]$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

interface Props {
  notes: string;
  /** Classes for paragraphs and list items (text size/colour). */
  className?: string;
  /** Classes for `#` headings. */
  headingClassName?: string;
}

export default function LessonNotes({ notes, className = "", headingClassName = "font-semibold text-shodo-ink" }: Props) {
  // Notes are sometimes stored with literal "\n" sequences.
  const lines = notes.replace(/\\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push(<p key={blocks.length} className={className}>{renderInline(para.join(" "))}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it, i) => <li key={i} className={className}>{renderInline(it)}</li>);
      blocks.push(
        list.ordered
          ? <ol key={blocks.length} className="list-decimal pl-6 space-y-1">{items}</ol>
          : <ul key={blocks.length} className="list-disc pl-6 space-y-1">{items}</ul>,
      );
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }

    const heading = line.match(HEADING);
    if (heading) {
      flushPara(); flushList();
      blocks.push(<h3 key={blocks.length} className={headingClassName}>{renderInline(heading[2])}</h3>);
      continue;
    }
    if (LIST_ITEM.test(line)) {
      flushPara();
      const ordered = /^\s*\d+\./.test(line);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push(line.replace(LIST_ITEM, ""));
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();

  return <>{blocks}</>;
}
