import { describe, expect, it } from 'vitest';
import { costMicroUsd, estimateInputTokens, fitsCap, reservationMicroUsd, settledMicroUsd, usdToMicro } from '../../../src/lib/callledger/cost.ts';

describe('integer micro-USD accounting', () => {
  const prices = { inMicroUsdPerMTok: 1_000_000, outMicroUsdPerMTok: 2_000_000 };
  it('rounds up, reserves the full output cap and retains reservation for unknown usage', () => {
    expect(costMicroUsd(10, 5, prices)).toBe(20);
    expect(costMicroUsd(1, 0, { inMicroUsdPerMTok: 1, outMicroUsdPerMTok: 0 })).toBe(1);
    expect(reservationMicroUsd(10, 100, prices)).toBe(210);
    expect(settledMicroUsd(210, { inputTokens: null, outputTokens: 2 }, prices)).toBe(210);
    expect(settledMicroUsd(210, { inputTokens: 10, outputTokens: 2 }, prices)).toBe(14);
    expect(usdToMicro(0.15)).toBe(150_000);
    expect(estimateInputTokens('😀')).toBeGreaterThanOrEqual(4);
    expect(fitsCap(90, 10, 100)).toBe(true);
    expect(fitsCap(90, 11, 100)).toBe(false);
  });
  it('rejects negative, fractional and overflow accounting values', () => {
    expect(() => costMicroUsd(-1, 1, prices)).toThrow();
    expect(() => costMicroUsd(1.5, 1, prices)).toThrow();
    expect(() => costMicroUsd(Number.MAX_SAFE_INTEGER, 1, prices)).toThrow('overflow');
    expect(() => fitsCap(0, -1, 100)).toThrow();
    expect(() => usdToMicro(Number.MAX_VALUE)).toThrow();
  });
});
