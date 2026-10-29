// Regression SOURCE for M4 review blockers. Not executed during Dirty Mode construction.
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { restoreEvalIdentity, evalSessionPath } from '../../../scripts/eval/session.ts';
import type { StoredEvalSession } from '../../../scripts/eval/session.ts';
import { validateClaimsEdition } from '../../../scripts/eval/claims.ts';
import type { FrozenThreshold } from '../../../scripts/eval/claims.ts';
import { provenance } from '../../../scripts/eval/common.ts';
import type { Manifest } from '../../../scripts/eval/common.ts';
import { runEvaluation } from '../../../scripts/eval/index.ts';
import { measurementError } from '../../../scripts/eval/e2e.ts';
import { validateLivePlan } from '../../../scripts/eval/plan-live.ts';
import { MockRecordingMissing } from '../../../src/lib/providers/mock.ts';
import { MUTATION_TYPES } from '../../../src/lib/mutators/index.ts';
import { wilson } from '../../../src/lib/evalkit/wilson.ts';
import { createSupabaseStore } from '../../../src/lib/store/supabaseStore.ts';
import { evalAllowanceReady } from '../../../src/lib/server/config.ts';
import { ConfigProbeRequestSchema, ConfigProbeResponseSchema } from '../../../src/contracts/api.ts';

const userId = '11111111-1111-4111-8111-111111111111', otherId = '22222222-2222-4222-8222-222222222222';
const url = 'https://synthetic-project.example';
const saved: StoredEvalSession = { version: 1, project_url: url, user_id: userId, access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token' };
function authDouble(identity = userId, hasSession = true) {
  const session = { user: { id: identity }, access_token: 'synthetic-refreshed-access', refresh_token: 'synthetic-refreshed-refresh' };
  const auth = { setSession: vi.fn(async () => ({ data: { session }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: { id: identity } }, error: null })),
    getSession: vi.fn(async () => ({ data: { session: hasSession ? session : null }, error: null })), signInAnonymously: vi.fn() };
  const invoke = vi.fn();
  return { auth, invoke, client: { auth, functions: { invoke } } as unknown as SupabaseClient };
}
describe('approved live identity and bounded allowance', () => {
  it('restores the saved identity, verifies Auth user and retains refreshed tokens without anonymous fallback', async () => {
    const h = authDouble();
    await expect(restoreEvalIdentity(h.client, saved, url, userId)).resolves.toMatchObject({ user_id: userId, refresh_token: 'synthetic-refreshed-refresh' });
    expect(h.auth.setSession).toHaveBeenCalledWith({ access_token: saved.access_token, refresh_token: saved.refresh_token });
    expect(h.auth.getUser).toHaveBeenCalledTimes(1);
    expect(h.auth.signInAnonymously).not.toHaveBeenCalled();
    const wrong = authDouble(otherId);
    await expect(restoreEvalIdentity(wrong.client, saved, url, userId)).rejects.toThrow('restored');
    const wrongVerified = authDouble();
    wrongVerified.auth.getUser.mockResolvedValueOnce({ data: { user: { id: otherId } }, error: null });
    await expect(restoreEvalIdentity(wrongVerified.client, saved, url, userId)).rejects.toThrow('verified');
    await expect(restoreEvalIdentity(h.client, saved, 'https://wrong.example', userId)).rejects.toThrow('mismatch');
  });
  it('rejects a missing/changed approved session before any function call, including expiry mid-evaluation', async () => {
    for (const h of [authDouble(userId, false), authDouble(otherId)]) {
      await expect(createSupabaseStore(h.client, { expectedUserId: userId }).probeConfiguration()).rejects.toThrow(/approved_eval_/);
      expect(h.auth.signInAnonymously).not.toHaveBeenCalled(); expect(h.invoke).not.toHaveBeenCalled();
    }
    expect(() => evalSessionPath('.eval-auth/owner.json')).not.toThrow();
    expect(() => evalSessionPath('results/session.json')).toThrow('gitignored');
  });
  const requirement = { max_calls: 19, max_micro_usd: 500_000, required_micro_usd: 450_000, approval_reference: 'synthetic-owner-approval' };
  const now = Date.parse('2026-10-24T12:00:00Z');
  const grant = { expires_at: '2026-10-24T13:00:00Z', max_calls: 19, max_micro_usd: 500_000, used_calls: 0, used_micro_usd: 0, note: requirement.approval_reference };
  it('requires matching active grant, enough remaining calls/money and the approved ceiling; response leaks no amounts', () => {
    expect(evalAllowanceReady(grant, requirement, now)).toBe(true);
    for (const row of [null, { ...grant, note: 'wrong-approval' }, { ...grant, expires_at: '2026-10-24T11:00:00Z' },
      { ...grant, used_calls: 1 }, { ...grant, used_micro_usd: 50_001 }, { ...grant, max_micro_usd: 5_000_001 }, { ...grant, max_calls: 20 }]) expect(evalAllowanceReady(row, requirement, now)).toBe(false);
    expect(ConfigProbeRequestSchema.safeParse({ probe: true, eval: { ...requirement, user_id: otherId } }).success).toBe(false);
    expect(ConfigProbeRequestSchema.safeParse({ probe: true, eval: { ...requirement, max_micro_usd: 5_000_001 } }).success).toBe(false);
    expect(ConfigProbeResponseSchema.safeParse({ configured: true, rewrite_configured: true, judge_configured: true, eval_allowance_ready: true, max_micro_usd: 500_000 }).success).toBe(false);
  });
  it('refuses a plan with wrong calls, expanded run keys or a stale corpus before allowance probing', () => {
    const keys = ['B2', 'B3', 'B4'].map((system) => `source|voice|${system}`);
    const plan = { version: 1, manifest_sha256: 'fixture-hash', allowance_micro_usd: 500_000, selected_max_calls: 19, selected_max_reserved_micro_usd: 450_000, run_keys: keys };
    expect(validateLivePlan(plan, 'fixture-hash', keys)).toEqual(plan);
    for (const value of [{ ...plan, selected_max_calls: 18 }, { ...plan, run_keys: [...keys, ...keys] }, { ...plan, manifest_sha256: 'stale' }]) expect(() => validateLivePlan(value, 'fixture-hash', keys)).toThrow();
  });
});

