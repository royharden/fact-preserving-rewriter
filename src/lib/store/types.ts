// Store interface used by the UI: localStore (Offline Demo, browser storage) now; supabaseStore (live, M3) later. In
// live mode attempts and run state are written by the edge functions and rulings by the record_ruling RPC, so the
// supabase implementation drives appendAttempt/finishRun through those server paths (M3 may add a dedicated
// "request next attempt" method); the shapes returned are the same.

import type { Attempt, Run, RunMode, RunStatus, Ruling, System, Verdict } from '../../contracts/run.ts';
import type { Fact, Toggle } from '../factledger/types.ts';
import type { RulingInput } from '../rulings/types.ts';

export interface RunBundle {
  run: Run;
  /** Ordered by ordinal. */
  attempts: Attempt[];
  /** Append order (oldest first). */
  rulings: Ruling[];
}

/** Derived inputs; supplied by local demo runs only (live runs have them frozen server-side). */
export interface DerivedInputs {
  sourceHash: string;
  ledger: Fact[];
  maskNamespace: string | null;
  referenceTime: string;
  checkerVersion: string;
  promptVersion: string;
  maskVersion: string;
}

export interface NewRunInput {
  system: System;
  mode: RunMode;
  sourceId: string | null;
  voiceId: string | null;
  profileId?: string | null;
  sourceText: string;
  samples: string[];
  toggles: Record<string, Toggle>;
  aliases: Record<string, string[]>;
  protectedTerms: string[];
  derived?: DerivedInputs;
}

export interface RunFinish {
  status: RunStatus;
  selectedAttemptId: string | null;
  verdict: Verdict | null;
  error: string | null;
}

export interface Store {
  readonly kind: 'local' | 'supabase';
  /** Label shown next to records from this store (e.g. "local demo record"), or null. */
  readonly recordLabel: string | null;
  createRun(input: NewRunInput): Promise<Run>;
  /** Newest first. */
  listRuns(): Promise<Run[]>;
  loadRun(runId: string): Promise<RunBundle | null>;
  appendAttempt(attempt: Attempt): Promise<void>;
  finishRun(runId: string, finish: RunFinish): Promise<Run>;
  /** Validates with the ruling gate and appends; throws RulingRefused when not allowed. */
  recordRuling(input: RulingInput): Promise<Ruling>;
  /** True only when the latest ruling for that attempt's exact content hash is approve or override. */
  canExport(runId: string, attemptId: string): Promise<boolean>;
  deleteMyData(): Promise<void>;
}
