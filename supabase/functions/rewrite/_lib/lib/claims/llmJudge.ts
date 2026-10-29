// GENERATED from src/lib/claims/llmJudge.ts; edit the source and run npm run sync:functions.
// Optional `llm` claim judge: batching, strict response parsing and coverage accounting around an injected
// ModelCaller (no network code here; the edge function supplies the caller and reserves each batch in the call
// ledger). <= 30 pairs per batch, <= 4 batches (120 pairs); pairs beyond that, pairs missing from a reply and pairs of
// a failed batch are unjudged -> claim_status 'truncated' (some judged) or 'llm_unavailable' (none judged).
// The parser does not depend on the prompt wording.

import type { ClaimStatus, Coverage, FlagDraft } from '../../contracts/run.ts';
import type { ModelCaller, ModelResponse, PromptMessages } from '../providers/types.ts';
import { parseJudgeModelOutput } from '../providers/parse.ts';
import { buildJudgePrompt } from '../prompts/judgePrompt.ts';
import type { ClaimFlag, ClaimJudge, ClaimLabel, ClaimPair } from './judge.ts';
import { LLM_MAX_BATCHES, LLM_MAX_PAIRS_PER_BATCH } from './thresholds.ts';

export interface LlmJudgeOptions {
  maxPairsPerBatch?: number;
  maxBatches?: number;
  maxTokens?: number;
  buildPrompt?: (pairs: readonly ClaimPair[]) => PromptMessages;
}

export interface LlmJudgeResult {
  flags: ClaimFlag[];
  coverage: Coverage;
  claimStatus: ClaimStatus;
  errors: string[];
  calls: ModelResponse[];
}

export type JudgeParse = { ok: true; labels: Map<string, ClaimLabel>; missing: string[] } | { ok: false; error: string };

export function planBatches(pairs: readonly ClaimPair[], maxPerBatch = LLM_MAX_PAIRS_PER_BATCH, maxBatches = LLM_MAX_BATCHES): { batches: ClaimPair[][]; uncovered: ClaimPair[] } {
  // Overrides can reduce coverage for tests or budget reasons; they cannot bypass the product's hard ceiling.
  if (!Number.isInteger(maxPerBatch) || maxPerBatch < 1 || maxPerBatch > LLM_MAX_PAIRS_PER_BATCH ||
      !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > LLM_MAX_BATCHES) {
    throw new Error('judge batches require 1..30 pairs and 1..4 batches');
  }
  const covered = pairs.slice(0, maxPerBatch * maxBatches);
  const batches: ClaimPair[][] = [];
  for (let i = 0; i < covered.length; i += maxPerBatch) batches.push(covered.slice(i, i + maxPerBatch));
  return { batches, uncovered: pairs.slice(covered.length) };
}

/** Strict parse of one batch reply: unknown or duplicated pair ids reject the whole batch; omitted ids are unjudged. */
export function parseJudgeReply(text: string, batchPairIds: readonly string[]): JudgeParse {
  const parsed = parseJudgeModelOutput(text);
  if (!parsed.ok) return { ok: false, error: `${parsed.error}: ${parsed.detail}` };
  const expected = new Set(batchPairIds);
  const labels = new Map<string, ClaimLabel>();
  for (const r of parsed.value.results) {
    if (!expected.has(r.pair_id)) return { ok: false, error: `unknown pair_id ${r.pair_id}` };
    if (labels.has(r.pair_id)) return { ok: false, error: `duplicate pair_id ${r.pair_id}` };
    labels.set(r.pair_id, r.label);
  }
  return { ok: true, labels, missing: batchPairIds.filter((id) => !labels.has(id)) };
}

export function claimStatusOf(coverage: Coverage): ClaimStatus {
  if (coverage.judged === coverage.total) return 'llm_done';
  return coverage.judged === 0 ? 'llm_unavailable' : 'truncated';
}

export async function runLlmJudge(pairs: readonly ClaimPair[], callModel: ModelCaller, opts: LlmJudgeOptions = {}): Promise<LlmJudgeResult> {
  const { batches } = planBatches(pairs, opts.maxPairsPerBatch, opts.maxBatches);
  const build = opts.buildPrompt ?? buildJudgePrompt;
  const flags: ClaimFlag[] = [];
  const errors: string[] = [];
  const calls: ModelResponse[] = [];
  let judged = 0;
  for (const [b, batch] of batches.entries()) {
    const messages = build(batch);
    let reply: ModelResponse;
    try {
      reply = await callModel({ ...messages, maxTokens: opts.maxTokens });
    } catch (e) {
      errors.push(`batch ${b + 1}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    calls.push(reply);
    const parsed = parseJudgeReply(reply.text, batch.map((p) => p.pairId));
    if (!parsed.ok) {
      errors.push(`batch ${b + 1}: ${parsed.error}`);
      continue;
    }
    if (parsed.missing.length > 0) errors.push(`batch ${b + 1}: no label for ${parsed.missing.join(', ')}`);
    for (const p of batch) {
      const label = parsed.labels.get(p.pairId);
      if (label === undefined) continue;
      judged++;
      if (label !== 'supports') flags.push({ pairId: p.pairId, label, evidence: `model label "${label}"` });
    }
  }
  const coverage = { judged, total: pairs.length };
  return { flags, coverage, claimStatus: claimStatusOf(coverage), errors, calls };
}

/** Coverage flags (class 'coverage') appended after the llm claim flags. */
export function llmCoverageDrafts(result: Pick<LlmJudgeResult, 'coverage' | 'claimStatus'>): FlagDraft[] {
  const { judged, total } = result.coverage;
  if (result.claimStatus === 'llm_unavailable') {
    return [{ class: 'coverage', code: 'llm_unavailable', found: `judged 0 of ${total} sentence pairs`, evidence: 'the LLM claim judge produced no usable result' }];
  }
  if (result.claimStatus === 'truncated') {
    return [{ class: 'coverage', code: 'truncated', found: `judged ${judged} of ${total} sentence pairs`, evidence: 'some sentence pairs were not judged by the LLM claim judge' }];
  }
  return [];
}

/** ClaimJudge wrapper; `last` keeps the coverage of the most recent call. */
export function createLlmJudge(callModel: ModelCaller, opts: LlmJudgeOptions = {}): ClaimJudge & { last: LlmJudgeResult | null } {
  const judge = {
    name: 'llm',
    last: null as LlmJudgeResult | null,
    async judge(pairs: readonly ClaimPair[]): Promise<ClaimFlag[]> {
      const result = await runLlmJudge(pairs, callModel, opts);
      judge.last = result;
      return result.flags;
    },
  };
  return judge;
}
