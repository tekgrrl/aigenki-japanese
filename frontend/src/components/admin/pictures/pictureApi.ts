import { apiFetch } from "@/lib/api-client";
import type {
  PictureBrief,
  PictureSubject,
  PictureSubjectKind,
  UsageStates,
} from "@/types";

export type { PictureBrief, PictureSubject, UsageStates };
export type SubjectKind = PictureSubjectKind;

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

/** A KU search hit, as the Add a Picture search lists it. */
export interface KuHit {
  id: string;
  content: string;
  type: string;
  reading?: string;
  meaning?: string;
}

/**
 * KUs matching a KU id or content, never Kanji (pictures don't attach to Kanji). An id
 * that search doesn't match is looked up directly.
 */
export async function searchKus(query: string): Promise<KuHit[]> {
  const q = query.trim();
  if (!q) return [];
  const res = await apiFetch(
    `/api/knowledge-units/search?${new URLSearchParams({ q, excludeType: "Kanji" })}`,
  );
  const raw = res.ok
    ? ((await res.json()) as {
        id: string;
        content: string;
        type: string;
        data?: { reading?: string; definition?: string; title?: string };
      }[])
    : [];
  // Kanji are excluded server-side, before the result cap.
  let hits = raw;
  if (!hits.some((k) => k.id === q) && /^(wk-\d+|[A-Za-z0-9]{20})$/.test(q)) {
    const one = await apiFetch(`/api/knowledge-units/${q}/global`);
    if (one.ok) {
      const k = (await one.json()) as (typeof raw)[number];
      if (k.type !== "Kanji") hits = [k, ...hits];
    }
  }
  // Exact matches first, then the rest as search returned them.
  hits.sort((a, b) => Number(b.content === q || b.id === q) - Number(a.content === q || a.id === q));
  return hits.map((k) => ({
    id: k.id,
    content: k.content,
    type: k.type,
    reading: k.data?.reading,
    meaning: k.data?.definition ?? k.data?.title,
  }));
}

/** A Vocab word's usages and where each stands (no picture / waiting / bound). */
export function fetchUsageStates(kuId: string): Promise<UsageStates> {
  return sendJsonGet<UsageStates>(
    `/api/pictures/admin/usages?${new URLSearchParams({ kuId })}`,
  );
}

async function sendJsonGet<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  if (!res.ok)
    throw new Error(
      (await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`,
    );
  return (await res.json()) as T;
}
