import { describe, expect, it } from 'vitest';
import { buildClaimPairs, contentWords, topK } from '../../../src/lib/claims/align.ts';
import { blankFacts, blankSpan } from '../../../src/lib/claims/blank.ts';
import type { ClaimJudge, ClaimPair } from '../../../src/lib/claims/judge.ts';
import { claimFlagDrafts } from '../../../src/lib/claims/judge.ts';
import { createOverlapJudge } from '../../../src/lib/claims/overlap.ts';
import { llmCoverageDrafts, parseJudgeReply, planBatches, runLlmJudge } from '../../../src/lib/claims/llmJudge.ts';
import type { Fact } from '../../../src/lib/factledger/types.ts';
import { ex } from '../factledger/helpers.ts';

function pair(pairId = 'F1'): ClaimPair {
  return { pairId, direction: 'forward', index: 0, claim: 'The cache handles requests.', claimText: 'The cache handles requests.',
    claimSpan: { start: 0, end: 27 }, context: ['The cache handles requests.'], contextSpans: [{ start: 0, end: 27 }] };
}

describe('bidirectional claim checks', () => {
  it('blanks only number/date spans in both claim and context, preserving entities and offsets', () => {
    const source = 'We sent 12 files on October 24, 2026 to Ada.';
    const sourceLedger = ex(source);
    const rewrite = 'We sent 13 files on October 25, 2026 to Ada.';
    const pairs = buildClaimPairs(source, sourceLedger, rewrite, ex(rewrite));
    const forward = pairs.find((p) => p.direction === 'forward')!;
    expect(forward.claim).toContain('[NUMBER]');
    expect(forward.claim).toContain('[DATE]');
    expect(forward.claim).toContain('Ada');
    expect(forward.claim).not.toContain('13');
    expect(forward.context.join(' ')).not.toContain('2026');
    expect(forward.context.join(' ')).toContain('[DATE]');
    expect(source.slice(sourceLedger[0].start, sourceLedger[0].end)).toBe(sourceLedger[0].raw);
    const reverse = pairs.find((p) => p.direction === 'reverse')!;
    expect(reverse.claim).not.toContain('12');
    expect(reverse.context.join(' ')).toContain('[NUMBER]');
  });

  it('clips blanking to the requested half-open sentence span', () => {
    const text = 'A 123 B';
    const f: Fact = { id: 'N1', kind: 'number', raw: '123', normalised: 'scalar 123', start: 2, end: 5, required: true };
    expect(blankFacts(text, [f])).toBe('A [NUMBER] B');
    expect(blankSpan(text, { start: 3, end: 7 }, [f])).toBe('[NUMBER] B');
  });

  it('chooses top three positive-overlap contexts, with deterministic ties', () => {
    const claim = new Set(['cache', 'handles', 'requests']);
    const candidates = [new Set(['cache']), new Set(['handles', 'requests']), new Set(['unrelated']),
      new Set(['cache', 'handles', 'requests']), new Set(['cache'])];
    expect(topK(claim, candidates)).toEqual([3, 1, 0]);
    expect(contentWords('[NUMBER] [DATE] the may cache')).toEqual(new Set(['cache']));
    const source = 'The cache handles requests. The cache holds entries. The cache serves traffic. The cache stores responses.';
    const pairs = buildClaimPairs(source, ex(source), 'The cache stores entries.', ex('The cache stores entries.'));
    expect(pairs.filter((p) => p.direction === 'forward')).toHaveLength(1);
    expect(pairs.filter((p) => p.direction === 'reverse')).toHaveLength(4);
    expect(pairs[0].context).toHaveLength(3);
    expect(pairs.map((p) => p.pairId)).toEqual(['F1', 'R1', 'R2', 'R3', 'R4']);
  });

  it('flags added and dropped claim sentences with evidence in both directions', async () => {
    const source = 'The cache handles requests. The warehouse floods every winter.';
    const rewrite = 'The cache handles requests. The board accepted the resignation immediately.';
    const pairs = buildClaimPairs(source, ex(source), rewrite, ex(rewrite));
    const judge = createOverlapJudge();
    const flags = claimFlagDrafts(pairs, await judge.judge(pairs), judge.name);
    expect(flags.map((f) => f.code)).toEqual(['added_claim', 'dropped_claim']);
    expect(flags[0]).toMatchObject({ pairId: 'F2', found: 'The board accepted the resignation immediately.' });
    expect(flags[0].rewriteSpan).toBeDefined();
    expect(flags[1].sourceSpan).toBeDefined();
    expect(flags.every((f) => f.evidence?.includes('overlap:'))).toBe(true);
    expect(await judge.judge(buildClaimPairs(source, ex(source), source, ex(source)))).toEqual([]);
  });

  it('allows an independent third judge through the same interface and orders its returned evidence', async () => {
    const pairs = [pair(), { ...pair('R1'), direction: 'reverse' as const }];
    const third: ClaimJudge = {
      name: 'third-test-double',
      judge: async () => [
        { pairId: 'R1', label: 'says_nothing', evidence: 'reverse missing' },
        { pairId: 'F1', label: 'contradicts', evidence: 'forward conflict' },
      ],
    };
    const before = JSON.stringify(pairs);
    const drafts = claimFlagDrafts(pairs, await third.judge(pairs), third.name);
    expect(drafts.map((f) => [f.pairId, f.code])).toEqual([['F1', 'contradicted_claim'], ['R1', 'dropped_claim']]);
    expect(JSON.stringify(pairs)).toBe(before);
  });
});

