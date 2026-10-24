// GENERATED from src/lib/server/judge.ts; edit the source and run npm run sync:functions.
import { JudgeResponseSchema } from '../../contracts/api.ts';
import type { JudgeRequest, JudgeResponse } from '../../contracts/api.ts';
import type { ClaimStatus, Flag, Run } from '../../contracts/run.ts';
import { numberFlags } from '../checks/flags.ts';
import { extract } from '../factledger/extract.ts';
import { buildClaimPairs } from '../claims/align.ts';
import { claimFlagDrafts } from '../claims/judge.ts';
import type { ClaimFlag } from '../claims/judge.ts';
import { claimStatusOf, llmCoverageDrafts, parseJudgeReply, planBatches } from '../claims/llmJudge.ts';
import { buildJudgePrompt } from '../prompts/judgePrompt.ts';
import { frozenStepRun } from './rewrite.ts';
import { runFromRow } from './codec.ts';
import { durableModelCall } from './modelCall.ts';
import { EdgeError, edgeError } from './types.ts';
import type { LiveConfig, Row, ServiceGateway } from './types.ts';

export async function executeJudge(db: ServiceGateway, run: Run, request: JudgeRequest, config: LiveConfig): Promise<JudgeResponse> {
  if (run.selectedAttemptId !== request.attempt_id) throw new EdgeError(409, 'not_selected_attempt');
  const attempt = (await db.attempts(run.id)).find((a) => a.id === request.attempt_id);
  if (!attempt || attempt.state !== 'complete' || attempt.outputText === null) throw new EdgeError(409, 'attempt_not_complete');
  // Replay already-sealed evidence without changing it or calling a model.
  if (run.status === 'review_ready' && attempt.claimStatus !== 'overlap_only' && attempt.judgeCoverage) {
    return JudgeResponseSchema.parse({ flags: attempt.flags, coverage: attempt.judgeCoverage, verdict: run.verdict,
      run_status: run.status, call_ids: (await db.calls(run.id, attempt.id)).filter((c) => c.purpose === 'judge').map((c) => c.id) });
  }
  if (run.status !== 'judging') throw new EdgeError(409, 'run_not_judging');
  if (!request.finalize_unavailable && !config.judge) throw new EdgeError(503, 'provider_not_configured');
  const frozen = frozenStepRun(run);
  const rewriteLedger = extract(attempt.outputText, { referenceTime: new Date(frozen.referenceTime),
    protectedTerms: frozen.protectedTerms, aliases: frozen.aliases });
  const pairs = buildClaimPairs(frozen.sourceText, frozen.ledger, attempt.outputText, rewriteLedger);
  const { batches } = planBatches(pairs); // hard per-run ceiling: deterministic keys 0..3 regardless of request_key
  const flags: ClaimFlag[] = [];
  let judged = 0;
  let unavailable = !!request.finalize_unavailable || !config.judge;
  let operationalError: EdgeError | null = null;
  if (request.finalize_unavailable) {
    // Explicit no-call recovery. Conservatively terminate any crash residue; never redispatch it.
    for (const c of await db.calls(run.id, attempt.id)) {
      if (c.purpose !== 'judge') continue;
      if (c.status === 'reserved') await db.rpc('settle_model_call', { p_call: c.id, p_status: 'failed', p_actual_micro_usd: 0 });
      if (c.status === 'dispatching') await db.rpc('settle_model_call', { p_call: c.id, p_status: 'unknown' });
    }
  } else if (config.judge) {
    for (const [index, batch] of batches.entries()) {
      try {
        const call = await durableModelCall(db, run.id, attempt.id, 'judge', config.judge, buildJudgePrompt(batch), index);
        const parsed = parseJudgeReply(call.response.text, batch.map((p) => p.pairId));
        if (!parsed.ok) { unavailable = true; continue; }
        for (const pair of batch) {
          const label = parsed.labels.get(pair.pairId);
          if (label === undefined) { unavailable = true; continue; }
          judged++;
          if (label !== 'supports') flags.push({ pairId: pair.pairId, label, evidence: `model label "${label}"` });
        }
      } catch (error) {
        // An active concurrent/crashed dispatch requires retry or explicit finalize_unavailable; cannot seal yet.
        const pending = (await db.calls(run.id, attempt.id)).some((c) => c.purpose === 'judge' && (c.status === 'reserved' || c.status === 'dispatching'));
        if (pending) throw error;
        unavailable = true;
        operationalError = edgeError(error);
        // Budget/provider errors stop additional paid batches; partial coverage is preserved.
        break;
      }
    }
  }
  const coverage = { judged, total: pairs.length };
  let claimStatus: ClaimStatus = claimStatusOf(coverage);
  if (unavailable && judged === 0) claimStatus = 'llm_unavailable';
  const additions: Flag[] = numberFlags([
    ...claimFlagDrafts(pairs, flags, 'llm'), ...llmCoverageDrafts({ coverage, claimStatus }),
  ], attempt.flags);
  const sealed = runFromRow(await db.rpc<Row>('finish_judging', {
    p_run: run.id, p_attempt: attempt.id, p_flags: additions, p_claim_status: claimStatus,
    p_judge_coverage: coverage, p_error: unavailable ? 'llm_unavailable' : null,
  }));
  const selected = (await db.attempts(run.id)).find((a) => a.id === attempt.id);
  if (!selected) throw new EdgeError(409, 'attempt_not_found');
  // The evidence is safely sealed, but transport still reports a budget/provider refusal as an error.
  if (operationalError) throw operationalError;
  return JudgeResponseSchema.parse({ flags: selected.flags, coverage: selected.judgeCoverage, verdict: sealed.verdict,
    run_status: sealed.status, call_ids: (await db.calls(run.id, attempt.id)).filter((c) => c.purpose === 'judge').map((c) => c.id) });
}
