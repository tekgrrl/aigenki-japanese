"use client";

import type { PictureBrief } from "./pictureApi";

interface Props {
  brief: PictureBrief;
  onChange: (brief: PictureBrief) => void;
  compact?: boolean;
}

/**
 * Edit a picture brief: scene, background and whether the cast appears. Editing the
 * scene overrides an "unpicturable" judgement.
 */
export default function BriefEditor({ brief, onChange, compact }: Props) {
  const input = `rounded border border-shodo-ink/15 bg-shodo-paper ${compact ? "p-1.5 text-xs" : "p-2 text-sm"}`;
  const patch = (p: Partial<PictureBrief>) => onChange({ ...brief, ...p });
  return (
    <div className="space-y-2">
      {!brief.picturable && (
        <p className="text-xs text-shodo-persimmon">
          Judged unpicturable{brief.reason ? `: ${brief.reason}` : ""}. Edit the scene to override.
        </p>
      )}
      <textarea
        aria-label="Scene"
        value={brief.scene}
        onChange={(e) => patch({ scene: e.target.value, picturable: true })}
        rows={3}
        placeholder="What the picture shows"
        className={`${input} w-full`}
      />
      <label className="flex items-center gap-2">
        <span className={`font-semibold text-shodo-ink-light ${compact ? "text-xs" : "text-sm"}`}>Background</span>
        <input
          value={brief.background}
          onChange={(e) => patch({ background: e.target.value })}
          placeholder="e.g. a quiet classroom (empty = plain card)"
          className={`${input} flex-1`}
        />
      </label>
      <label className={`flex items-center gap-2 text-shodo-ink-light ${compact ? "text-xs" : "text-sm"}`}>
        <input
          type="checkbox"
          checked={brief.includeCast}
          onChange={(e) => patch({ includeCast: e.target.checked })}
        />
        Fude / Suzuri in the scene
      </label>
    </div>
  );
}
