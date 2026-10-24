import type { RewriteRequest, RewriteResponse } from '../../contracts/api.ts';
import { RewriteResponseSchema } from '../../contracts/api.ts';
import type { Attempt, Run } from '../../contracts/run.ts';
import { CHECKER_VERSION } from '../checks/index.ts';
import { validateInputs } from '../checks/limits.ts';
import { extract, unknownToggleIds } from '../factledger/extract.ts';
import { MASK_VERSION, deriveNamespace } from '../mask/namespace.ts';
import { mask } from '../mask/mask.ts';
import { PROMPT_VERSION } from '../prompts/version.ts';
import { buildRewritePrompt } from '../prompts/rewritePrompt.ts';
import { buildB2Prompt } from '../prompts/b2Prompt.ts';
import { buildB3DraftPrompt, buildB3SelfCheckPrompt, buildB3RevisionPrompt } from '../prompts/b3Prompts.ts';
import { parseRewriteOutput, parseSelfCheckOutput } from '../providers/parse.ts';
import { describeProfile, profile } from '../style/profile.ts';
import { buildRepairRequest } from '../loop/repairRequest.ts';
import { step } from '../loop/step.ts';
import type { StepRun } from '../loop/step.ts';
import { sha256Hex } from '../text/hash.ts';
import { attemptFromRow, runFromRow } from './codec.ts';
import { durableModelCall } from './modelCall.ts';
import { EdgeError, edgeError } from './types.ts';
import type { LiveConfig, Row, ServiceGateway } from './types.ts';

