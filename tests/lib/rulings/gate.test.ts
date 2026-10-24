import { describe, expect, it } from 'vitest';
import type { Flag } from '../../../src/contracts/run.ts';
import { canExport, validateRuling } from '../../../src/lib/rulings/gate.ts';
import { contentHash } from '../../../src/lib/rulings/contentHash.ts';
import { readyStore, rulingInput } from '../store/helpers.ts';

describe('approval is bound to checked content and evidence', () => {
  it('blocks no ruling and reject, unlocks approve, and lets a later reject revoke approve', async () => {
    const { store, bundle, attempt } = await readyStore();
    expect(await store.canExport(bundle.run.id, attempt.id)).toBe(false);
    await store.recordRuling(rulingInput(bundle, 'reject'));
    expect(await store.canExport(bundle.run.id, attempt.id)).toBe(false);
    const approved = await store.recordRuling(rulingInput(bundle, 'approve'));
    expect(await store.canExport(bundle.run.id, attempt.id)).toBe(true);
    await store.recordRuling(rulingInput(bundle, 'reject'));
    expect(await store.canExport(bundle.run.id, attempt.id)).toBe(false);
    expect(canExport([approved], 'another-attempt', attempt.contentHash)).toBe(false);
    expect(canExport([approved], attempt.id, await contentHash('Changed output.'))).toBe(false);
    expect(canExport([approved], attempt.id, null)).toBe(false);
    expect(canExport([approved, { ...approved, attemptId: 'unrelated', decision: 'reject' }], attempt.id, attempt.contentHash)).toBe(true);
  });

  it('refuses approving failed content and requires a trimmed reason of at least ten characters to override', async () => {
    const { store, bundle, attempt } = await readyStore([{ id: 'H1', class: 'hard', code: 'missing_fact', found: 'absent' }]);
    await expect(store.recordRuling(rulingInput(bundle, 'approve'))).rejects.toMatchObject({ code: 'approve_failed' });
    await expect(store.recordRuling(rulingInput(bundle, 'override', { reason: '  nine  ' }))).rejects.toMatchObject({ code: 'override_reason_too_short' });
    expect(await store.canExport(bundle.run.id, attempt.id)).toBe(false);
    const ruling = await store.recordRuling(rulingInput(bundle, 'override', { reason: '  Reviewed loss carefully.  ' }));
    expect(ruling.reason).toBe('Reviewed loss carefully.');
    expect(await store.canExport(bundle.run.id, attempt.id)).toBe(true);
    await store.recordRuling(rulingInput(bundle, 'reject'));
    expect(await store.canExport(bundle.run.id, attempt.id)).toBe(false);
  });

  it('requires every soft, claim and coverage id and refuses unknown acknowledgement ids', async () => {
    const flags: Flag[] = [
      { id: 'S1', class: 'soft', code: 'modal_drift', found: 'may' },
      { id: 'C1', class: 'claim', code: 'added_claim', found: 'new claim' },
      { id: 'G1', class: 'coverage', code: 'truncated', found: '1/2' },
    ];
    const { store, bundle, attempt } = await readyStore(flags, 'truncated');
    for (const acknowledgedFlags of [[], ['S1'], ['S1', 'C1'], ['S1', 'G1'], ['C1', 'G1']]) {
      await expect(store.recordRuling(rulingInput(bundle, 'approve', { acknowledgedFlags }))).rejects.toMatchObject({ code: 'flags_not_acknowledged' });
    }
    await expect(store.recordRuling(rulingInput(bundle, 'approve', { acknowledgedFlags: ['S1', 'C1', 'G1', 'C99'] }))).rejects.toMatchObject({ code: 'unknown_acknowledgement' });
    expect(await store.canExport(bundle.run.id, attempt.id)).toBe(false);
    await store.recordRuling(rulingInput(bundle, 'approve', { acknowledgedFlags: ['S1', 'C1', 'G1'] }));
    expect(await store.canExport(bundle.run.id, attempt.id)).toBe(true);
  });

  it('rejects stale hash/evidence, unfinished or unselected attempts, and mismatched verdicts', async () => {
    const { bundle, attempt } = await readyStore();
    const input = rulingInput(bundle, 'approve');
    expect(validateRuling(bundle.run, attempt, { ...input, expectedHash: 'other-hash' })).toMatchObject({ ok: false, code: 'hash_mismatch' });
    expect(validateRuling(bundle.run, attempt, { ...input, evidenceVersion: 99 })).toMatchObject({ ok: false, code: 'evidence_version_mismatch' });
    expect(validateRuling({ ...bundle.run, status: 'judging' }, attempt, input)).toMatchObject({ ok: false, code: 'run_not_review_ready' });
    expect(validateRuling({ ...bundle.run, selectedAttemptId: 'other' }, attempt, input)).toMatchObject({ ok: false, code: 'not_selected_attempt' });
    expect(validateRuling(bundle.run, { ...attempt, state: 'in_flight' }, input)).toMatchObject({ ok: false, code: 'attempt_not_complete' });
    expect(validateRuling(bundle.run, { ...attempt, flags: [{ id: 'H1', class: 'hard', code: 'missing_fact', found: 'absent' }] }, input)).toMatchObject({ ok: false, code: 'attempt_not_complete' });
    expect(validateRuling(bundle.run, attempt, { ...input, decision: 'override', reason: 'Long enough reason.' })).toMatchObject({ ok: false, code: 'override_not_failed' });
  });
});
