// Behavioural assertions are deferred test SOURCE, not execution evidence.
import { describe, expect, it, vi } from 'vitest';
import { durableModelCall, callKey } from '../../../src/lib/server/modelCall.ts';
import { readLiveConfig } from '../../../src/lib/server/config.ts';
import { executeRewrite } from '../../../src/lib/server/rewrite.ts';
import { executeJudge } from '../../../src/lib/server/judge.ts';
import { runFromRow, attemptFromRow } from '../../../src/lib/server/codec.ts';
import type { CallRow, LiveModel, Row, ServiceGateway } from '../../../src/lib/server/types.ts';
import { sha256Hex } from '../../../src/lib/text/hash.ts';
import { CHECKER_VERSION } from '../../../src/lib/checks/index.ts';
import { PROMPT_VERSION } from '../../../src/lib/prompts/version.ts';
import { MASK_VERSION } from '../../../src/lib/mask/namespace.ts';
import { buildRepairRequest } from '../../../src/lib/loop/repairRequest.ts';

const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const source = 'The system is ready.';
function runRow(): Row { return { id: runId, user_id: 'owner', system: 'B4', mode: 'live', source_id: null, voice_id: null,
  profile_id: null, source_text: source, samples: ['Short clear words.'], toggles: {}, aliases: {}, protected_terms: [],
  source_hash: null, ledger: null, mask_namespace: null, reference_time: null, checker_version: null,
  prompt_version: null, mask_version: null, status: 'open', evidence_version: 0, selected_attempt_id: null,
  verdict: null, error: null, created_at: '2026-10-24T12:00:00Z' }; }
function attemptRow(): Row { return { id: attemptId, run_id: runId, ordinal: 1, request_key: 'rewrite-0001', state: 'complete',
  output_text: source, content_hash: 'a'.repeat(64), flags: [], repair_request: null, verdict: 'pass',
  claim_status: 'overlap_only', judge_coverage: null, style_distance: null, style_reason: null, error: null,
  created_at: '2026-10-24T12:00:00Z' }; }
