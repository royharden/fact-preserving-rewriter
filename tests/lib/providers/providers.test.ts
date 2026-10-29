import { describe, expect, it, vi } from 'vitest';
import { MASK_VERSION } from '../../../src/lib/mask/namespace.ts';
import { PROMPT_VERSION } from '../../../src/lib/prompts/version.ts';
import { createAnthropicCaller } from '../../../src/lib/providers/anthropic.ts';
import { createOpenAiCompatibleCaller } from '../../../src/lib/providers/openaiCompatible.ts';
import type { FetchLike } from '../../../src/lib/providers/http.ts';
import { createMockRewriter, MockRecordingMissing, MOCK_SOURCE, recordingKey, RecordingsRewriter, ScriptedRewriter } from '../../../src/lib/providers/mock.ts';
import type { RecordingsFile } from '../../../src/lib/providers/mock.ts';
import { MAX_OUTPUT_BYTES, parseRewriteOutput } from '../../../src/lib/providers/parse.ts';
import type { RewriteCall } from '../../../src/lib/providers/types.ts';
import { callerRewriter, ProviderError } from '../../../src/lib/providers/types.ts';

const request = (): RewriteCall => ({ key: { system: 'B4', sourceId: 'source', voiceId: 'voice', attempt: 1, phase: 'rewrite' },
  messages: { system: 'Fixed instructions.', user: '<source>untrusted data</source>' }, namespace: 'abc123', model: 'model-test', maxTokens: 100 });

function httpReply(body: unknown, status = 200) {
  const fetch = vi.fn<FetchLike>(async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }));
  return fetch;
}

describe('one-field model schema', () => {
  it('accepts JSON whitespace and Unicode without repairing the model reply', () => {
    expect(parseRewriteOutput(' \n{"rewrite":"Preserve curly “quotes” and 😀."}\n ')).toEqual({ ok: true, value: { rewrite: 'Preserve curly “quotes” and 😀.' } });
  });

  it.each(['not JSON', '```json\n{"rewrite":"ok"}\n```', '{"rewrite":"ok","verdict":"pass"}', '{}', '{"rewrite":null}', '{"rewrite":3}', '[]'])('rejects %s', (text) => {
    expect(parseRewriteOutput(text).ok).toBe(false);
  });

  it('refuses oversized output by UTF-8 bytes before parsing', () => {
    expect(parseRewriteOutput(JSON.stringify({ rewrite: '😀'.repeat(MAX_OUTPUT_BYTES / 4) }))).toMatchObject({ ok: false, error: 'output_too_large' });
  });
});

describe('scripted and recorded mock providers', () => {
  it('uses the scripted source initially and substitutes the frozen namespace exactly', async () => {
    expect(MOCK_SOURCE).toBe('scripted');
    const rewriter = createMockRewriter({ scripts: { version: 1, entries: [
      { system: 'B4', source_id: 'source', voice_id: 'voice', attempt: 1, phase: 'rewrite', output: { rewrite: 'Keep ⟦ns:Q1⟧.' } },
    ] } });
    const reply = await rewriter.call(request());
    expect(reply.provider).toBe('mock');
    expect(parseRewriteOutput(reply.text)).toEqual({ ok: true, value: { rewrite: 'Keep ⟦abc123:Q1⟧.' } });
    await expect(rewriter.call({ ...request(), key: { ...request().key, attempt: 2 } })).rejects.toBeInstanceOf(MockRecordingMissing);
    expect(() => createMockRewriter({})).toThrow(MockRecordingMissing);
  });

  it('refuses duplicate and ambiguous script entries, without a generic fallback', () => {
    const entry = { system: 'B4' as const, source_id: 'source', voice_id: 'voice', attempt: 1, phase: 'rewrite' as const, output: { rewrite: 'text' } };
    expect(() => new ScriptedRewriter([entry, entry])).toThrow('duplicate');
    expect(() => new ScriptedRewriter([{ ...entry, raw: 'also provided' }])).toThrow('exactly one');
  });

  it('replays only the exact model, prompt and token-limit hash with current versions', async () => {
    const req = request();
    const key = await recordingKey(req.model, req.messages, req.maxTokens);
    const file: RecordingsFile = { version: 1, prompt_version: PROMPT_VERSION, mask_version: MASK_VERSION,
      recordings: { [key]: { model: req.model, output: { rewrite: 'A recorded output.' } } } };
    const rewriter = new RecordingsRewriter(file);
    expect((await rewriter.call(req)).text).toBe('{"rewrite":"A recorded output."}');
    expect(await recordingKey(req.model, { ...req.messages })).toBe(await recordingKey(req.model, req.messages));
    await expect(rewriter.call({ ...req, maxTokens: 101 })).rejects.toBeInstanceOf(MockRecordingMissing);
    await expect(rewriter.call({ ...req, messages: { ...req.messages, user: 'changed' } })).rejects.toBeInstanceOf(MockRecordingMissing);
    await expect(rewriter.call({ ...req, model: 'other-model' })).rejects.toBeInstanceOf(MockRecordingMissing);
    await expect(new RecordingsRewriter({ ...file, prompt_version: 'stale' }).call(req)).rejects.toBeInstanceOf(MockRecordingMissing);
    await expect(new RecordingsRewriter({ ...file, mask_version: 'stale' }).call(req)).rejects.toBeInstanceOf(MockRecordingMissing);
    await expect(new RecordingsRewriter({ ...file, recordings: { [key]: { model: 'wrong-model', output: { rewrite: 'x' } } } }).call(req)).rejects.toBeInstanceOf(MockRecordingMissing);
  });
});

