import { describe, expect, it } from 'vitest';
import { capturingRewriter } from '../../../scripts/build-mock-recordings.ts';
import { recordingKey, ScriptedRewriter, MockRecordingMissing } from '../../../src/lib/providers/mock.ts';
import type { RecordingEntry } from '../../../src/lib/providers/mock.ts';
import type { RewriteCall } from '../../../src/lib/providers/types.ts';

describe('future recording generator capture seam', () => {
  it('records canonical versioned keys including the exact token cap and substituted namespace', async () => {
    const table = new ScriptedRewriter([{ system: 'B4', source_id: 'source', voice_id: 'voice', attempt: 1, phase: 'rewrite', output: { rewrite: 'Keep ⟦ns:Q1⟧.' } }]);
    const rows: Record<string, RecordingEntry> = {};
    const captured = capturingRewriter(table, rows);
    const request: RewriteCall = { key: { system: 'B4', sourceId: 'source', voiceId: 'voice', attempt: 1, phase: 'rewrite' }, namespace: 'abc123', messages: { system: 'fixed instructions', user: 'masked source ⟦abc123:Q1⟧' }, model: 'mock-scripted', maxTokens: 4096 };
    const reply = await captured.call(request);
    const key = await recordingKey(request.model, request.messages, 4096);
    expect(rows[key]).toEqual({ model: request.model, raw: reply.text });
    expect(reply.text).toContain('⟦abc123:Q1⟧');
    expect(await recordingKey(request.model, request.messages, 2048)).not.toBe(key);
    expect(await recordingKey(request.model, { ...request.messages, user: `${request.messages.user}\nrepair` }, 4096)).not.toBe(key);
    expect(Object.keys(rows)).toEqual([key]);
  });
  it('propagates explicit-table misses and refuses inconsistent responses sharing a key', async () => {
    const request: RewriteCall = { key: { system: 'B2', sourceId: 'x', voiceId: 'y', attempt: 1, phase: 'rewrite' }, namespace: null, messages: { system: 'fixed', user: 'source' }, model: 'mock-scripted' };
    const missing = capturingRewriter(new ScriptedRewriter([]), {});
    await expect(missing.call(request)).rejects.toBeInstanceOf(MockRecordingMissing);
    let count = 0;
    const inconsistent = capturingRewriter({ name: 'test-only', call: async () => ({ text: String(++count), provider: 'mock', model: 'mock-scripted', inputTokens: null, outputTokens: null }) }, {});
    await inconsistent.call(request);
    await expect(inconsistent.call(request)).rejects.toThrow('conflicting replies');
  });
});
