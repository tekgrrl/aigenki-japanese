import { addUsage, costUsd, emptyUsage } from './gemini-pricing';

describe('gemini-pricing', () => {
  it('adds usage over several responses, splitting image output out', () => {
    const u = emptyUsage();
    addUsage(u, { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300 });
    addUsage(u, { promptTokenCount: 500, cachedContentTokenCount: 400, candidatesTokenCount: 1300, candidatesTokensDetails: [{ modality: 'IMAGE' as any, tokenCount: 1290 }] });
    addUsage(u, undefined);
    expect(u).toEqual({ calls: 2, input: 1500, cachedInput: 400, output: 210, thinking: 300, imageOutput: 1290 });
  });

  it('prices 3.8 Flash at the rate of the day, thinking billed as output', () => {
    const u = addUsage(emptyUsage(), { promptTokenCount: 1_000_000, candidatesTokenCount: 500_000, thoughtsTokenCount: 500_000 });
    expect(costUsd('gemini-3.8-flash', u, new Date('2026-11-15'))).toBeCloseTo(0.75 + 3.75);
    expect(costUsd('gemini-3.8-flash', u, new Date('2027-01-01'))).toBeCloseTo(1.5 + 7.5);
  });

  it('prices cached input and image tokens at their own rates', () => {
    const u = { calls: 1, input: 1_000_000, cachedInput: 1_000_000, output: 0, thinking: 0, imageOutput: 0 };
    expect(costUsd('gemini-3.8-flash', u, new Date('2026-11-15'))).toBeCloseTo(0.075);
    const img = { calls: 1, input: 0, cachedInput: 0, output: 0, thinking: 0, imageOutput: 1290 };
    expect(costUsd('gemini-3.1-flash-image', img)).toBeCloseTo(0.0774);
  });

  it('gives undefined for an unpriced model', () => {
    expect(costUsd('gemini-unknown', emptyUsage())).toBeUndefined();
  });
});