describe('fetch-based live adapters (injected HTTP double, no network)', () => {
  it('sends Anthropic fixed system and user data separately and clamps tokens to configured cap', async () => {
    const fetch = httpReply({ content: [{ type: 'text', text: '{"rewrite":"ok"}' }], model: 'model-test', stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 4 } });
    const caller = createAnthropicCaller({ apiKey: 'unit-test-placeholder', model: 'model-test', maxTokens: 50, fetch });
    const rewriter = callerRewriter('anthropic', caller);
    const reply = await rewriter.call(request());
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(JSON.parse(init.body)).toEqual({ model: 'model-test', max_tokens: 50, system: request().messages.system,
      messages: [{ role: 'user', content: request().messages.user }] });
    expect(init.headers['x-api-key']).toBe('unit-test-placeholder');
    expect(reply).toMatchObject({ provider: 'anthropic', inputTokens: 10, outputTokens: 4 });
    expect(parseRewriteOutput(reply.text).ok).toBe(true);
  });

  it('sends compatible chat roles and optional JSON mode to the operator-configured URL', async () => {
    const fetch = httpReply({ choices: [{ message: { content: '{"rewrite":"ok"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 4 } });
    const caller = createOpenAiCompatibleCaller({ apiKey: 'unit-test-placeholder', model: 'model-test', maxTokens: 200,
      baseUrl: 'https://operator.example/v1/', jsonMode: true, fetch });
    const reply = await caller({ ...request().messages, maxTokens: 100 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://operator.example/v1/chat/completions');
    expect(JSON.parse(init.body)).toMatchObject({ max_tokens: 100, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: request().messages.system }, { role: 'user', content: request().messages.user },
    ] });
    expect(reply).toMatchObject({ provider: 'openai_compatible', inputTokens: 8, outputTokens: 4 });
  });

  it('rejects absent configuration without fetching', () => {
    const fetch = httpReply({});
    expect(() => createAnthropicCaller({ apiKey: '', model: 'test', maxTokens: 20, fetch })).toThrow(ProviderError);
    expect(() => createOpenAiCompatibleCaller({ apiKey: 'unit-test-placeholder', model: 'test', maxTokens: 20, fetch })).toThrow(ProviderError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects HTTP failures, truncation, network failure, malformed envelopes and invalid requested limits', async () => {
    const config = { apiKey: 'unit-test-placeholder', model: 'test', maxTokens: 50 };
    await expect(createAnthropicCaller({ ...config, fetch: httpReply({}, 429) })(request().messages)).rejects.toMatchObject({ code: 'http_error', status: 429 });
    await expect(createAnthropicCaller({ ...config, fetch: httpReply({ content: [], stop_reason: 'max_tokens' }) })(request().messages)).rejects.toMatchObject({ code: 'output_truncated' });
    await expect(createAnthropicCaller({ ...config, fetch: httpReply({ content: null }) })(request().messages)).rejects.toMatchObject({ code: 'bad_response' });
    await expect(createAnthropicCaller({ ...config, fetch: async () => { throw new Error('do not echo source'); } })(request().messages)).rejects.toMatchObject({ code: 'network', message: 'provider request did not complete' });
    const compatible = createOpenAiCompatibleCaller({ ...config, baseUrl: 'https://operator.example/v1', fetch: httpReply({ choices: [{ message: { content: '{"rewrite":"partial"}' }, finish_reason: 'length' }] }) });
    await expect(compatible(request().messages)).rejects.toMatchObject({ code: 'output_truncated' });
    const fetch = httpReply({});
    await expect(createAnthropicCaller({ ...config, fetch })({ ...request().messages, maxTokens: -1 })).rejects.toMatchObject({ code: 'provider_not_configured' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
