import { apiFetch } from "@/lib/api-client";

export type SubjectKind = "ku-usage" | "ku" | "none";
export interface PictureSubject {
  kind: SubjectKind;
  kuId?: string;
  usage?: string;
}
export interface PictureBrief {
  picturable: boolean;
  includeCast: boolean;
  background: string;
  scene: string;
}

export const SUBJECT_LABEL: Record<SubjectKind, string> = {
  "ku-usage": "A usage of a word",
  ku: "A whole KU (not Kanji; not shown to learners yet)",
  none: "Free-standing (no KU yet)",
};

/**
 * A word or KU id → KU id. Words are matched exactly via KU search (Vocab only unless
 * `anyType`); 20-char Firestore ids and wk-NNN ids pass through (Concept ids too, which
 * search doesn't cover).
 */
export async function resolveKuId(
  line: string,
  anyType = false,
): Promise<string | null> {
  const q = line.trim();
  if (!q) return null;
  const params = new URLSearchParams({ q });
  if (!anyType) params.set("type", "Vocab");
  const res = await apiFetch(`/api/knowledge-units/search?${params}`);
  const hits = res.ok
    ? ((await res.json()) as { id: string; content: string; type: string }[])
    : [];
  // Pictures never attach to a Kanji, and words like 川 share content with their Kanji KU.
  const match = hits.find(
    (k) => k.type !== "Kanji" && (k.content === q || k.id === q),
  );
  if (match) return match.id;
  return /^(wk-\d+|[A-Za-z0-9]{20})$/.test(q) ? q : null;
}

/** Build a subject from the form fields; throws a readable message if the word isn't found. */
export async function buildSubject(
  kind: SubjectKind,
  word: string,
  usage: string,
): Promise<PictureSubject> {
  if (kind === "none") return { kind };
  const kuId = await resolveKuId(word, kind === "ku");
  if (!kuId)
    throw new Error(`No ${kind === "ku" ? "KU" : "Vocab"} found for "${word}"`);
  return kind === "ku-usage"
    ? { kind, kuId, usage: usage.trim() || undefined }
    : { kind, kuId };
}

/** POST/PATCH JSON; throws the backend's message on failure. */
export async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<T> {
  const res = await apiFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(
      (await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`,
    );
  return (await res.json()) as T;
}