export function frozenStepRun(run: Run): StepRun {
  if (!run.ledger || !run.sourceHash || !run.referenceTime || !run.checkerVersion || !run.promptVersion || !run.maskVersion) {
    throw new EdgeError(409, 'inputs_not_frozen');
  }
  if (run.checkerVersion !== CHECKER_VERSION || run.promptVersion !== PROMPT_VERSION || run.maskVersion !== MASK_VERSION) {
    throw new EdgeError(409, 'run_version_unavailable');
  }
  return {
    system: run.system, sourceText: run.sourceText, samples: run.samples, ledger: run.ledger,
    referenceTime: run.referenceTime, protectedTerms: run.protectedTerms, aliases: run.aliases,
    maskNamespace: run.maskNamespace,
  };
}
function response(run: Run, attempt: Attempt, callIds: string[]): RewriteResponse {
  if (attempt.state !== 'complete' || attempt.outputText === null || !attempt.contentHash || !attempt.verdict) {
    throw new EdgeError(409, attempt.error ?? 'attempt_not_complete');
  }
  const retry = run.status === 'attempting' && run.system === 'B4' && attempt.ordinal < 3 && attempt.flags.some((f) => f.class === 'hard');
  return RewriteResponseSchema.parse({
    attempt_id: attempt.id, ordinal: attempt.ordinal, rewrite: attempt.outputText, content_hash: attempt.contentHash,
    flags: attempt.flags, verdict: attempt.verdict, run_status: run.status,
    next_ordinal: retry ? attempt.ordinal + 1 : null, call_ids: callIds,
  });
}
async function maybeFinish(db: ServiceGateway, run: Run, attempt: Attempt, config: LiveConfig): Promise<Run> {
  if (run.status !== 'attempting') return run;
  if (run.system !== 'B4' || attempt.ordinal === 3 || !attempt.flags.some((f) => f.class === 'hard')) {
    return runFromRow(await db.rpc<Row>('finish_attempts', { p_run: run.id, p_judge_enabled: config.judgeEnabled }));
  }
  return run;
}
/** Called only with a run read through the verified user's JWT. No client-supplied evidence reaches a write. */
export async function executeRewrite(db: ServiceGateway, ownedRun: Run, request: RewriteRequest, config: LiveConfig): Promise<RewriteResponse> {
  let run = ownedRun;
  if (run.mode === 'demo') throw new EdgeError(422, 'live_runs_require_live_mode');
  const issues = validateInputs(run.sourceText, run.samples);
  if (issues.length) throw new EdgeError(422, 'invalid_stored_inputs');
  if (!run.toggles || Object.values(run.toggles).some((v) => v !== 'required' && v !== 'ignored') ||
      !Array.isArray(run.protectedTerms) || run.protectedTerms.some((v) => typeof v !== 'string' || !v.trim()) ||
      !run.aliases || Object.entries(run.aliases).some(([term, aliases]) => !term.trim() || !Array.isArray(aliases) || aliases.some((v) => typeof v !== 'string' || !v.trim()))) {
    throw new EdgeError(422, 'invalid_stored_inputs');
  }
  if (await sha256Hex(run.sourceText) !== request.source_hash) throw new EdgeError(409, 'source_hash_mismatch');
  // B1 is computed in the eval harness, without a model call; it is not a server rewrite request.
  if (run.system === 'B1') throw new EdgeError(422, 'computed_baseline_local_only');
  const existing = (await db.attempts(run.id)).find((a) => a.requestKey === request.request_key);
  if (existing && existing.ordinal !== request.expected_ordinal) throw new EdgeError(409, 'request_key_conflict');
  if (existing?.state === 'complete') {
    run = await maybeFinish(db, run, existing, config);
    return response(run, (await db.attempts(run.id)).find((a) => a.id === existing.id) ?? existing,
      (await db.calls(run.id, existing.id)).map((c) => c.id));
  }
  if (existing && existing.state !== 'in_flight') throw new EdgeError(409, existing.error ?? 'attempt_unavailable');
  if (run.status !== 'open' && run.status !== 'attempting') throw new EdgeError(409, 'run_not_attempting');
  if (run.system !== 'B0' && !config.rewrite) throw new EdgeError(503, 'provider_not_configured');
  if (run.ledger === null) {
    if (request.expected_ordinal !== 1) throw new EdgeError(409, 'inputs_not_frozen');
    // The first RPC allocates the DB clock once. Never use a client timestamp or the Edge host clock.
    run = runFromRow(await db.rpc<Row>('freeze_run_inputs', { p_run: run.id }));
    if (!run.referenceTime) throw new EdgeError(409, 'reference_time_missing');
    const ledger = extract(run.sourceText, {
      referenceTime: new Date(run.referenceTime), protectedTerms: run.protectedTerms, aliases: run.aliases, toggles: run.toggles,
    });
    if (unknownToggleIds(ledger, run.toggles).length) throw new EdgeError(422, 'unknown_toggle_ids');
    const namespace = run.system === 'B4' ? (await deriveNamespace(run.id, [run.sourceText, ...run.samples])).namespace : null;
    run = runFromRow(await db.rpc<Row>('freeze_run_inputs', {
      p_run: run.id, p_source_hash: await sha256Hex(run.sourceText), p_ledger: ledger,
      p_mask_namespace: namespace, p_reference_time: run.referenceTime,
      p_checker_version: CHECKER_VERSION, p_prompt_version: PROMPT_VERSION, p_mask_version: MASK_VERSION,
    }));
  }
  if (run.sourceHash !== request.source_hash) throw new EdgeError(409, 'source_hash_mismatch');
  const frozen = frozenStepRun(run);
  const previous = (await db.attempts(run.id)).find((a) => a.ordinal === request.expected_ordinal - 1);
  // Repair provenance comes only from persisted prior hard flags. begin_attempt enforces completeness/ordering.
  const repair = previous ? buildRepairRequest(previous.ordinal, previous.flags, frozen.ledger, frozen.maskNamespace) : null;
  const attempt = attemptFromRow(await db.rpc<Row>('begin_attempt', {
    p_run: run.id, p_expected_ordinal: request.expected_ordinal, p_request_key: request.request_key, p_repair_request: repair,
  }));
  try {
    const prof = profile(frozen.samples);
    const call = async (purpose: 'rewrite' | 'b3_check' | 'b3_revise', messages: { system: string; user: string }): Promise<string> => {
      if (!config.rewrite) throw new EdgeError(503, 'provider_not_configured');
      return (await durableModelCall(db, run.id, attempt.id, purpose, config.rewrite, messages)).response.text;
    };
    const parseRewrite = (raw: string): string => {
      const result = parseRewriteOutput(raw);
      if (!result.ok) throw new EdgeError(502, 'invalid_model_output');
      return result.value.rewrite;
    };
    let output: string;
    if (run.system === 'B0') output = frozen.sourceText;
    else if (run.system === 'B3') {
      const draft = parseRewrite(await call('rewrite', buildB3DraftPrompt({ source: frozen.sourceText, samples: frozen.samples })));
      const checked = parseSelfCheckOutput(await call('b3_check', buildB3SelfCheckPrompt({ source: frozen.sourceText, draft })));
      if (!checked.ok) throw new EdgeError(502, 'invalid_model_output');
      output = parseRewrite(await call('b3_revise', buildB3RevisionPrompt({ source: frozen.sourceText, samples: frozen.samples, draft, issues: checked.value.issues })));
    } else if (run.system === 'B2') {
      output = parseRewrite(await call('rewrite', buildB2Prompt({ source: frozen.sourceText, samples: frozen.samples })));
    } else {
      output = parseRewrite(await call('rewrite', buildRewritePrompt({
        maskedSource: mask(frozen.sourceText, frozen.ledger, frozen.maskNamespace as string).masked,
        excerpts: prof.excerpts, styleSummary: describeProfile(prof), repair: attempt.repairRequest,
      })));
    }
    const result = await step({ run: frozen, ordinal: attempt.ordinal, output, profile: prof });
    const completed = attemptFromRow(await db.rpc<Row>('complete_attempt', {
      p_attempt: attempt.id, p_output_text: result.text, p_content_hash: result.contentHash, p_flags: result.flags,
      p_verdict: result.verdict, p_claim_status: result.claimStatus, p_judge_coverage: null,
      p_style_distance: result.style.value, p_style_reason: result.style.reason,
    }));
    run = await maybeFinish(db, await db.run(run.id), completed, config);
    const shown = (await db.attempts(run.id)).find((a) => a.id === completed.id) ?? completed;
    return response(run, shown, (await db.calls(run.id, attempt.id)).map((c) => c.id));
  } catch (error) {
    const e = edgeError(error);
    // Another handler can own an active dispatch or have completed the attempt. Never fail its work.
    const current = (await db.attempts(run.id)).find((a) => a.id === attempt.id);
    if (current?.state === 'complete') return response(await db.run(run.id), current, (await db.calls(run.id, attempt.id)).map((c) => c.id));
    const pending = (await db.calls(run.id, attempt.id)).some((c) => c.status === 'reserved' || c.status === 'dispatching');
    if (pending || e.code === 'model_call_in_progress') throw e;
    await db.rpc('fail_attempt', { p_attempt: attempt.id, p_state: e.code.includes('unknown') ? 'unknown' : 'call_failed', p_error: e.code });
    await db.rpc('finish_attempts', { p_run: run.id, p_judge_enabled: false, p_error: e.code });
    throw e;
  }
}
