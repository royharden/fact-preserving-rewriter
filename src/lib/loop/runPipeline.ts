// runPipeline(): the offline loop (mock demo, tests, mock eval). B4 runs ordinals 1..MAX_ATTEMPTS, stopping at the
// first attempt with no hard flag; each retry carries a repair request built by code from the previous attempt's hard
// flags. B0 (unchanged source) and B1 (rule restyler, injected) make no model call; B2 makes one; B3 makes three
// (draft, self-check, revision) inside its single attempt. A provider error or an unparseable model reply ends the
// loop with an error and is never `pass`; a missing mock output (MockRecordingMissing) is rethrown loudly.

import type { AttemptState, RepairRequest, Verdict } from '../../contracts/run.ts';
import type { ClaimJudge } from '../claims/judge.ts';
import { appendFlags } from '../checks/flags.ts';
import { mask } from '../mask/mask.ts';
import type { ParseResult } from '../providers/parse.ts';
import { parseRewriteOutput, parseSelfCheckOutput } from '../providers/parse.ts';
import { MockRecordingMissing } from '../providers/mock.ts';
import type { ModelResponse, Phase, PromptMessages, Rewriter } from '../providers/types.ts';
import { ProviderError } from '../providers/types.ts';
import { buildRewritePrompt } from '../prompts/rewritePrompt.ts';
import { buildB2Prompt } from '../prompts/b2Prompt.ts';
import { buildB3DraftPrompt, buildB3RevisionPrompt, buildB3SelfCheckPrompt } from '../prompts/b3Prompts.ts';
import { describeProfile, profile } from '../style/profile.ts';
import type { StyleProfile } from '../style/profile.ts';
import { buildRepairRequest } from './repairRequest.ts';
import { selectAttempt } from './select.ts';
import type { StepResult, StepRun } from './step.ts';
import { step } from './step.ts';
import { verdictOf } from './verdict.ts';

/** Hard cap on attempts per B4 run (1 + 2 retries), enforced here and by the server's begin_attempt. */
export const MAX_ATTEMPTS = 3;
export const DEFAULT_MAX_TOKENS = 4096;

export interface PipelineRun extends StepRun {
  sourceId: string | null;
  voiceId: string | null;
}

export interface PipelineDeps {
  rewriter: Rewriter;
  model: string;
  maxTokens?: number;
  claimJudge?: ClaimJudge;
  /** B1 rule restyler (M4); required only for B1 runs. */
  restyle?: (sourceText: string, samples: readonly string[]) => string;
}

export interface PipelineAttempt {
  ordinal: number;
  state: AttemptState;
  result: StepResult | null;
  repairRequest: RepairRequest | null;
  error: string | null;
  calls: ModelResponse[];
}

export interface PipelineResult {
  attempts: PipelineAttempt[];
  selectedOrdinal: number | null;
  verdict: Verdict | null;
  error: string | null;
  modelCalls: number;
}

type CallOutcome<T> = { ok: true; value: T; call: ModelResponse } | { ok: false; error: string; call: ModelResponse | null };

async function callAndParse<T>(
  run: PipelineRun,
  deps: PipelineDeps,
  attempt: number,
  phase: Phase,
  messages: PromptMessages,
  parse: (text: string) => ParseResult<T>,
): Promise<CallOutcome<T>> {
  let call: ModelResponse;
  try {
    call = await deps.rewriter.call({
      key: { system: run.system, sourceId: run.sourceId ?? 'custom', voiceId: run.voiceId ?? 'custom', attempt, phase },
      messages,
      namespace: run.system === 'B4' ? run.maskNamespace : null,
      model: deps.model,
      maxTokens: deps.maxTokens ?? DEFAULT_MAX_TOKENS,
    });
  } catch (e) {
    if (e instanceof MockRecordingMissing) throw e;
    const code = e instanceof ProviderError ? e.code : 'unknown';
    return { ok: false, error: `provider_error:${code}`, call: null };
  }
  const parsed = parse(call.text);
  if (!parsed.ok) return { ok: false, error: `invalid_model_output:${parsed.error}`, call };
  return { ok: true, value: parsed.value, call };
}

function failed(ordinal: number, error: string, calls: ModelResponse[], repairRequest: RepairRequest | null = null): PipelineAttempt {
  return { ordinal, state: 'call_failed', result: null, repairRequest, error, calls };
}

async function complete(run: PipelineRun, deps: PipelineDeps, prof: StyleProfile, ordinal: number, output: string, calls: ModelResponse[], repairRequest: RepairRequest | null = null): Promise<PipelineAttempt> {
  const result = await step({ run, ordinal, output, claimJudge: deps.claimJudge, profile: prof });
  return { ordinal, state: 'complete', result, repairRequest, error: null, calls };
}

