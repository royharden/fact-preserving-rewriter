// Source-only regression for the demo's recordings seam; no generated file is read by this unit test.
import { describe, expect, it } from 'vitest';
import { demoDeps, demoRewriter } from '../../../src/lib/demo/runLocal.ts';
import { MOCK_MODEL, MockRecordingMissing, recordingKey } from '../../../src/lib/providers/mock.ts';
import type { RecordingsFile } from '../../../src/lib/providers/mock.ts';
import type { RewriteCall } from '../../../src/lib/providers/types.ts';
import { PROMPT_VERSION } from '../../../src/lib/prompts/version.ts';
import { MASK_VERSION } from '../../../src/lib/mask/namespace.ts';

describe('demo recorded mocks', () => {
  const request: RewriteCall = { key: { system: 'B4', sourceId: 'synthetic', voiceId: 'synthetic', attempt: 1, phase: 'rewrite' },
    messages: { system: 'Synthetic system', user: 'Synthetic user' }, namespace: null, model: MOCK_MODEL };
  it('passes recordings through both factories and throws on missing/stale data without a scripted fallback', async () => {
    const key = await recordingKey(request.model, request.messages);
    const file: RecordingsFile = { version: 1, prompt_version: PROMPT_VERSION, mask_version: MASK_VERSION,
      recordings: { [key]: { model: MOCK_MODEL, output: { rewrite: 'Recorded synthetic response.' } } } };
    for (const rewriter of [demoRewriter(file, 'recordings'), demoDeps(file, 'recordings').rewriter]) {
      expect(rewriter.name).toBe('mock:recordings');
      await expect(rewriter.call(request)).resolves.toMatchObject({ text: '{"rewrite":"Recorded synthetic response."}' });
      await expect(rewriter.call({ ...request, messages: { ...request.messages, user: 'Changed request' } })).rejects.toBeInstanceOf(MockRecordingMissing);
    }
    expect(() => demoRewriter(undefined, 'recordings')).toThrow(MockRecordingMissing);
    expect(() => demoDeps(undefined, 'recordings')).toThrow(MockRecordingMissing);
    await expect(demoRewriter({ ...file, prompt_version: 'stale' }, 'recordings').call(request)).rejects.toBeInstanceOf(MockRecordingMissing);
  });
});
