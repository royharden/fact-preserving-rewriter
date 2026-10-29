// GENERATED from src/lib/providers/types.ts; edit the source and run npm run sync:functions.
// Provider interfaces. A ModelCaller sends one system+user prompt and returns raw text; a Rewriter is what the loop
// calls for each model phase (live: a ModelCaller underneath; mock: scripted table or hash-keyed recordings). Output
// JSON is parsed by the caller (parse.ts), never trusted by the provider layer.

import type { System } from '../../contracts/run.ts';

export type ProviderName = 'mock' | 'anthropic' | 'openai_compatible';
/** Model phases inside one attempt (also the call-ledger purposes, except 'judge'). */
export type Phase = 'rewrite' | 'b3_check' | 'b3_revise';

export interface PromptMessages {
  system: string;
  user: string;
}

export interface ModelRequest extends PromptMessages {
  maxTokens?: number;
}

export interface ModelResponse {
  text: string;
  provider: ProviderName;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export type ModelCaller = (req: ModelRequest) => Promise<ModelResponse>;

/** Scripted-mock lookup key: (system, source_id, voice_id, attempt, phase). */
export interface ScriptKey {
  system: System;
  sourceId: string;
  voiceId: string;
  attempt: number;
  phase: Phase;
}

export interface RewriteCall {
  key: ScriptKey;
  messages: PromptMessages;
  /** Mask namespace of the run (B4), so a scripted mock can echo placeholders; null when unmasked. */
  namespace: string | null;
  model: string;
  maxTokens?: number;
}

export interface Rewriter {
  readonly name: string;
  call(req: RewriteCall): Promise<ModelResponse>;
}

export type ProviderErrorCode =
  | 'provider_not_configured'
  | 'http_error'
  | 'network'
  | 'timeout'
  | 'output_truncated'
  | 'output_too_large'
  | 'bad_response'
  | 'scripted_error';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number | null;

  constructor(code: ProviderErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

/** A live Rewriter: ignores the script key and sends the prompt through the given ModelCaller. */
export function callerRewriter(name: string, caller: ModelCaller): Rewriter {
  return {
    name,
    call: (req) => caller({ system: req.messages.system, user: req.messages.user, maxTokens: req.maxTokens }),
  };
}
