// Anthropic Messages API adapter (fetch-based). Key, model, base URL and max tokens are arguments; the system prompt
// goes in `system`, the delimited data in the single user message. The reply text is returned raw for strict JSON
// parsing by the caller; a max_tokens stop is an error (a truncated rewrite is never checked as if complete).

import type { AdapterConfig } from './http.ts';
import { checkOutputSize, outputTokenLimit, postJson, requireConfig, trimSlash } from './http.ts';
import type { ModelCaller, ModelRequest, ModelResponse } from './types.ts';
import { ProviderError } from './types.ts';

export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicReply {
  content?: { type?: string; text?: string }[];
  stop_reason?: string;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function createAnthropicCaller(cfg: AdapterConfig): ModelCaller {
  requireConfig(cfg, false);
  const url = `${trimSlash(cfg.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL)}/v1/messages`;
  return async (req: ModelRequest): Promise<ModelResponse> => {
    const body = {
      model: cfg.model,
      max_tokens: outputTokenLimit(req.maxTokens, cfg.maxTokens),
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    };
    const reply = (await postJson(cfg, url, { 'x-api-key': cfg.apiKey, 'anthropic-version': ANTHROPIC_VERSION }, body)) as AnthropicReply;
    if (!reply || !Array.isArray(reply.content)) throw new ProviderError('bad_response', 'reply has no content array');
    if (reply.stop_reason === 'max_tokens') throw new ProviderError('output_truncated', 'model stopped at max_tokens');
    const text = reply.content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text as string).join('');
    checkOutputSize(text);
    return {
      text,
      provider: 'anthropic',
      model: typeof reply.model === 'string' ? reply.model : cfg.model,
      inputTokens: reply.usage?.input_tokens ?? null,
      outputTokens: reply.usage?.output_tokens ?? null,
    };
  };
}