describe('frozen claims edition reuse', () => {
  const manifest: Manifest = { version: 1, freeze_date: '2026-10-24', reference_time: '2026-10-24T12:00:00Z', seeds: { split: 1, pair: 2, mutator: 3 }, voices: [], pairs: [],
    sources: [{ id: 'source-dev', split: 'dev' }, { id: 'source-heldout', split: 'heldout' }].map((s) => ({ ...s, genre: 'synthetic', path: '', good_path: '', text: '', gold: [], traps: [], word_count: 0, split: s.split as 'dev' | 'heldout' })) };
  const frozen: FrozenThreshold = { version: 1, status: 'frozen', manifest_sha256: 'fixture-hash', checker_version: 'checks-v1', support_min: 0.5, min_content_words: 2, dev_source_ids: ['source-dev'], false_alarms: 0, total: 1, target_met: true };
  function edition() {
    const rows = manifest.sources.flatMap((s) => ['known_good', ...MUTATION_TYPES].map((type) => ({ source_id: s.id, split: s.split, type, applicable: true, flagged: false })));
    const summary = ['dev', 'heldout'].flatMap((split) => ['known_good', ...MUTATION_TYPES].map((type) => ({ split, type, metric: type === 'known_good' ? 'false alarm' : 'recall', interval: wilson(0, 1), rejected: 0 })));
    return { edition_version: 1, label: 'computed overlap, no model call', provenance: provenance(manifest, 'fixture-hash'), threshold: frozen, rows, summary };
  }
  it('accepts the complete matching edition without mutating it; refuses stale, incomplete or duplicated evidence', () => {
    const artifact = edition(), bytes = JSON.stringify(artifact);
    expect(() => validateClaimsEdition(artifact, manifest, 'fixture-hash', frozen)).not.toThrow();
    expect(JSON.stringify(artifact)).toBe(bytes);
    expect(() => validateClaimsEdition(artifact, manifest, 'stale-hash', frozen)).toThrow('provenance');
    expect(() => validateClaimsEdition({ ...artifact, threshold: { ...frozen, support_min: 0.6 } }, manifest, 'fixture-hash', frozen)).toThrow();
    expect(() => validateClaimsEdition({ ...artifact, rows: artifact.rows.slice(1) }, manifest, 'fixture-hash', frozen)).toThrow('incomplete');
    expect(() => validateClaimsEdition({ ...artifact, rows: artifact.rows.map((r, i) => i === 1 ? artifact.rows[0] : r) }, manifest, 'fixture-hash', frozen)).toThrow('rows');
    expect(() => validateClaimsEdition({ ...artifact, summary: [] }, manifest, 'fixture-hash', frozen)).toThrow('summary');
  });
  it('the full mock then live command requests reuse both times and reaches both E2E modes', async () => {
    let evaluated = false;
    const claims = vi.fn(async (options: { existing?: 'refuse' | 'reuse' } = {}) => {
      if (evaluated && options.existing !== 'reuse') throw new Error('would reevaluate heldout');
      if (evaluated) validateClaimsEdition(edition(), manifest, 'fixture-hash', frozen);
      evaluated = true;
    });
    const tasks = { runChecks: vi.fn(async () => {}), runClaims: claims, runE2E: vi.fn(async () => {}) };
    await runEvaluation('mock', tasks); await runEvaluation('live', tasks);
    expect(claims.mock.calls).toEqual([[{ existing: 'reuse' }], [{ existing: 'reuse' }]]);
    expect(tasks.runE2E.mock.calls).toEqual([['mock'], ['live']]);
  });
});

it('missing/stale model mock aborts evaluation while ordinary operational failures remain failed measurements', () => {
  const missing = new MockRecordingMissing('B4|source|voice|1|rewrite', 'stale/missing fixture');
  expect(() => measurementError(missing)).toThrow(missing);
  expect(measurementError(new Error('scripted provider failure'))).toBe('scripted provider failure');
});
