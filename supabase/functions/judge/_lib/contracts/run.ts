// GENERATED from src/contracts/run.ts; edit the source and run npm run sync:functions.
// Run contracts shared by browser, Node scripts and edge functions: the Flag shape (PLAN section 3) and the Run /
// Attempt / Ruling records (PLAN sections 5 and 6). Field names are camelCase here; the database columns are the
// snake_case equivalents (mapped in the store implementations).

import type { Fact, FactKind, Span, Toggle } from '../lib/factledger/types.ts';

export type FlagClass = 'hard' | 'soft' | 'claim' | 'coverage';

/** Id prefix per class; id = prefix + 1-based index in deterministic emission order on one attempt (H1, S1, C1, G1). */
export const FLAG_PREFIX: Readonly<Record<FlagClass, string>> = {
  hard: 'H',
  soft: 'S',
  claim: 'C',
  coverage: 'G',
};

export interface Flag {
  id: string;
  class: FlagClass;
  /** Machine code, e.g. 'missing_fact', 'added_fact', 'placeholder_missing', 'half_dropped', 'llm_unavailable'. */
  code: string;
  factId?: string;
  kind?: FactKind;
  sourceSpan?: Span;
  rewriteSpan?: Span;
  /** What was found instead (human-readable). */
  found: string;
  evidence?: string;
  /** Claim flags only: the judged sentence pair (F<n> forward / R<n> reverse). */
  pairId?: string;
}

/** A flag before its id is assigned. */
export type FlagDraft = Omit<Flag, 'id'>;

/** Flag classes a reviewer must acknowledge before approving a needs_review attempt; hard flags are only overridden. */
export const ACKNOWLEDGEABLE_CLASSES: readonly FlagClass[] = ['soft', 'claim', 'coverage'];

export type System = 'B0' | 'B1' | 'B2' | 'B3' | 'B4';
export const SYSTEMS: readonly System[] = ['B0', 'B1', 'B2', 'B3', 'B4'];

export type Verdict = 'pass' | 'needs_review' | 'failed';
export type RunStatus = 'open' | 'attempting' | 'judging' | 'review_ready';
export type RunMode = 'demo' | 'live' | 'eval';
export type ClaimStatus = 'overlap_only' | 'llm_done' | 'llm_unavailable' | 'truncated';
export type AttemptState = 'in_flight' | 'complete' | 'call_failed' | 'unknown';
export type Decision = 'approve' | 'reject' | 'override';

export interface Coverage {
  judged: number;
  total: number;
}

/** One hard failure restated for the model; values of masked kinds are given as their placeholder, never the raw text. */
export interface RepairItem {
  flagId: string;
  code: string;
  factId?: string;
  kind?: FactKind;
  /** Raw source value (number/date/entity), or the placeholder token for quote/verbatim facts. */
  value?: string;
  found: string;
}

/** Structured repair request, built by code only from the previous attempt's stored hard flags (never model critique). */
export interface RepairRequest {
  version: 'repair-v1';
  /** Ordinal of the attempt whose hard failures are being repaired. */
  fromOrdinal: number;
  items: RepairItem[];
}

export interface Run {
  id: string;
  userId: string | null;
  system: System;
  mode: RunMode;
  /** Fixture / demo source id, or null for user text. */
  sourceId: string | null;
  /** Built-in voice id, or null for user samples. */
  voiceId: string | null;
  profileId: string | null;
  sourceText: string;
  samples: string[];
  toggles: Record<string, Toggle>;
  aliases: Record<string, string[]>;
  protectedTerms: string[];
  // derived, frozen (server-derived in live mode; computed in the browser for local demo runs)
  sourceHash: string | null;
  ledger: Fact[] | null;
  maskNamespace: string | null;
  referenceTime: string | null;
  checkerVersion: string | null;
  promptVersion: string | null;
  maskVersion: string | null;
  // state
  status: RunStatus;
  evidenceVersion: number;
  selectedAttemptId: string | null;
  verdict: Verdict | null;
  error: string | null;
  createdAt: string;
  /** true for records kept only in this browser (Offline Demo): shown as "local demo record". */
  localDemo: boolean;
}

export interface Attempt {
  id: string;
  runId: string;
  ordinal: number;
  requestKey: string | null;
  state: AttemptState;
  /** Restored rewrite text that the checks ran on (and that would be exported). */
  outputText: string | null;
  contentHash: string | null;
  flags: Flag[];
  /** The repair request that was sent with this attempt (null on ordinal 1). */
  repairRequest: RepairRequest | null;
  verdict: Verdict | null;
  claimStatus: ClaimStatus | null;
  judgeCoverage: Coverage | null;
  /** Descriptive style distance (null when disabled) and the reason it is null. */
  styleDistance: number | null;
  styleReason: string | null;
  error: string | null;
  createdAt: string;
}

export interface Ruling {
  id: string;
  kind: 'rewrite';
  userId: string | null;
  runId: string;
  attemptId: string;
  contentHash: string;
  evidenceVersion: number;
  decision: Decision;
  reason: string | null;
  acknowledgedFlags: string[];
  createdAt: string;
  localDemo: boolean;
}

export const LOCAL_DEMO_LABEL = 'local demo record';
