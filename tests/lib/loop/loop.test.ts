import { describe, expect, it, vi } from 'vitest';
import type { Flag } from '../../../src/contracts/run.ts';
import { prepareRun } from '../../../src/lib/loop/prepare.ts';
import { MAX_ATTEMPTS, runPipeline } from '../../../src/lib/loop/runPipeline.ts';
import { buildRepairRequest, renderRepairRequest } from '../../../src/lib/loop/repairRequest.ts';
import { selectAttempt } from '../../../src/lib/loop/select.ts';
import { step } from '../../../src/lib/loop/step.ts';
import { verdictOf } from '../../../src/lib/loop/verdict.ts';
import { ScriptedRewriter, MockRecordingMissing } from '../../../src/lib/providers/mock.ts';
import type { ScriptEntry } from '../../../src/lib/providers/mock.ts';
import type { ModelResponse, RewriteCall } from '../../../src/lib/providers/types.ts';
import { ProviderError } from '../../../src/lib/providers/types.ts';
import { ex } from '../factledger/helpers.ts';

const SOURCE = 'The cache served 12 requests.';
const REF = '2026-10-24T12:00:00.000Z';
const prepared = () => prepareRun({ system: 'B4', sourceText: SOURCE, samples: ['Keep notes short.'],
  referenceTime: REF, seedId: 'loop-test', sourceId: 'loop', voiceId: 'terse' });

function scripted(outputs: string[]) {
  const entries: ScriptEntry[] = outputs.map((rewrite, i) => ({ system: 'B4', source_id: 'loop', voice_id: 'terse',
    attempt: i + 1, phase: 'rewrite', output: { rewrite } }));
  const inner = new ScriptedRewriter(entries);
  const call = vi.fn((req: RewriteCall) => inner.call(req));
  return { rewriter: { name: inner.name, call }, model: 'mock-test', call };
}

describe('bounded pipeline', () => {
  it('passes on attempt one, with no repair or extra call', async () => {
    const deps = scripted([SOURCE]);
    const result = await runPipeline(await prepared(), deps);
    expect(result).toMatchObject({ selectedOrdinal: 1, verdict: 'pass', error: null, modelCalls: 1 });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].repairRequest).toBeNull();
    expect(deps.call).toHaveBeenCalledTimes(1);
  });

  it('repairs one hard failure then passes, using only stored hard failures', async () => {
    const deps = scripted(['The cache served requests.', SOURCE]);
    const result = await runPipeline(await prepared(), deps);
    expect(result).toMatchObject({ selectedOrdinal: 2, verdict: 'pass', modelCalls: 2 });
    const repair = result.attempts[1].repairRequest!;
    const hard = result.attempts[0].result!.flags.filter((f) => f.class === 'hard');
    expect(repair.items.map((i) => i.flagId)).toEqual(hard.map((f) => f.id));
    expect(repair.items[0]).toMatchObject({ code: 'missing_fact', factId: 'N1', value: '12' });
    expect(deps.call.mock.calls[1][0].messages.user).toContain(renderRepairRequest(repair));
  });

  it('ends failed after three hard failures and never makes a fourth call', async () => {
    const deps = scripted(['The cache served requests.', 'The cache served requests.', 'The cache served requests.']);
    const result = await runPipeline(await prepared(), deps);
    expect(MAX_ATTEMPTS).toBe(3);
    expect(result).toMatchObject({ verdict: 'failed', modelCalls: 3, error: null });
    expect(result.attempts.map((a) => a.ordinal)).toEqual([1, 2, 3]);
    expect(deps.call).toHaveBeenCalledTimes(3);
    expect(deps.call.mock.calls.map(([r]) => r.key.attempt)).toEqual([1, 2, 3]);
  });

  it('shows an earlier better attempt rather than the last attempt', async () => {
    const deps = scripted(['The cache served requests.', 'The cache served 99 requests.', 'The cache served 99 requests.']);
    const result = await runPipeline(await prepared(), deps);
    expect(result.selectedOrdinal).toBe(1);
    expect(result.attempts[0].result!.flags.filter((f) => f.class === 'hard')).toHaveLength(1);
    expect(result.attempts[2].result!.flags.filter((f) => f.class === 'hard')).toHaveLength(2);
  });

  it('stops on provider errors without a success verdict or a transport retry', async () => {
    const call = vi.fn(async (): Promise<ModelResponse> => { throw new ProviderError('timeout', 'timeout'); });
    const result = await runPipeline(await prepared(), { rewriter: { name: 'failing', call }, model: 'test' });
    expect(result).toMatchObject({ selectedOrdinal: null, verdict: null, error: 'provider_error:timeout', modelCalls: 1 });
    expect(result.attempts[0]).toMatchObject({ state: 'call_failed', result: null });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('retains an earlier hard-failed candidate and appends visible operational coverage after an error', async () => {
    const inner = scripted(['The cache served requests.']);
    const call = vi.fn((req: RewriteCall) => req.key.attempt === 1 ? inner.rewriter.call(req) : Promise.reject(new ProviderError('http_error', 'budget refused', 429)));
    const result = await runPipeline(await prepared(), { rewriter: { name: 'partial', call }, model: 'test' });
    expect(result).toMatchObject({ selectedOrdinal: 1, verdict: 'failed', error: 'provider_error:http_error', modelCalls: 2 });
    expect(result.attempts[0].result!.flags).toContainEqual(expect.objectContaining({ id: 'G1', class: 'coverage', code: 'operational_incomplete' }));
    expect(result.attempts[0].result!.verdict).toBe(result.verdict);
  });

  it('fails closed on malformed JSON and rethrows missing recordings loudly', async () => {
    const run = await prepared();
    const rewriter = { name: 'bad', call: async (): Promise<ModelResponse> => ({ text: '{"rewrite":"ok","pass":true}',
      provider: 'mock', model: 'test', inputTokens: null, outputTokens: null }) };
    expect(await runPipeline(run, { rewriter, model: 'test' })).toMatchObject({ verdict: null, error: 'invalid_model_output:schema_mismatch' });
    await expect(runPipeline(run, { rewriter: new ScriptedRewriter([]), model: 'test' })).rejects.toBeInstanceOf(MockRecordingMissing);
  });

  it('keeps step deterministic without mutating frozen inputs, and accepts a third-judge double', async () => {
    const run = await prepared();
    const before = JSON.stringify(run);
    for (const fact of run.ledger) Object.freeze(fact);
    Object.freeze(run.ledger);
    Object.freeze(run.samples);
    Object.freeze(run);
    const a = await step({ run, ordinal: 1, output: SOURCE });
    expect(await step({ run, ordinal: 1, output: SOURCE })).toEqual(a);
    expect(JSON.stringify(run)).toBe(before);
    const judged = await step({ run, ordinal: 1, output: SOURCE, claimJudge: { name: 'third', judge: async (pairs) => [
      { pairId: pairs[0].pairId, label: 'contradicts', evidence: 'independent third-judge finding' },
    ] } });
    expect(judged.verdict).toBe('needs_review');
    expect(judged.flags).toContainEqual(expect.objectContaining({ id: 'C1', class: 'claim', code: 'contradicted_claim' }));
  });

  // Regression: globally balanced negation/modal counts used to pass when a merge or split moved operators to another claim.
  it.each([
    { operation: 'merge', sourceText: 'We must not ship the patch.\n\nWe may publish the notes.',
      output: 'We may ship the patch. We must not publish the notes.' },
    { operation: 'split', sourceText: 'We must not ship the patch. We may publish the notes.',
      output: 'We may ship the patch.\n\nWe must not publish the notes.' },
  ])('requires review after a paragraph $operation moves negation and modal strength between claims', async ({ operation, sourceText, output }) => {
    const run = await prepareRun({ system: 'B4', sourceText, samples: ['Keep notes short.'],
      referenceTime: REF, seedId: `paragraph-${operation}` });
    const result = await step({ run, ordinal: 1, output });
    expect(result.verdict).toBe('needs_review');
    expect(result.flags.filter((f) => f.class === 'hard')).toEqual([]);
    expect(result.flags).toContainEqual(expect.objectContaining({
      id: 'S1', class: 'soft', code: 'paragraph_alignment_uncertain',
      sourceSpan: { start: 0, end: sourceText.length }, rewriteSpan: { start: 0, end: output.length },
    }));
  });

  it('validates raw inputs and unknown frozen toggles before creating the run', async () => {
    await expect(prepareRun({ system: 'B4', sourceText: '', samples: ['sample'], referenceTime: REF, seedId: 'invalid' })).rejects.toThrow('invalid_inputs');
    await expect(prepareRun({ system: 'B4', sourceText: SOURCE, samples: ['sample'], referenceTime: REF, seedId: 'invalid', toggles: { N99: 'ignored' } })).rejects.toThrow('unknown fact');
  });
});

