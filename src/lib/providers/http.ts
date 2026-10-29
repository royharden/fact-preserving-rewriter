// Shared HTTP plumbing for the fetch-based adapters. Configuration (key, model, base URL, max tokens) is always passed
// in by the caller (the edge function reads its secrets); nothing here reads environment variables.

import { MAX_OUTPUT_BYTES } from './parse.ts';
import { ProviderError } from './types.ts';

/** Raw HTTP body cap (the JSON envelope around a <= 64 KB output). */
export const MAX_RESPONSE_BYTES = 4 * MAX_OUTPUT_BYTES;
export const DEFAULT_TIMEOUT_MS = 60_000;

export type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface AdapterConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected fetch (tests, Deno); defaults to globalThis.fetch. */
  fetch?: FetchLike;
}

const encoder = new TextEncoder();

export function requireConfig(cfg: AdapterConfig, needBaseUrl: boolean): void {
  if (!cfg.apiKey) throw new ProviderError('provider_not_configured', 'missing API key');
  if (!cfg.model) throw new ProviderError('provider_not_configured', 'missing model id');
  if (!Number.isInteger(cfg.maxTokens) || cfg.maxTokens <= 0) throw new ProviderError('provider_not_configured', 'maxTokens must be a positive integer');
  if (needBaseUrl && !cfg.baseUrl) throw new ProviderError('provider_not_configured', 'missing base URL');
}

export function outputTokenLimit(requested: number | undefined, configured: number): number {
  const value = requested ?? configured;
  if (!Number.isInteger(value) || value <= 0) throw new ProviderError('provider_not_configured', 'requested maxTokens must be a positive integer');
  return Math.min(value, configured);
}

/** POST JSON; returns the parsed JSON body of a 2xx response or throws ProviderError (status, size, JSON). */
export async function postJson(cfg: AdapterConfig, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const fetchFn: FetchLike | undefined = cfg.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchFn) throw new ProviderError('provider_not_configured', 'no fetch implementation available');
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(timeoutMs) : undefined;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') throw new ProviderError('timeout', `no response within ${timeoutMs} ms`);
    throw new ProviderError('network', 'provider request did not complete');
  }
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    throw new ProviderError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', 'provider response body did not complete');
  }
  if (encoder.encode(text).length > MAX_RESPONSE_BYTES) throw new ProviderError('output_too_large', 'provider response exceeds the size cap', res.status);
  // never echo the response body into errors: it may contain the source text
  if (!res.ok) throw new ProviderError('http_error', `provider returned HTTP ${res.status}`, res.status);
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError('bad_response', 'provider response is not JSON', res.status);
  }
}

export function checkOutputSize(text: string): void {
  if (encoder.encode(text).length > MAX_OUTPUT_BYTES) throw new ProviderError('output_too_large', `model output exceeds ${MAX_OUTPUT_BYTES} bytes`);
}

export const trimSlash = (url: string): string => url.replace(/\/+$/, '');
