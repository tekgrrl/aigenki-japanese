"use client";

/**
 * Journey planner: a list of Vocab or Grammar items for a phase. Pick from a corpus search
 * (/api/knowledge-units/browse) or paste lines; pasted lines are resolved to KUs by the backend
 * on save (a new Vocab word is created; an unknown Grammar line is refused).
 */
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

/** One item in the draft: `id` is the KU id once known; `text` is the word or Grammar pattern shown. */
export interface DraftItem {
  id?: string;
  text: string;
}

export function KuListField({ label, type, level, items, onChange, chipClass = "border-shodo-mist" }: {
  label: string;
  type: "Vocab" | "Grammar";
  /** JLPT level to search first (the Journey's). */
  level: string;
  items: DraftItem[];
  onChange: (items: DraftItem[]) => void;
  chipClass?: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; content: string; jlptLevel?: string }[]>([]);
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState("");

  useEffect(() => {
    const query = q.trim();
    if (!query) { setResults([]); return; }
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ q: query, type, pageSize: "12" });
      const res = await apiFetch(`/api/knowledge-units/browse?${params}`);
      if (!res.ok) return;
      const body = await res.json();
      setResults(body.items.map((k: { id: string; content: string; data?: { jlptLevel?: string } }) => ({ id: k.id, content: k.content, jlptLevel: k.data?.jlptLevel })));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, type]);

  const has = (it: DraftItem) => items.some(x => (it.id && x.id === it.id) || x.text === it.text);
  const add = (more: DraftItem[]) => onChange([...items, ...more.filter((m, i) => !has(m) && more.findIndex(x => x.text === m.text) === i)]);

  const addPasted = () => {
    add(paste.split("\n").map(l => l.trim()).filter(Boolean).map(text => ({ text })));
    setPaste("");
    setPasting(false);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-shodo-ink-light">{label} ({items.length})</span>
        <button onClick={() => setPasting(p => !p)} className="text-xs text-shodo-indigo">{pasting ? "Cancel" : "Paste lines"}</button>
      </div>
      <div className="flex flex-wrap gap-1">
        {items.map(it => (
          <span key={it.id ?? it.text} title={it.id ? undefined : "Resolved on save"} className={`flex items-center gap-1 rounded border px-2 py-0.5 text-sm text-shodo-ink ${chipClass} ${it.id ? "" : "border-dashed"}`}>
            {it.text}
            <button onClick={() => onChange(items.filter(x => x !== it))} className="text-xs text-shodo-ink-faint" title="Remove">×</button>
          </span>
        ))}
      </div>
      {pasting ? (
        <div className="space-y-1">
          <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={4} placeholder={type === "Vocab" ? "One word per line" : "One pattern or KU id per line"}
            className="w-full rounded border border-shodo-ink-faint/50 bg-shodo-paper-dark px-2 py-1 text-sm text-shodo-ink" />
          <button onClick={addPasted} className="text-xs rounded bg-shodo-ink px-2 py-0.5 text-shodo-paper">Add lines</button>
        </div>
      ) : (
        <div className="relative">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${type}…`}
            className="w-full rounded border border-shodo-ink-faint/50 bg-shodo-paper-dark px-2 py-0.5 text-sm text-shodo-ink" />
          {results.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded border border-shodo-mist bg-shodo-paper shadow">
              {[...results].sort((a, b) => Number(b.jlptLevel === level) - Number(a.jlptLevel === level)).map(r => (
                <li key={r.id}>
                  <button
                    onClick={() => { add([{ id: r.id, text: r.content }]); setQ(""); }}
                    disabled={has({ id: r.id, text: r.content })}
                    className="w-full px-2 py-1 text-left text-sm text-shodo-ink hover:bg-shodo-paper-dark disabled:opacity-40"
                  >
                    {r.content} <span className="text-xs text-shodo-ink-faint">{r.jlptLevel ?? ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
