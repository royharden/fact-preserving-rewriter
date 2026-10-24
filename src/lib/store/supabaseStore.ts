// Live store: user-token reads, raw-input INSERT only, functions for attempts, RPCs for rulings/erasure.
// No module-level client, anonymous sign-in, or background probe. Caller explicitly chooses the Live mode path.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ConfigProbeResponseSchema, JudgeRequestSchema, JudgeResponseSchema, RewriteRequestSchema, RewriteResponseSchema,
} from '../../contracts/api.ts';
import type { ConfigProbeResponse, JudgeRequest, JudgeResponse, RewriteRequest, RewriteResponse } from '../../contracts/api.ts';
import type { Attempt, Run, Ruling } from '../../contracts/run.ts';
import type { RulingInput } from '../rulings/types.ts';
import { attemptFromRow, rulingFromRow, runFromRow } from '../server/codec.ts';
import type { Row } from '../server/types.ts';
import type { NewRunInput, RunBundle, RunFinish, Store } from './types.ts';

export interface SupabaseStore extends Store {
  readonly kind: 'supabase';
  requestRewrite(request: RewriteRequest): Promise<RewriteResponse>;
  requestJudge(request: JudgeRequest): Promise<JudgeResponse>;
  probeConfiguration(): Promise<ConfigProbeResponse>;
}
function checked<T>(reply: { data: T; error: { message: string } | null }): T {
  if (reply.error) throw new Error(reply.error.message);
  return reply.data;
}
export function createSupabaseStore(client: SupabaseClient): SupabaseStore {
  let signingIn: Promise<string> | null = null;
  async function userId(): Promise<string> {
    const session = checked(await client.auth.getSession());
    if (session.session) return session.session.user.id;
    signingIn ??= (async () => {
      const signed = checked(await client.auth.signInAnonymously());
      if (!signed.user) throw new Error('anonymous_sign_in_failed');
      return signed.user.id;
    })().finally(() => { signingIn = null; });
    return signingIn;
  }
  async function invoke(name: 'rewrite' | 'judge', body: Record<string, unknown>): Promise<unknown> {
    await userId();
    const result = await client.functions.invoke(name, { body });
    if (result.error) {
      // Preserve safe function error codes/scopes (not a silent demo fallback).
      const context = (result.error as { context?: Response }).context;
      if (context && typeof context.json === 'function') {
        const problem = await context.json().catch(() => null) as { error?: string; scope?: string } | null;
        if (problem?.error) throw new Error(`${problem.error}${problem.scope ? `:${problem.scope}` : ''}`);
      }
      throw new Error(result.error.message);
    }
    return result.data;
  }
  const store: SupabaseStore = {
    kind: 'supabase', recordLabel: null,
    async createRun(input: NewRunInput): Promise<Run> {
      if (input.mode === 'demo' || input.derived) throw new Error('live_runs_require_raw_inputs');
      const owner = await userId();
      const row = checked(await client.from('rewrite_runs').insert({
        user_id: owner, system: input.system, mode: 'live', source_id: input.sourceId, voice_id: input.voiceId,
        profile_id: input.profileId ?? null, source_text: input.sourceText, samples: input.samples,
        toggles: input.toggles, aliases: input.aliases, protected_terms: input.protectedTerms,
      }).select('*').single());
      return runFromRow(row as Row);
    },
    async listRuns(): Promise<Run[]> {
      const owner = await userId();
      return (checked(await client.from('rewrite_runs').select('*').eq('user_id', owner).order('created_at', { ascending: false })) ?? []).map((r: Row) => runFromRow(r));
    },
    async loadRun(runId: string): Promise<RunBundle | null> {
      const owner = await userId();
      const row = checked(await client.from('rewrite_runs').select('*').eq('id', runId).eq('user_id', owner).maybeSingle());
      if (!row) return null;
      const [attempts, rulings] = await Promise.all([
        client.from('attempts').select('*').eq('run_id', runId).order('ordinal'),
        client.from('rulings').select('*').eq('run_id', runId).order('sequence'),
      ]);
      return { run: runFromRow(row as Row), attempts: (checked(attempts) ?? []).map((r: Row) => attemptFromRow(r)),
        rulings: (checked(rulings) ?? []).map((r: Row) => rulingFromRow(r)) };
    },
    async appendAttempt(_attempt: Attempt): Promise<void> { throw new Error('server_authoritative_use_requestRewrite'); },
    async finishRun(_runId: string, _finish: RunFinish): Promise<Run> { throw new Error('server_authoritative_use_functions'); },
    async requestRewrite(request): Promise<RewriteResponse> {
      return RewriteResponseSchema.parse(await invoke('rewrite', RewriteRequestSchema.parse(request)));
    },
    async requestJudge(request): Promise<JudgeResponse> {
      return JudgeResponseSchema.parse(await invoke('judge', JudgeRequestSchema.parse(request)));
    },
    async probeConfiguration(): Promise<ConfigProbeResponse> {
      return ConfigProbeResponseSchema.parse(await invoke('rewrite', { probe: true }));
    },
    async recordRuling(input: RulingInput): Promise<Ruling> {
      await userId();
      const row = checked(await client.rpc('record_ruling', {
        p_attempt: input.attemptId, p_decision: input.decision, p_reason: input.reason ?? null,
        p_acknowledged_flags: [...(input.acknowledgedFlags ?? [])], p_expected_hash: input.expectedHash,
        p_evidence_version: input.evidenceVersion,
      }));
      return rulingFromRow(row as Row);
    },
    async canExport(runId: string, attemptId: string): Promise<boolean> {
      const bundle = await store.loadRun(runId);
      if (!bundle || bundle.run.selectedAttemptId !== attemptId) return false;
      return checked(await client.rpc('can_export', { p_attempt: attemptId })) === true;
    },
    async deleteMyData(): Promise<void> {
      await userId();
      checked(await client.rpc('delete_my_data'));
    },
  };
  return store;
}