const hasHard = (a: PipelineAttempt): boolean => (a.result?.flags ?? []).some((f) => f.class === 'hard');
const callsOf = (outcome: CallOutcome<unknown>): ModelResponse[] => (outcome.call ? [outcome.call] : []);

async function runB4(run: PipelineRun, deps: PipelineDeps, prof: StyleProfile): Promise<PipelineAttempt[]> {
  const ns = run.maskNamespace;
  if (ns === null) throw new Error('B4 runs need a mask namespace');
  const maskedSource = mask(run.sourceText, run.ledger, ns).masked;
  const attempts: PipelineAttempt[] = [];
  for (let ordinal = 1; ordinal <= MAX_ATTEMPTS; ordinal++) {
    const prev = attempts[attempts.length - 1];
    const repair = prev?.result ? buildRepairRequest(prev.ordinal, prev.result.flags, run.ledger, ns) : null;
    const messages = buildRewritePrompt({ maskedSource, excerpts: prof.excerpts, styleSummary: describeProfile(prof), repair });
    const outcome = await callAndParse(run, deps, ordinal, 'rewrite', messages, parseRewriteOutput);
    if (!outcome.ok) {
      attempts.push(failed(ordinal, outcome.error, callsOf(outcome), repair));
      break;
    }
    const attempt = await complete(run, deps, prof, ordinal, outcome.value.rewrite, [outcome.call], repair);
    attempts.push(attempt);
    if (!hasHard(attempt)) break;
  }
  return attempts;
}

async function runB3(run: PipelineRun, deps: PipelineDeps, prof: StyleProfile): Promise<PipelineAttempt> {
  const calls: ModelResponse[] = [];
  const draft = await callAndParse(run, deps, 1, 'rewrite', buildB3DraftPrompt({ source: run.sourceText, samples: run.samples }), parseRewriteOutput);
  calls.push(...callsOf(draft));
  if (!draft.ok) return failed(1, draft.error, calls);
  const check = await callAndParse(run, deps, 1, 'b3_check', buildB3SelfCheckPrompt({ source: run.sourceText, draft: draft.value.rewrite }), parseSelfCheckOutput);
  calls.push(...callsOf(check));
  if (!check.ok) return failed(1, check.error, calls);
  const revision = await callAndParse(
    run, deps, 1, 'b3_revise',
    buildB3RevisionPrompt({ source: run.sourceText, samples: run.samples, draft: draft.value.rewrite, issues: check.value.issues }),
    parseRewriteOutput,
  );
  calls.push(...callsOf(revision));
  if (!revision.ok) return failed(1, revision.error, calls);
  return complete(run, deps, prof, 1, revision.value.rewrite, calls);
}

export async function runPipeline(run: PipelineRun, deps: PipelineDeps): Promise<PipelineResult> {
  const prof = profile(run.samples);
  let modelCalls = 0;
  const countedDeps: PipelineDeps = {
    ...deps,
    rewriter: { name: deps.rewriter.name, call: (req) => { modelCalls++; return deps.rewriter.call(req); } },
  };
  let attempts: PipelineAttempt[];
  switch (run.system) {
    case 'B0':
      attempts = [await complete(run, deps, prof, 1, run.sourceText, [])];
      break;
    case 'B1': {
      if (!deps.restyle) throw new Error('B1 runs need deps.restyle (the rule restyler, milestone M4)');
      attempts = [await complete(run, deps, prof, 1, deps.restyle(run.sourceText, run.samples), [])];
      break;
    }
    case 'B2': {
      const outcome = await callAndParse(run, countedDeps, 1, 'rewrite', buildB2Prompt({ source: run.sourceText, samples: run.samples }), parseRewriteOutput);
      attempts = [outcome.ok ? await complete(run, deps, prof, 1, outcome.value.rewrite, [outcome.call]) : failed(1, outcome.error, callsOf(outcome))];
      break;
    }
    case 'B3':
      attempts = [await runB3(run, countedDeps, prof)];
      break;
    case 'B4':
      attempts = await runB4(run, countedDeps, prof);
      break;
  }
  const error = attempts.find((a) => a.error !== null)?.error ?? null;
  const selected = selectAttempt(attempts.map((a) => ({ ordinal: a.ordinal, state: a.state, flags: a.result?.flags ?? [], attempt: a })));
  const selectedResult = selected?.attempt.result;
  if (error !== null && selectedResult) {
    selectedResult.flags = appendFlags(selectedResult.flags, [{
      class: 'coverage', code: 'operational_incomplete', found: error,
      evidence: 'the pipeline ended with a provider or output-format error; later checks did not complete',
    }]);
    selectedResult.verdict = verdictOf(selectedResult.flags, selectedResult.claimStatus);
  }
  const verdict: Verdict | null = selectedResult?.verdict ?? null;
  return {
    attempts,
    selectedOrdinal: selected?.ordinal ?? null,
    verdict,
    error,
    modelCalls,
  };
}
