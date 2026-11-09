import { apiFetch } from "@/lib/api-client";

/** A picture card image (audio-first vocab). `file` versions the URL so a redraw isn't cached. */
export interface PictureRef {
  id: string;
  file: string;
  usage?: string;
  kuId?: string;
}

export const pictureUrl = (p: PictureRef) => `/api/pictures/${p.id}/image?v=${encodeURIComponent(p.file)}`;

/** Approved usage pictures for a word (empty on any failure: pictures are optional). Whole-KU pictures aren't audio-first cards. */
export async function fetchApprovedPictures(kuId: string): Promise<PictureRef[]> {
  try {
    const res = await apiFetch(`/api/pictures?kuId=${encodeURIComponent(kuId)}&kind=ku-usage`);
    if (!res.ok) return [];
    const pics = (await res.json()) as PictureRef[];
    return pics.filter((p) => p.file);
  } catch {
    return [];
  }
}

/**
 * The pictures to teach a word with, if it's audio-first for this learner (one of its cards is a
 * picture card), else []. The one rule the lesson page and the Review Lesson panel share, so a word
 * looks the same in both. Pass `facets` if they're already loaded.
 */
export async function audioFirstPictures(kuId: string, facets?: { facetType: string }[]): Promise<PictureRef[]> {
  let cards = facets;
  if (!cards) {
    try {
      const res = await apiFetch(`/api/reviews/facets?kuId=${encodeURIComponent(kuId)}`);
      cards = res.ok ? await res.json() : [];
    } catch {
      cards = [];
    }
  }
  return Array.isArray(cards) && cards.some((f) => f.facetType === "picture-choice") ? fetchApprovedPictures(kuId) : [];
}

/** Distractor pictures (other words) for the four-picture choice card. */
export async function fetchChoices(kuId: string, n = 3): Promise<PictureRef[]> {
  try {
    const res = await apiFetch(`/api/pictures/choices?kuId=${encodeURIComponent(kuId)}&n=${n}`);
    return res.ok ? ((await res.json()) as PictureRef[]) : [];
  } catch {
    return [];
  }
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
