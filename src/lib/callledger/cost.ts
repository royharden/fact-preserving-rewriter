// Micro-USD reservation math (integers only). A reservation is the worst case for one call: estimated input tokens at
// the input price plus the full max_tokens at the output price, rounded up. Settlement uses reported usage; when usage
// is unknown the full reservation is kept (PLAN section 6.2: unknown keeps full reservation).

import type { BudgetLimits, CallPurpose, Prices } from './types.ts';

export const MICRO_USD_PER_USD = 1_000_000;
const TOKENS_PER_MTOK = 1_000_000;
/** Byte upper-bound estimate for byte-based tokenizers, plus message overhead; actual billing still uses usage. */
export const BYTES_PER_TOKEN_ESTIMATE = 1;
export const MESSAGE_OVERHEAD_TOKENS = 32;

const encoder = new TextEncoder();

function assertCount(name: string, n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a non-negative safe integer, got ${n}`);
}

export function usdToMicro(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`invalid USD amount ${usd}`);
  const micro = Math.round(usd * MICRO_USD_PER_USD);
  assertCount('micro', micro);
  return micro;
}

export function microToUsd(micro: number): number {
  return micro / MICRO_USD_PER_USD;
}

export function estimateInputTokens(...texts: string[]): number {
  const bytes = texts.reduce((n, t) => n + encoder.encode(t).length, 0);
  return Math.ceil(bytes / BYTES_PER_TOKEN_ESTIMATE) + MESSAGE_OVERHEAD_TOKENS;
}

/** ceil((inTok * inPrice + outTok * outPrice) / 1e6) micro-USD. */
export function costMicroUsd(inputTokens: number, outputTokens: number, prices: Prices): number {
  assertCount('inputTokens', inputTokens);
  assertCount('outputTokens', outputTokens);
  assertCount('inMicroUsdPerMTok', prices.inMicroUsdPerMTok);
  assertCount('outMicroUsdPerMTok', prices.outMicroUsdPerMTok);
  const numerator = inputTokens * prices.inMicroUsdPerMTok + outputTokens * prices.outMicroUsdPerMTok;
  if (!Number.isSafeInteger(numerator)) throw new Error('cost overflow');
  return Math.ceil(numerator / TOKENS_PER_MTOK);
}

export function reservationMicroUsd(estimatedInputTokens: number, maxOutputTokens: number, prices: Prices): number {
  return costMicroUsd(estimatedInputTokens, maxOutputTokens, prices);
}

/** Settled amount: actual usage when both counts are known, otherwise the full reservation. */
export function settledMicroUsd(reserved: number, usage: { inputTokens: number | null; outputTokens: number | null }, prices: Prices): number {
  assertCount('reserved', reserved);
  if (usage.inputTokens === null || usage.outputTokens === null) return reserved;
  return costMicroUsd(usage.inputTokens, usage.outputTokens, prices);
}

/** True when used + reserve stays within cap. */
export function fitsCap(usedMicroUsd: number, reserveMicroUsd: number, capMicroUsd: number): boolean {
  assertCount('usedMicroUsd', usedMicroUsd);
  assertCount('reserveMicroUsd', reserveMicroUsd);
  assertCount('capMicroUsd', capMicroUsd);
  return usedMicroUsd + reserveMicroUsd <= capMicroUsd;
}

/** Worst-case money for one run of the given purposes' maximum call counts at one per-call reservation. */
export function worstCaseRunMicroUsd(limits: BudgetLimits, purposes: readonly CallPurpose[], perCallReservation: number): number {
  const calls = purposes.reduce((n, p) => n + limits.runCalls[p], 0);
  return Math.min(calls * perCallReservation, limits.runMicroUsd);
}
