import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../../../src/lib/store/supabaseStore.ts';
import { attemptFromRow, rulingFromRow, runFromRow } from '../../../src/lib/server/codec.ts';
import type { Attempt } from '../../../src/contracts/run.ts';
import type { NewRunInput } from '../../../src/lib/store/types.ts';

const id = '11111111-1111-4111-8111-111111111111';
const input: NewRunInput = { system: 'B4', mode: 'live', sourceId: null, voiceId: null,
  sourceText: 'The system is ready.', samples: ['Short words.'], toggles: {}, aliases: {}, protectedTerms: [] };
const row = { id, user_id: 'user', mode: 'live', system: 'B4', source_text: input.sourceText, samples: input.samples,
  source_id: null, voice_id: null, profile_id: null, toggles: {}, aliases: {}, protected_terms: [], source_hash: null,
  ledger: null, mask_namespace: null, reference_time: null, checker_version: null, prompt_version: null, mask_version: null,
  status: 'open', evidence_version: 0, selected_attempt_id: null, verdict: null, error: null, created_at: '2026-10-24T12:00:00Z' };
function clientDouble(hasSession = false) {
  const getSession = vi.fn(async () => ({ data: { session: hasSession ? { user: { id: 'user' } } : null }, error: null }));
  const signInAnonymously = vi.fn(async () => ({ data: { user: { id: 'user' } }, error: null }));
  const insert = vi.fn((_value: unknown) => query);
  const query = { insert, select: vi.fn(() => query), single: vi.fn(async () => ({ data: row, error: null })) };
  const from = vi.fn(() => query);
  const invoke = vi.fn(async () => ({ data: { configured: true, rewrite_configured: true, judge_configured: false }, error: null }));
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const client = { auth: { getSession, signInAnonymously }, from, rpc, functions: { invoke } } as unknown as SupabaseClient;
  return { client, getSession, signInAnonymously, insert, from, invoke, rpc };
}
describe('Supabase store trust boundary', () => {
  it('does not instantiate/sign in/probe until a live method is explicitly invoked', async () => {
    const h = clientDouble();
    const store = createSupabaseStore(h.client);
    expect(h.getSession).not.toHaveBeenCalled();
    expect(h.signInAnonymously).not.toHaveBeenCalled();
    expect(h.invoke).not.toHaveBeenCalled();
    await store.probeConfiguration();
    expect(h.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(h.invoke).toHaveBeenCalledWith('rewrite', { body: { probe: true } });
  });
  it('reuses the existing anonymous session and inserts only raw inputs', async () => {
    const h = clientDouble(true);
    const run = await createSupabaseStore(h.client).createRun(input);
    expect(h.signInAnonymously).not.toHaveBeenCalled();
    expect(h.insert).toHaveBeenCalledWith({ user_id: 'user', system: 'B4', mode: 'live', source_id: null, voice_id: null,
      profile_id: null, source_text: input.sourceText, samples: input.samples, toggles: {}, aliases: {}, protected_terms: [] });
    expect(run.sourceHash).toBeNull();
    expect(run.localDemo).toBe(false);
  });
  it('refuses browser-supplied attempt evidence and finish verdicts before auth or writes', async () => {
    const h = clientDouble();
    const store = createSupabaseStore(h.client);
    await expect(store.appendAttempt({} as Attempt)).rejects.toThrow('server_authoritative');
    await expect(store.finishRun(id, { status: 'review_ready', selectedAttemptId: null, verdict: 'pass', error: null })).rejects.toThrow('server_authoritative');
    expect(h.getSession).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('strictly validates function responses and propagates backend errors without falling back to demo', async () => {
    const h = clientDouble(true);
    const store = createSupabaseStore(h.client);
    await expect(store.requestRewrite({ run_id: id, expected_ordinal: 1, request_key: 'rewrite-0001', source_hash: 'a'.repeat(64) })).rejects.toThrow();
    h.invoke.mockResolvedValueOnce({ data: null, error: { message: 'provider_not_configured' } } as never);
    await expect(store.probeConfiguration()).rejects.toThrow('provider_not_configured');
  });
  it('maps snake_case rows explicitly while keeping flag and repair JSON unchanged', () => {
    expect(runFromRow(row)).toMatchObject({ sourceText: input.sourceText, sourceHash: null, localDemo: false, userId: 'user' });
    const flags = [{ id: 'G1', class: 'coverage', code: 'llm_unavailable', found: 'none' }];
    expect(attemptFromRow({ id, run_id: id, flags, repair_request: { fromOrdinal: 1 }, content_hash: 'a'.repeat(64) })).toMatchObject({ runId: id, flags, repairRequest: { fromOrdinal: 1 }, contentHash: 'a'.repeat(64) });
    expect(rulingFromRow({ id, run_id: id, attempt_id: id, content_hash: 'a'.repeat(64), evidence_version: 2, acknowledged_flags: ['G1'] })).toMatchObject({ runId: id, attemptId: id, evidenceVersion: 2, acknowledgedFlags: ['G1'], localDemo: false });
  });
});
