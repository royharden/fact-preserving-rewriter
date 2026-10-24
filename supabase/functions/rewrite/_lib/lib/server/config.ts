// GENERATED from src/lib/server/config.ts; edit the source and run npm run sync:functions.
// Environment is read by the Deno entrypoint and injected here; no browser env or secret is read by a shared module.
import { createAnthropicCaller } from '../providers/anthropic.ts';
import { createOpenAiCompatibleCaller } from '../providers/openaiCompatible.ts';
import type { LiveConfig, LiveModel } from './types.ts';

export type EnvReader = (name: string) => string | undefined;
export const LIVE_MAX_TOKENS = 4096;
function price(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}
export function readLiveConfig(env: EnvReader): LiveConfig {
  const enabled = env('LIVE_CALLS_ENABLED') === 'true';
  const judgeEnabled = env('LLM_JUDGE_ENABLED') === 'true';
  const input = price(env('MODEL_PRICE_IN_MICRO_USD_PER_MTOK'));
  const output = price(env('MODEL_PRICE_OUT_MICRO_USD_PER_MTOK'));
  const anthropicKey = env('ANTHROPIC_API_KEY')?.trim();
  const compatibleKey = env('OPENAI_COMPATIBLE_API_KEY')?.trim();
  const baseUrl = env('OPENAI_COMPATIBLE_BASE_URL')?.trim();
  const completeBase = !!baseUrl && /^https:\/\//.test(baseUrl);
  function model(name: string): LiveModel | null {
    const modelId = env(name)?.trim();
    if (!enabled || !modelId || input === null || output === null) return null;
    const prices = { inMicroUsdPerMTok: input, outMicroUsdPerMTok: output };
    if (anthropicKey) return { provider: 'anthropic', model: modelId, prices, maxTokens: LIVE_MAX_TOKENS,
      call: createAnthropicCaller({ apiKey: anthropicKey, model: modelId, maxTokens: LIVE_MAX_TOKENS }) };
    if (compatibleKey && completeBase) return { provider: 'openai_compatible', model: modelId, prices, maxTokens: LIVE_MAX_TOKENS,
      call: createOpenAiCompatibleCaller({ apiKey: compatibleKey, model: modelId, baseUrl, maxTokens: LIVE_MAX_TOKENS, jsonMode: true }) };
    return null;
  }
  return { rewrite: model('REWRITE_MODEL_ID'), judge: judgeEnabled ? model('JUDGE_MODEL_ID') : null, judgeEnabled };
}