const reply = { text: '{"rewrite":"The system is ready."}', model: 'pinned', provider: 'anthropic' as const, inputTokens: 1, outputTokens: 1 };
function harness(status?: CallRow['status']) {
  const row: CallRow = { id: 'call-1', idempotency_key: callKey(runId, attemptId, 'rewrite'), run_id: runId, attempt_id: attemptId,
    function: 'rewrite', purpose: 'rewrite', provider: 'anthropic', model: 'pinned', status: status ?? 'reserved',
    reserved_micro_usd: 10, response_payload: status === 'settled' ? reply : null };
  const calls = status ? [row] : [];
  const provider = vi.fn(async () => reply);
  const model: LiveModel = { provider: 'anthropic', model: 'pinned', prices: { inMicroUsdPerMTok: 1000, outMicroUsdPerMTok: 1000 }, maxTokens: 4096, call: provider };
  const rpc = vi.fn(async (name: string, args: Row): Promise<unknown> => {
    if (name === 'reserve_model_call') { calls.push(row); return row; }
    if (name === 'claim_dispatch') { if (row.status !== 'reserved') return false; row.status = 'dispatching'; return true; }
    if (name === 'settle_model_call') { row.status = args.p_status as CallRow['status']; row.response_payload = args.p_response_payload ?? null; return row; }
    throw new Error(`unexpected RPC ${name}`);
  });
  const db: ServiceGateway = { rpc: <T>(name: string, args: Row) => rpc(name, args) as Promise<T>, calls: async () => calls,
    run: async () => runFromRow(runRow()), attempts: async () => [] };
  return { row, calls, db, rpc, provider, model };
}
/** Small transaction-seam double; SQL concurrency/RLS assertions live separately in tests/sql. */
async function runHarness(system: 'B3' | 'B4') {
  let r: Row = { ...runRow(), system, source_hash: await sha256Hex(source), ledger: [], mask_namespace: system === 'B4' ? 'abcdef' : null,
    reference_time: '2026-10-24T12:00:00Z', checker_version: CHECKER_VERSION, prompt_version: PROMPT_VERSION, mask_version: MASK_VERSION };
  const attempts: Row[] = [];
  const calls: CallRow[] = [];
  const provider = vi.fn(async (request: { system: string; user: string }) => ({ ...reply,
    text: request.system.includes('Compare the <draft>') ? '{"issues":[]}' : reply.text }));
  const model: LiveModel = { provider: 'anthropic', model: 'pinned', maxTokens: 4096,
    prices: { inMicroUsdPerMTok: 1, outMicroUsdPerMTok: 1 }, call: provider };
  const rpc = vi.fn(async (name: string, args: Row): Promise<unknown> => {
    if (name === 'begin_attempt') {
      r = { ...r, status: 'attempting' };
      const a = { ...attemptRow(), id: args.p_expected_ordinal === 1 ? attemptId : '33333333-3333-4333-8333-333333333333', ordinal: args.p_expected_ordinal, request_key: args.p_request_key, state: 'in_flight',
        output_text: null, content_hash: null, verdict: null, repair_request: args.p_repair_request };
      attempts.push(a); return a;
    }
    if (name === 'reserve_model_call') {
      const c: CallRow = { id: `call-${calls.length + 1}`, idempotency_key: args.p_idempotency_key as string,
        run_id: args.p_run as string, attempt_id: args.p_attempt as string, function: args.p_function as CallRow['function'],
        provider: args.p_provider as string, model: args.p_model as string,
        purpose: args.p_purpose as string, status: 'reserved', reserved_micro_usd: Number(args.p_reserved_micro_usd), response_payload: null };
      calls.push(c); return c;
    }
    if (name === 'claim_dispatch') {
      const c = calls.find((c) => c.id === args.p_call)!;
      if (c.status !== 'reserved') return false;
      c.status = 'dispatching'; return true;
    }
    if (name === 'settle_model_call') {
      const c = calls.find((c) => c.id === args.p_call)!;
      c.status = args.p_status as CallRow['status']; c.response_payload = args.p_response_payload ?? null; return c;
    }
    if (name === 'complete_attempt') {
      const a = attempts[attempts.length - 1];
      Object.assign(a, { state: 'complete', output_text: args.p_output_text, content_hash: args.p_content_hash,
        flags: args.p_flags, verdict: args.p_verdict, claim_status: args.p_claim_status, judge_coverage: args.p_judge_coverage });
      return a;
    }
    if (name === 'finish_attempts') {
      r = { ...r, status: 'review_ready', selected_attempt_id: attemptId, verdict: attempts[attempts.length - 1].verdict };
      return r;
    }
    throw new Error(`unexpected ${name}`);
  });
  const db: ServiceGateway = { rpc: <T>(name: string, args: Row) => rpc(name, args) as Promise<T>,
    run: async () => runFromRow(r), attempts: async () => attempts.map(attemptFromRow), calls: async () => calls };
  return { db, rpc, attempts, calls, provider, model, run: () => runFromRow(r) };
}
describe('durable dispatch and fail-closed server seam', () => {
  it('dispatches once, atomically persists the reply, and replays it without another provider call', async () => {
    const h = harness();
    const prompt = { system: 'fixed', user: 'data' };
    await durableModelCall(h.db, runId, attemptId, 'rewrite', h.model, prompt);
    expect(h.row.status).toBe('settled');
    expect(h.row.response_payload).toEqual(reply);
    await durableModelCall(h.db, runId, attemptId, 'rewrite', h.model, prompt);
    expect(h.provider).toHaveBeenCalledTimes(1);
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(['reserve_model_call', 'claim_dispatch', 'settle_model_call']);
  });
  it.each(['model', 'provider', 'input price', 'output price', 'token limit'] as const)(
    'terminates a reserved replay at zero cost before claim when its current %s is incompatible', async (changed) => {
      const h = harness('reserved');
      if (changed === 'model') h.model.model = 'replacement';
      if (changed === 'provider') h.model.provider = 'openai_compatible';
      if (changed === 'input price') h.model.prices.inMicroUsdPerMTok = 1_000_000;
      if (changed === 'output price') h.model.prices.outMicroUsdPerMTok = 1_000_000;
      if (changed === 'token limit') h.model.maxTokens = 16_384;
      await expect(durableModelCall(h.db, runId, attemptId, 'rewrite', h.model, { system: 'fixed', user: 'data' }))
        .rejects.toThrow('reservation_configuration_changed');
      expect(h.row.status).toBe('failed');
      expect(h.provider).not.toHaveBeenCalled();
      expect(h.rpc.mock.calls).toEqual([['settle_model_call', { p_call: h.row.id, p_status: 'failed', p_actual_micro_usd: 0 }]]);
    },
  );
  it.each(['run_id', 'attempt_id', 'purpose', 'function'] as const)('refuses a reserved row with mismatched %s without claiming or mutating it', async (field) => {
    const h = harness('reserved');
    if (field === 'function') h.row.function = 'judge';
    else h.row[field] = 'different';
    await expect(durableModelCall(h.db, runId, attemptId, 'rewrite', h.model, { system: 'fixed', user: 'data' }))
      .rejects.toThrow('reservation_identity_mismatch');
    expect(h.row.status).toBe('reserved');
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.provider).not.toHaveBeenCalled();
  });
  it('resumes a matching reserved configuration once when its worst-case cost exactly fits the held amount', async () => {
    const h = harness('reserved');
    // 41 conservatively estimated input tokens + 4096 output tokens at 1000 micro-USD/MTok rounds up to 5.
    h.row.reserved_micro_usd = 5;
    const prompt = { system: 'fixed', user: 'data' };
    await durableModelCall(h.db, runId, attemptId, 'rewrite', h.model, prompt);
    await durableModelCall(h.db, runId, attemptId, 'rewrite', h.model, prompt);
    expect(h.provider).toHaveBeenCalledTimes(1);
    expect(h.provider).toHaveBeenCalledWith({ ...prompt, maxTokens: 4096 });
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(['claim_dispatch', 'settle_model_call']);
  });
  it('replays a settled cached response despite changed provider/model and invalid current prices/token limit', async () => {
    const h = harness('settled');
    h.model.provider = 'openai_compatible';
    h.model.model = 'replacement';
    h.model.prices = { inMicroUsdPerMTok: Number.NaN, outMicroUsdPerMTok: Number.NaN };
    h.model.maxTokens = -1;
    await expect(durableModelCall(h.db, runId, attemptId, 'rewrite', h.model, { system: 'changed', user: 'input' }))
      .resolves.toEqual({ response: reply, callId: h.row.id });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.provider).not.toHaveBeenCalled();
  });
  it.each(['dispatching', 'unknown', 'failed'] as const)('never redispatches a %s call, including a crash after claim', async (status) => {
    const h = harness(status);
    await expect(durableModelCall(h.db, runId, attemptId, 'rewrite', h.model, { system: 'fixed', user: 'data' })).rejects.toThrow();
    expect(h.provider).not.toHaveBeenCalled();
  });
  it('retains a full reservation on provider timeout instead of claiming a proven zero-cost failure', async () => {
    const h = harness();
    h.provider.mockRejectedValueOnce(new Error('timeout'));
    await expect(durableModelCall(h.db, runId, attemptId, 'rewrite', h.model, { system: 'fixed', user: 'data' })).rejects.toThrow('provider_outcome_unknown');
    expect(h.row.status).toBe('unknown');
    expect(h.rpc).toHaveBeenLastCalledWith('settle_model_call', { p_call: h.row.id, p_status: 'unknown' });
  });
  it('rejects forged source hash before freeze/begin/reserve and unknown toggle IDs before paid work', async () => {
    const h = harness();
    const run = runFromRow(runRow());
    await expect(executeRewrite(h.db, run, { run_id: runId, expected_ordinal: 1, request_key: 'rewrite-0001', source_hash: 'f'.repeat(64) }, { rewrite: h.model, judge: null, judgeEnabled: false })).rejects.toThrow('source_hash_mismatch');
    expect(h.rpc).not.toHaveBeenCalled();
    run.toggles = { N999: 'ignored' };
    h.db.rpc = async <T>(_name: string, _args: Row): Promise<T> => ({ ...runRow(), reference_time: '2026-10-24T12:00:00Z', toggles: run.toggles }) as T;
    await expect(executeRewrite(h.db, run, { run_id: runId, expected_ordinal: 1, request_key: 'rewrite-0001', source_hash: await sha256Hex(source) }, { rewrite: h.model, judge: null, judgeEnabled: false })).rejects.toThrow('unknown_toggle_ids');
    expect(h.provider).not.toHaveBeenCalled();
  });
  it('explicit unavailable judge recovery settles crash residue and appends a coverage flag without a paid call', async () => {
    const h = harness('dispatching');
    h.row.purpose = 'judge';
    const row = { ...runRow(), status: 'judging', source_hash: await sha256Hex(source), ledger: [], reference_time: '2026-10-24T12:00:00Z',
      mask_namespace: 'abcdef', checker_version: CHECKER_VERSION, prompt_version: PROMPT_VERSION, mask_version: MASK_VERSION, selected_attempt_id: attemptId };
    const a = attemptRow();
    h.db.attempts = async () => [attemptFromRow(a)];
    const baseRpc = h.db.rpc;
    h.db.rpc = async <T>(name: string, args: Row): Promise<T> => {
      if (name !== 'finish_judging') return baseRpc<T>(name, args);
      a.flags = args.p_flags; a.claim_status = args.p_claim_status; a.judge_coverage = args.p_judge_coverage;
      return { ...row, status: 'review_ready', verdict: 'needs_review' } as T;
    };
    const result = await executeJudge(h.db, runFromRow(row), { run_id: runId, attempt_id: attemptId, request_key: 'judge-0001', finalize_unavailable: true }, { rewrite: h.model, judge: h.model, judgeEnabled: true });
    expect(result.verdict).toBe('needs_review');
    expect(result.flags.some((f) => f.code === 'llm_unavailable')).toBe(true);
    expect(h.row.status).toBe('unknown');
    expect(h.provider).not.toHaveBeenCalled();
  });
  it('uses a bounded deterministic judge identity independent of request_key', () => {
    expect(new Set([0, 1, 2, 3].map((b) => callKey(runId, attemptId, 'judge', b))).size).toBe(4);
    expect(callKey(runId, attemptId, 'judge', 0)).not.toContain('request');
  });
  it('keeps B3 draft, self-check and revision in one attempt, each with separate durable reservation', async () => {
    const h = await runHarness('B3');
    const request = { run_id: runId, expected_ordinal: 1, request_key: 'rewrite-0001', source_hash: await sha256Hex(source) };
    const config = { rewrite: h.model, judge: null, judgeEnabled: false };
    const result = await executeRewrite(h.db, h.run(), request, config);
    expect(h.attempts).toHaveLength(1);
    expect(h.calls.map((c) => c.purpose)).toEqual(['rewrite', 'b3_check', 'b3_revise']);
    expect(h.provider).toHaveBeenCalledTimes(3);
    expect(result.next_ordinal).toBeNull();
    expect(result.call_ids).toHaveLength(3);
    await executeRewrite(h.db, h.run(), request, config);
    expect(h.provider).toHaveBeenCalledTimes(3);
    expect(h.attempts).toHaveLength(1);
  });
  it('builds a B4 retry solely from the previous stored hard flags and frozen ledger', async () => {
    const h = await runHarness('B4');
    const prior = { ...attemptRow(), ordinal: 1, request_key: 'prior-0001', verdict: 'failed',
      flags: [{ id: 'H1', class: 'hard', code: 'copied_sample_run', found: 'stored prior evidence' }] };
    h.attempts.push(prior);
    const run = h.run(); run.status = 'attempting';
    const expected = buildRepairRequest(1, attemptFromRow(prior).flags, run.ledger!, run.maskNamespace);
    await executeRewrite(h.db, run, { run_id: runId, expected_ordinal: 2, request_key: 'rewrite-0002', source_hash: await sha256Hex(source) },
      { rewrite: h.model, judge: null, judgeEnabled: false });
    expect(h.rpc).toHaveBeenCalledWith('begin_attempt', { p_run: runId, p_expected_ordinal: 2, p_request_key: 'rewrite-0002', p_repair_request: expected });
    expect(h.provider.mock.calls[0][0].user).toContain('stored prior evidence');
    expect(h.provider.mock.calls[0][0].system).not.toContain('stored prior evidence');
  });
  it('configuration stays unavailable without actual secrets, model IDs, prices and the live opt-in', () => {
    const env: Record<string, string> = { LIVE_CALLS_ENABLED: 'true', REWRITE_MODEL_ID: 'pinned', ANTHROPIC_API_KEY: 'test-only-placeholder',
      MODEL_PRICE_IN_MICRO_USD_PER_MTOK: '1', MODEL_PRICE_OUT_MICRO_USD_PER_MTOK: '1' };
    expect(readLiveConfig((k) => env[k]).rewrite).not.toBeNull();
    for (const key of Object.keys(env)) expect(readLiveConfig((k) => k === key ? undefined : env[k]).rewrite).toBeNull();
  });
});
