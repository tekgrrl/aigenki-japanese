import { apiFetch } from "@/lib/api-client";

/** A picture card image (audio-first vocab). `file` versions the URL so a redraw isn't cached. */
export interface PictureRef {
  id: string;
  file: string;
  usage?: string;
  kuId?: string;
}

export const pictureUrl = (p: PictureRef) => `/api/pictures/${p.id}/image?v=${encodeURIComponent(p.file)}`;

/** Approved pictures for a word (empty on any failure: pictures are optional). */
export async function fetchApprovedPictures(kuId: string): Promise<PictureRef[]> {
  try {
    const res = await apiFetch(`/api/pictures?kuId=${encodeURIComponent(kuId)}`);
    if (!res.ok) return [];
    const pics = (await res.json()) as PictureRef[];
    return pics.filter((p) => p.file);
  } catch {
    return [];
  }
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
