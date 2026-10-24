// Call ledger records (PLAN section 6.2, table call_ledger) and budget shapes. Money is integer micro-USD.

import type { ProviderName } from '../providers/types.ts';

export type CallFunction = 'rewrite' | 'judge';
export type CallPurpose = 'rewrite' | 'b3_check' | 'b3_revise' | 'judge';
export type CallStatus = 'reserved' | 'dispatching' | 'settled' | 'failed' | 'unknown';
export type BudgetScope = 'run' | 'user' | 'global';

export interface CallLedgerEntry {
  idempotencyKey: string;
  userId: string | null;
  runId: string;
  attemptId: string | null;
  function: CallFunction;
  purpose: CallPurpose;
  provider: ProviderName;
  model: string;
  reservedMicroUsd: number;
  actualMicroUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  status: CallStatus;
  createdAt: string;
}

export interface Prices {
  inMicroUsdPerMTok: number;
  outMicroUsdPerMTok: number;
}

/** budget_limits (single row): calls per run by purpose, money per run, and per-user-day / global-day caps. */
export interface BudgetLimits {
  runCalls: Record<CallPurpose, number>;
  runMicroUsd: number;
  userDayCalls: number;
  userDayMicroUsd: number;
  globalDayCalls: number;
  globalDayMicroUsd: number;
  perCallMaxMicroUsd: number;
}

/** Proposed defaults (owner-set in budget_limits; live calls stay off until configured). */
export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  runCalls: { rewrite: 3, b3_check: 1, b3_revise: 1, judge: 4 },
  runMicroUsd: 150_000,
  userDayCalls: 40,
  userDayMicroUsd: 500_000,
  globalDayCalls: 600,
  globalDayMicroUsd: 2_000_000,
  perCallMaxMicroUsd: 50_000,
};
