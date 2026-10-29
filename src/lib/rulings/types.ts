// Ruling inputs and refusal codes. The ruling record itself is `Ruling` in contracts/run.ts (kind 'rewrite').

import type { Decision } from '../../contracts/run.ts';

export type { Decision, Ruling } from '../../contracts/run.ts';

/** What the reviewer submits; mirrors record_ruling(p_attempt, p_decision, p_reason, p_acknowledged_flags, p_expected_hash, p_evidence_version). */
export interface RulingInput {
  runId: string;
  attemptId: string;
  decision: Decision;
  reason?: string | null;
  acknowledgedFlags?: readonly string[];
  /** Optimistic concurrency: the content hash and evidence version the reviewer saw. */
  expectedHash: string;
  evidenceVersion: number;
}

export type RulingRefusal =
  | 'run_not_found'
  | 'run_not_review_ready'
  | 'not_selected_attempt'
  | 'attempt_not_complete'
  | 'hash_mismatch'
  | 'evidence_version_mismatch'
  | 'approve_failed'
  | 'flags_not_acknowledged'
  | 'unknown_acknowledgement'
  | 'override_not_failed'
  | 'override_reason_too_short';

export type RulingCheck = { ok: true } | { ok: false; code: RulingRefusal; message: string };

export class RulingRefused extends Error {
  readonly code: RulingRefusal;

  constructor(code: RulingRefusal, message: string) {
    super(message);
    this.name = 'RulingRefused';
    this.code = code;
  }
}

export const OVERRIDE_REASON_MIN = 10;
