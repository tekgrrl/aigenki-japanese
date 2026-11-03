"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface Props {
  scenarioId: string;
  /** The scenario's scene description (setting.visualPrompt): shown until a picture exists. */
  visualPrompt: string;
  /** setting.picture.file; changes when a new scene is drawn. */
  file?: string;
  /** Called after a drawing finishes, so the page can refetch the scenario. */
  onDrawn: () => void;
}

const POLL_MS = 3000;
const POLL_LIMIT_MS = 4 * 60 * 1000;

/**
 * The scenario's setting as a picture, drawn on request from its existing scene brief.
 * The image is per-user data, so it's fetched with auth and shown as a blob URL.
 */
export default function ScenePicture({
  scenarioId,
  visualPrompt,
  file,
  onDrawn,
}: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the image whenever the file changes.
  useEffect(() => {
    if (!file) return;
    let url: string | null = null;
    let cancelled = false;
    apiFetch(
      `/api/scenarios/${scenarioId}/picture?v=${encodeURIComponent(file)}`,
    )
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [scenarioId, file]);

  useEffect(
    () => () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    },
    [],
  );

  const poll = useCallback(
    (startedAt: number) => {
      pollRef.current = setTimeout(async () => {
        try {
          const res = await apiFetch(
            `/api/scenarios/${scenarioId}/picture/status`,
          );
          const status = (await res.json()) as {
            drawing: boolean;
            error?: string;
          };
          if (status.drawing && Date.now() - startedAt < POLL_LIMIT_MS)
            return poll(startedAt);
          setDrawing(false);
          if (status.error) setError(status.error);
          else if (status.drawing)
            setError("Still drawing: check back in a minute.");
          else onDrawn();
        } catch {
          setDrawing(false);
          setError("Couldn't check on the drawing.");
        }
      }, POLL_MS);
    },
    [scenarioId, onDrawn],
  );

  const draw = async () => {
    setError(null);
    setDrawing(true);
    const res = await apiFetch(`/api/scenarios/${scenarioId}/picture`, {
      method: "POST",
    });
    if (!res.ok) {
      setDrawing(false);
      setError(
        (await res.json().catch(() => null))?.message ??
          "Couldn't start drawing.",
      );
      return;
    }
    poll(Date.now());
  };

  return (
    <div className="mt-3 space-y-2">
      {src ? (
        // biome-ignore lint/performance/noImgElement: authenticated blob URL
        <img
          src={src}
          alt={visualPrompt}
          className="w-full rounded-lg border border-slate-200 aspect-video object-cover"
        />
      ) : (
        <p className="text-slate-500 italic text-xs border-l-2 border-slate-300 pl-2">
          Visual Context: {visualPrompt}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={draw}
          disabled={drawing}
          className="text-xs px-3 py-1.5 rounded-md bg-shodo-ink text-shodo-paper disabled:opacity-50"
        >
          {drawing
            ? "Drawing… (up to a minute)"
            : file
              ? "Redraw scene"
              : "Draw scene"}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
