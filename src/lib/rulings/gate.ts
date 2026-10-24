// Ruling gate (PLAN section 6.2 / M2 criterion 7), the same rules record_ruling and can_export enforce in SQL:
// - rulings only on the selected, completed attempt of a review_ready run, with matching hash and evidence version;
// - approve: only `pass`, or `needs_review` with every soft/claim/coverage flag id acknowledged; never `failed`;
// - override: only `failed`, with a trimmed reason of >= 10 characters; reject: always allowed;
// - canExport: the latest ruling (append order) for that attempt AND content hash is approve or override; a later
//   reject revokes; rulings on another attempt or hash never unlock.

import type { Attempt, Flag, Ruling, Run } from '../../contracts/run.ts';
import { ACKNOWLEDGEABLE_CLASSES } from '../../contracts/run.ts';
import type { RulingCheck, RulingInput } from './types.ts';
import { OVERRIDE_REASON_MIN } from './types.ts';
import { verdictOf } from '../loop/verdict.ts';

/** Flag ids a reviewer must acknowledge before approving (hard flags are never acknowledged, only overridden). */
export function acknowledgeableFlagIds(flags: readonly Flag[]): string[] {
  return flags.filter((f) => ACKNOWLEDGEABLE_CLASSES.includes(f.class)).map((f) => f.id);
}

const refuse = (code: Exclude<RulingCheck, { ok: true }>['code'], message: string): RulingCheck => ({ ok: false, code, message });

export function validateRuling(run: Run | null, attempt: Attempt | null, input: RulingInput): RulingCheck {
  if (!run || run.id !== input.runId) return refuse('run_not_found', 'run not found');
  if (run.status !== 'review_ready') return refuse('run_not_review_ready', `run is ${run.status}, not review_ready`);
  if (!attempt || attempt.runId !== run.id || attempt.id !== input.attemptId || run.selectedAttemptId !== attempt.id) {
    return refuse('not_selected_attempt', 'rulings apply only to the selected attempt of this run');
  }
  if (attempt.state !== 'complete' || attempt.contentHash === null || attempt.verdict === null) {
    return refuse('attempt_not_complete', 'the attempt has no checked content');
  }
  if (attempt.verdict !== verdictOf(attempt.flags, attempt.claimStatus) || run.verdict !== attempt.verdict) {
    return refuse('attempt_not_complete', 'the stored verdict does not match the selected evidence');
  }
  if (input.expectedHash !== attempt.contentHash) return refuse('hash_mismatch', 'the content changed since it was shown');
  if (input.evidenceVersion !== run.evidenceVersion) return refuse('evidence_version_mismatch', 'the evidence changed since it was shown');

  const acks = new Set(input.acknowledgedFlags ?? []);
  const required = acknowledgeableFlagIds(attempt.flags);
  if (input.decision === 'approve') {
    if (attempt.verdict === 'failed') return refuse('approve_failed', 'a failed attempt cannot be approved; override it with a reason');
    for (const id of acks) if (!required.includes(id)) return refuse('unknown_acknowledgement', `flag ${id} is not an acknowledgeable flag on this attempt`);
    const missing = required.filter((id) => !acks.has(id));
    if (missing.length > 0) return refuse('flags_not_acknowledged', `acknowledge every flag first: ${missing.join(', ')}`);
  }
  if (input.decision === 'override') {
    if (attempt.verdict !== 'failed') return refuse('override_not_failed', 'override is only for failed attempts');
    if ((input.reason ?? '').trim().length < OVERRIDE_REASON_MIN) {
      return refuse('override_reason_too_short', `override needs a typed reason of at least ${OVERRIDE_REASON_MIN} characters`);
    }
  }
  return { ok: true };
}

/** Rulings are given in append order (oldest first); the last one for this attempt and hash decides. */
export function canExport(rulings: readonly Ruling[], attemptId: string, contentHash: string | null): boolean {
  if (contentHash === null) return false;
  let latest: Ruling | null = null;
  for (const r of rulings) if (r.attemptId === attemptId && r.contentHash === contentHash) latest = r;
  return latest !== null && (latest.decision === 'approve' || latest.decision === 'override');
}
