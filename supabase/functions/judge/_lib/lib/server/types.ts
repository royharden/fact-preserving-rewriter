// GENERATED from src/lib/server/types.ts; edit the source and run npm run sync:functions.
// Service gateway is injected only AFTER JWT verification and an owner-scoped, user-token run read.
import type { Attempt, Run } from '../../contracts/run.ts';
import type { ModelCaller } from '../providers/types.ts';
import type { Prices } from '../callledger/types.ts';

export type Row = Record<string, unknown>;
export interface ServiceGateway {
  rpc<T>(name: string, args: Row): Promise<T>;
  run(id: string): Promise<Run>;
  attempts(runId: string): Promise<Attempt[]>;
  calls(runId: string, attemptId: string): Promise<CallRow[]>;
}
export interface CallRow {
  id: string;
  idempotency_key: string;
  run_id: string | null;
  attempt_id: string | null;
  function: 'rewrite' | 'judge';
  purpose: string;
  provider: string;
  model: string;
  status: 'reserved' | 'dispatching' | 'settled' | 'failed' | 'unknown';
  reserved_micro_usd: number;
  response_payload: unknown | null;
}
export interface LiveModel {
  provider: 'anthropic' | 'openai_compatible';
  model: string;
  prices: Prices;
  maxTokens: number;
  call: ModelCaller;
}
export interface LiveConfig {
  rewrite: LiveModel | null;
  judge: LiveModel | null;
  judgeEnabled: boolean;
}
export class EdgeError extends Error {
  readonly status: number;
  readonly code: string;
  readonly scope?: string;
  constructor(status: number, code: string, scope?: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.scope = scope;
  }
}
/** Keep SQL/provider internals and user text out of the HTTP error body. */
export function edgeError(error: unknown): EdgeError {
  if (error instanceof EdgeError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const budget = /budget_exceeded:(run|user|global|allowance|call)/.exec(message);
  if (budget) return new EdgeError(429, 'budget_exceeded', budget[1]);
  if (/provider_not_configured/.test(message)) return new EdgeError(503, 'provider_not_configured');
  if (/unknown_toggle/.test(message)) return new EdgeError(422, 'unknown_toggle_ids');
  return new EdgeError(409, 'server_operation_refused');
}
