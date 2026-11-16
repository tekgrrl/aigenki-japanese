/**
 * What a Gemini call cost, from the token counts Gemini returns (`usageMetadata`) and the paid-tier
 * Standard prices. Prices are USD per 1M tokens, from https://ai.google.dev/gemini-api/docs/pricing
 * (checked 2026-11-15). When Google changes a price, add a dated entry rather than editing the old
 * one, so older logs keep the price they were charged at. Audio input/output isn't priced: no
 * logged call sends or returns audio.
 */
import type { GenerateContentResponseUsageMetadata } from '@google/genai';

interface Rates {
  input: number;
  /** Output, thinking included. */
  output: number;
  /** Input tokens read from a context cache (storage is billed separately, not counted here). */
  cached?: number;
  /** Image output tokens, for image models. */
  imageOutput?: number;
}

/** Each model's rates, oldest first; an entry with `from` applies from that day (UTC). */
const PRICES: Record<string, { from?: string; rates: Rates }[]> = {
  'gemini-3.8-flash': [
    { rates: { input: 0.75, output: 3.75, cached: 0.075 } },
    { from: '2027-01-01', rates: { input: 1.5, output: 7.5, cached: 0.15 } },
  ],
  'gemini-3.6-flash': [
    { rates: { input: 0.75, output: 3.75, cached: 0.075 } },
    { from: '2027-01-01', rates: { input: 1.5, output: 7.5, cached: 0.15 } },
  ],
  'gemini-4-hydrogen': [{ rates: { input: 1.5, output: 7.5, cached: 0.075 } }],
  'gemini-3.5-flash-lite': [{ rates: { input: 0.3, output: 2.5, cached: 0.03 } }],
  'gemini-3.1-flash-lite': [{ rates: { input: 0.25, output: 1.5, cached: 0.025 } }],
  'gemini-3-flash-preview': [{ rates: { input: 0.5, output: 3, cached: 0.05 } }],
  // Prompts over 200k tokens cost more; no call of ours comes near that.
  'gemini-3.1-pro-preview': [{ rates: { input: 2, output: 12, cached: 0.2 } }],
  'gemini-3.1-flash-image': [{ rates: { input: 0.5, output: 3, imageOutput: 60 } }],
};

function ratesFor(model: string, at: Date): Rates | undefined {
  const day = at.toISOString().slice(0, 10);
  const entries = PRICES[model];
  if (!entries) return undefined;
  return [...entries].reverse().find(e => !e.from || e.from <= day)?.rates;
}

/** Token counts added up over the calls one log entry covers (retries and tool turns included). */
export interface TokenUsage {
  calls: number;
  input: number;
  cachedInput: number;
  output: number;
  thinking: number;
  imageOutput: number;
}

export const emptyUsage = (): TokenUsage => ({ calls: 0, input: 0, cachedInput: 0, output: 0, thinking: 0, imageOutput: 0 });

/** Adds one response's usageMetadata to a running total. `output` excludes thinking and image tokens. */
export function addUsage(total: TokenUsage, meta: GenerateContentResponseUsageMetadata | undefined): TokenUsage {
  if (!meta) return total;
  const image = (meta.candidatesTokensDetails ?? [])
    .filter(d => d.modality === 'IMAGE')
    .reduce((s, d) => s + (d.tokenCount ?? 0), 0);
  total.calls += 1;
  total.input += (meta.promptTokenCount ?? 0) + (meta.toolUsePromptTokenCount ?? 0);
  total.cachedInput += meta.cachedContentTokenCount ?? 0;
  total.output += Math.max(0, (meta.candidatesTokenCount ?? 0) - image);
  total.thinking += meta.thoughtsTokenCount ?? 0;
  total.imageOutput += image;
  return total;
}

/** USD for the usage, or undefined for a model with no price listed here. */
export function costUsd(model: string, usage: TokenUsage, at: Date = new Date()): number | undefined {
  const r = ratesFor(model, at);
  if (!r) return undefined;
  const uncached = Math.max(0, usage.input - usage.cachedInput);
  const usd =
    uncached * r.input +
    usage.cachedInput * (r.cached ?? r.input) +
    (usage.output + usage.thinking) * r.output +
    usage.imageOutput * (r.imageOutput ?? r.output);
  return usd / 1_000_000;
}