describe('verdict, selection, repair invariants', () => {
  const flag = (cls: Flag['class'], id = 'C1'): Flag => ({ id, class: cls, code: 'test', found: 'evidence' });

  it('cannot pass with a claim or incomplete requested judging, and never removes hard failures', () => {
    expect(verdictOf([])).toBe('pass');
    for (const cls of ['soft', 'claim', 'coverage'] as const) expect(verdictOf([flag(cls)])).toBe('needs_review');
    expect(verdictOf([], 'llm_unavailable')).toBe('needs_review');
    expect(verdictOf([], 'truncated')).toBe('needs_review');
    expect(verdictOf([flag('hard')], 'llm_done')).toBe('failed');
  });

  it('selects hard count, then advisory count, then earliest ordinal; ignores unfinished attempts', () => {
    const choices = [
      { ordinal: 3, state: 'complete' as const, flags: [flag('hard'), flag('claim')] },
      { ordinal: 2, state: 'complete' as const, flags: [flag('hard')] },
      { ordinal: 1, state: 'complete' as const, flags: [flag('hard')] },
      { ordinal: 4, state: 'call_failed' as const, flags: [] },
    ];
    expect(selectAttempt(choices)?.ordinal).toBe(1);
    expect(selectAttempt(choices.slice(0, 2))?.ordinal).toBe(2);
    expect(selectAttempt([{ ordinal: 1, state: 'in_flight', flags: [] }])).toBeNull();
  });

  it('builds repair solely from hard flags and protects masked source values', () => {
    const source = 'The operator wrote “keep the literal words”.';
    const ledger = ex(source);
    const quote = ledger.find((f) => f.kind === 'quote')!;
    const repair = buildRepairRequest(1, [
      { id: 'H1', class: 'hard', code: 'placeholder_missing', factId: quote.id, kind: 'quote', found: 'absent' },
      { id: 'S1', class: 'soft', code: 'modal_drift', found: 'must to may' },
      { id: 'C1', class: 'claim', code: 'added_claim', found: 'model critique cannot repair facts' },
    ], ledger, 'abc123')!;
    expect(repair.items).toHaveLength(1);
    expect(repair.items[0].value).toBe('⟦abc123:Q1⟧');
    expect(renderRepairRequest(repair)).not.toContain('keep the literal words');
    expect(buildRepairRequest(1, [flag('claim')], ledger, 'abc123')).toBeNull();
  });
});
