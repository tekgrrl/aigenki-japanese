import React from "react";
import { PartOfSpeech } from "@/types";

interface KuMetaTagsProps {
  partOfSpeech?: PartOfSpeech;
  conjugationType?: "godan" | "ichidan" | "irregular";
  jlptLevel?: string | null;
  wanikaniLevel?: number | null;
}

// ── Label maps ────────────────────────────────────────────────────────────────

const POS_LABELS: Partial<Record<PartOfSpeech, string>> = {
  "transitive-verb":   "Transitive Verb",
  "intransitive-verb": "Intransitive Verb",
  "auxiliary-verb":    "Auxiliary Verb",
  "i-adjective":       "い-adjective",
  "na-adjective":      "な-adjective",
  "noun":              "Noun",
  "noun-prenominal":   "Prenominal",
  "proper-noun":       "Proper Noun",
  "noun-suru":         "Suru Noun",
  "counter":           "Counter",
  "adverb":            "Adverb",
  "prefix":            "Prefix",
  "suffix":            "Suffix",
  "conjunction":       "Conjunction",
};

const CONJUGATION_LABELS: Record<string, string> = {
  godan:     "Godan (う-verb)",
  ichidan:   "Ichidan (る-verb)",
  irregular: "Irregular",
};

// ── Tag styling by category (static strings for Tailwind JIT) ────────────────

type TagVariant = "verb" | "adjective" | "noun" | "conjugation" | "jlpt" | "wanikani" | "default";

const TAG_CLASSES: Record<TagVariant, string> = {
  verb:        "bg-red-50 text-red-700 border border-red-200",
  adjective:   "bg-emerald-50 text-emerald-700 border border-emerald-200",
  noun:        "bg-sky-50 text-sky-800 border border-sky-200",
  conjugation: "bg-orange-50 text-orange-700 border border-orange-200",
  jlpt:        "bg-amber-50 text-amber-700 border border-amber-200",
  wanikani:    "bg-purple-50 text-purple-700 border border-purple-200",
  default:     "bg-stone-100 text-stone-600 border border-stone-200",
};

function posVariant(pos: PartOfSpeech): TagVariant {
  if (pos.includes("verb"))      return "verb";
  if (pos.includes("adjective")) return "adjective";
  if (pos.includes("noun") || pos === "counter") return "noun";
  return "default";
}

function normaliseJlpt(raw: string): string {
  const upper = raw.toUpperCase();
  return upper.startsWith("JLPT") ? upper : `JLPT ${upper}`;
}

// ── Tag primitive ─────────────────────────────────────────────────────────────

function Tag({ label, variant }: { label: string; variant: TagVariant }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold tracking-wide ${TAG_CLASSES[variant]}`}>
      {label}
    </span>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export default function KuMetaTags({
  partOfSpeech,
  conjugationType,
  jlptLevel,
  wanikaniLevel,
}: KuMetaTagsProps) {
  const tags: React.ReactNode[] = [];

  if (partOfSpeech) {
    tags.push(
      <Tag
        key="pos"
        label={POS_LABELS[partOfSpeech] ?? partOfSpeech}
        variant={posVariant(partOfSpeech)}
      />
    );
  }

  if (conjugationType) {
    tags.push(
      <Tag
        key="conj"
        label={CONJUGATION_LABELS[conjugationType] ?? conjugationType}
        variant="conjugation"
      />
    );
  }

  if (jlptLevel) {
    tags.push(
      <Tag key="jlpt" label={normaliseJlpt(jlptLevel)} variant="jlpt" />
    );
  }

  if (wanikaniLevel != null) {
    tags.push(
      <Tag key="wk" label={`WK ${wanikaniLevel}`} variant="wanikani" />
    );
  }

  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {tags}
    </div>
  );
}
