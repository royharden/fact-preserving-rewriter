// OpenAI-compatible chat-completions adapter (fetch-based; operator-configured base URL, e.g. ".../v1"). Key, model,
// base URL and max tokens are arguments. `jsonMode` asks for response_format json_object (not every compatible server
// supports it, hence optional). A finish_reason of "length" is an error.

import type { AdapterConfig } from './http.ts';
import { checkOutputSize, outputTokenLimit, postJson, requireConfig, trimSlash } from './http.ts';
import type { ModelCaller, ModelRequest, ModelResponse } from './types.ts';
import { ProviderError } from './types.ts';

export interface OpenAiCompatibleConfig extends AdapterConfig {
  jsonMode?: boolean;
}

interface ChatReply {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createOpenAiCompatibleCaller(cfg: OpenAiCompatibleConfig): ModelCaller {
  requireConfig(cfg, true);
  const url = `${trimSlash(cfg.baseUrl as string)}/chat/completions`;
  return async (req: ModelRequest): Promise<ModelResponse> => {
    const body: Record<string, unknown> = {
      model: cfg.model,
      max_tokens: outputTokenLimit(req.maxTokens, cfg.maxTokens),
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    };
    if (cfg.jsonMode) body.response_format = { type: 'json_object' };
    const reply = (await postJson(cfg, url, { authorization: `Bearer ${cfg.apiKey}` }, body)) as ChatReply;
    const choice = reply && Array.isArray(reply.choices) ? reply.choices[0] : undefined;
    if (!choice || typeof choice.message?.content !== 'string') throw new ProviderError('bad_response', 'reply has no message content');
    if (choice.finish_reason === 'length') throw new ProviderError('output_truncated', 'model stopped at max_tokens');
    const text = choice.message.content;
    checkOutputSize(text);
    return {
      text,
      provider: 'openai_compatible',
      model: typeof reply.model === 'string' ? reply.model : cfg.model,
      inputTokens: reply.usage?.prompt_tokens ?? null,
      outputTokens: reply.usage?.completion_tokens ?? null,
    };
  };
}
