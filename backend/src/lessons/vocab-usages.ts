import { createHash, randomBytes } from 'crypto';
import { usageKey } from '../pictures/pictures.service';
import type { VocabLesson, VocabUsage } from '../types';

/** The id of the single synthetic usage a lesson has before its usages are built. */
export const DEFAULT_USAGE_ID = 'default';

/** Short glosses from definitions: "to spend (time, money)" → "to spend"; "dark, gloomy" → "dark", "gloomy". */
export function glossesOf(definitions: string[]): string[] {
  const glosses = definitions
    // Drop parenthetical detail before splitting, so a comma inside the parens isn't split on.
    .map(d => d.replace(/\([^)]*\)/g, '').replace(/（[^）]*）/g, '').trim())
    .flatMap(d => d.split(/[,;]/))
    .map(d => d.trim())
    .filter(d => d.length > 0);
  return dedupe(glosses);
}

/**
 * A lesson's usages: the built ones, or (until they're built) one usage that accepts every
 * definition, which is how meaning answers were checked before usages existed.
 */
export function usagesOf(lesson: Pick<VocabLesson, 'usages' | 'definitions'>): VocabUsage[] {
  if (lesson.usages && lesson.usages.length > 0) return lesson.usages;
  const [meaning, ...rest] = glossesOf(lesson.definitions ?? []);
  if (!meaning) return [];
  return [{ id: DEFAULT_USAGE_ID, label: '', meaning, acceptedAnswers: rest }];
}

export function newUsageId(): string {
  return randomBytes(4).toString('hex');
}

/** What the usage-building prompt returns, once checked. */
export interface BuiltUsages {
  usages: { label: string; meaning: string; acceptedAnswers: string[] }[];
  /** Per example, the index into `usages` of the usage it shows. */
  exampleUsages: number[];
  setAside: string[];
}

/**
 * Checks the prompt's output and normalises it. Throws on anything that would corrupt the
 * lesson: wrong example count, a bad index, a usage no example shows, or a fixed label that
 * was renamed, merged or split (pictures match usages by label).
 */
export function checkBuiltUsages(raw: unknown, exampleCount: number, fixedLabels: (string | null)[]): BuiltUsages {
  const r = raw as Partial<BuiltUsages> | null;
  if (!r || !Array.isArray(r.usages) || !Array.isArray(r.exampleUsages)) {
    throw new Error('Missing usages or exampleUsages');
  }
  if (r.exampleUsages.length !== exampleCount) {
    throw new Error(`Expected ${exampleCount} exampleUsages, got ${r.exampleUsages.length}`);
  }

  const usages = r.usages.map((u, i) => {
    const label = typeof u?.label === 'string' ? u.label.trim() : '';
    const meaning = typeof u?.meaning === 'string' ? u.meaning.trim() : '';
    if (!label || !meaning) throw new Error(`Usage ${i} has no label or meaning`);
    const others = Array.isArray(u.acceptedAnswers) ? u.acceptedAnswers.filter((a): a is string => typeof a === 'string') : [];
    const acceptedAnswers = dedupe(others.map(a => a.trim()).filter(a => a && a.toLowerCase() !== meaning.toLowerCase()));
    return { label, meaning, acceptedAnswers };
  });

  // A gloss must identify one usage. The prompt is told so, but doesn't always comply
  // (入る: "to enter" under both entering and joining). A gloss that is another usage's
  // meaning, or was already accepted by an earlier usage, is dropped.
  const meanings = usages.map(u => u.meaning.toLowerCase());
  const claimed = new Set<string>();
  for (const [i, u] of usages.entries()) {
    u.acceptedAnswers = u.acceptedAnswers.filter(a => {
      const k = a.toLowerCase();
      if (claimed.has(k) || meanings.some((m, j) => j !== i && m === k)) return false;
      claimed.add(k);
      return true;
    });
  }
  if (new Set(meanings).size !== meanings.length) throw new Error('Two usages share a meaning');

  const labelKeys = usages.map(u => usageKey(u.label));
  if (new Set(labelKeys).size !== labelKeys.length) throw new Error('Two usages share a label');

  r.exampleUsages.forEach((idx, i) => {
    if (!Number.isInteger(idx) || idx < 0 || idx >= usages.length) throw new Error(`Example ${i + 1} has a bad usage index ${idx}`);
    const fixed = fixedLabels[i];
    if (fixed && usages[idx].label !== fixed.trim()) {
      throw new Error(`Example ${i + 1}'s fixed label "${fixed}" became "${usages[idx].label}"`);
    }
  });
  usages.forEach((u, i) => {
    if (!r.exampleUsages!.includes(i)) throw new Error(`Usage "${u.label}" is shown by no example`);
  });

  const setAside = Array.isArray(r.setAside) ? r.setAside.filter((d): d is string => typeof d === 'string' && !!d.trim()).map(d => d.trim()) : [];
  return { usages, exampleUsages: r.exampleUsages, setAside };
}

/** Gives each built usage an id, keeping the id of an existing usage with the same label. */
export function withUsageIds(built: BuiltUsages['usages'], previous: VocabUsage[] | undefined): VocabUsage[] {
  const byLabel = new Map((previous ?? []).map(u => [usageKey(u.label), u.id]));
  return built.map(u => ({ id: byLabel.get(usageKey(u.label)) ?? newUsageId(), ...u }));
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter(i => {
    const k = i.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Prompt rule 7, enforced: a definition none of whose glosses ended up in a usage (as its
 * meaning or an accepted answer) is set aside, so it still shows under "Also" rather than
 * silently disappearing.
 */
export function withUncoveredSetAside(built: BuiltUsages, definitions: string[]): BuiltUsages {
  const covered = new Set(built.usages.flatMap(u => [u.meaning, ...u.acceptedAnswers]).map(a => a.toLowerCase()));
  const aside = new Set(built.setAside.map(d => d.toLowerCase()));
  const extra = definitions.filter(d => {
    const glosses = glossesOf([d]);
    return glosses.length > 0 && !glosses.some(g => covered.has(g.toLowerCase())) && !aside.has(d.toLowerCase());
  });
  return extra.length ? { ...built, setAside: [...built.setAside, ...extra] } : built;
}

/** Identifies a lesson's examples, so a rejected build isn't retried until they change. */
export function examplesFingerprint(sentences: string[]): string {
  return createHash('sha1').update(sentences.join('\n')).digest('hex').slice(0, 16);
}