describe('strict LLM reply seam and coverage', () => {
  it('rejects extra fields, invalid labels, duplicate and unknown pairs; omitted pairs remain unjudged', () => {
    expect(parseJudgeReply('{"results":[{"pair_id":"F1","label":"supports"}]}', ['F1'])).toMatchObject({ ok: true, missing: [] });
    expect(parseJudgeReply('{"results":[]}', ['F1'])).toMatchObject({ ok: true, missing: ['F1'] });
    for (const text of [
      '{"results":[],"pass":true}', '{"results":[{"pair_id":"F1","label":"maybe"}]}',
      '{"results":[{"pair_id":"X1","label":"supports"}]}',
      '{"results":[{"pair_id":"F1","label":"supports"},{"pair_id":"F1","label":"supports"}]}',
    ]) expect(parseJudgeReply(text, ['F1']).ok).toBe(false);
  });

  it('caps the plan at 4 batches of 30 and refuses overrides that could bypass or hang the cap', () => {
    const pairs = Array.from({ length: 121 }, (_, i) => pair(`F${i + 1}`));
    const plan = planBatches(pairs);
    expect(plan.batches.map((b) => b.length)).toEqual([30, 30, 30, 30]);
    expect(plan.uncovered.map((p) => p.pairId)).toEqual(['F121']);
    for (const args of [[0, 4], [31, 4], [30, 5], [1.5, 4], [30, 0]]) {
      expect(() => planBatches(pairs, args[0], args[1])).toThrow();
    }
  });

  it('does not silently call incomplete or failed judging complete', async () => {
    const pairs = [pair('F1'), pair('F2')];
    const partial = await runLlmJudge(pairs, async () => ({ text: '{"results":[{"pair_id":"F1","label":"says_nothing"}]}',
      provider: 'mock', model: 'test', inputTokens: null, outputTokens: null }));
    expect(partial).toMatchObject({ coverage: { judged: 1, total: 2 }, claimStatus: 'truncated' });
    expect(llmCoverageDrafts(partial)[0].code).toBe('truncated');
    const failed = await runLlmJudge(pairs, async () => { throw new Error('not configured'); });
    expect(failed).toMatchObject({ coverage: { judged: 0, total: 2 }, claimStatus: 'llm_unavailable' });
    expect(llmCoverageDrafts(failed)[0].code).toBe('llm_unavailable');
  });
});
