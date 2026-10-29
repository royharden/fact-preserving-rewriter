/** Future generator: actual prompt builders/checks/masks/repairs; scripted replies, never a live provider call.
 * NOT EXECUTED during Dirty Mode. It writes only request-keyed mock responses, never evaluation results.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract } from '../src/lib/factledger/extract.ts';
import { deriveNamespace, fixtureSeedId, MASK_VERSION } from '../src/lib/mask/namespace.ts';
import { PROMPT_VERSION } from '../src/lib/prompts/version.ts';
import { runPipeline } from '../src/lib/loop/runPipeline.ts';
import type { PipelineRun } from '../src/lib/loop/runPipeline.ts';
import { prepareRun } from '../src/lib/loop/prepare.ts';
import { demoRunSpec } from '../src/lib/demo/runLocal.ts';
import { DEMO_PAIRINGS, DEMO_IGNORE_SUGGESTION } from '../src/lib/demo/demoData.ts';
import { DEMO_SCRIPTS } from '../src/lib/demo/scriptedOutputs.ts';
import { MOCK_MODEL, ScriptedRewriter, recordingKey } from '../src/lib/providers/mock.ts';
import type { RecordingEntry, RecordingsFile, ScriptsTable } from '../src/lib/providers/mock.ts';
import type { Rewriter, RewriteCall } from '../src/lib/providers/types.ts';
import { fixturePath, ROOT, readManifest } from './build-fixtures.ts';

/** Capture exactly the requests that the real pipeline makes, including code-written retry prompts. */
export function capturingRewriter(scripted: Rewriter, recordings: Record<string, RecordingEntry>): Rewriter {
  return {
    name: 'mock:scripted-capture',
    async call(request: RewriteCall) {
      // A missing explicit table row propagates MockRecordingMissing; there is no generated fallback.
      const response = await scripted.call(request);
      const key = await recordingKey(request.model, request.messages, request.maxTokens);
      const row: RecordingEntry = { model: request.model, raw: response.text };
      const prior = recordings[key];
      if (prior && (prior.model !== row.model || prior.raw !== row.raw)) throw new Error(`conflicting replies for canonical recording key ${key}`);
      recordings[key] = row;
      return response;
    },
  };
}

export async function buildMockRecordings(root = ROOT): Promise<void> {
  const manifest = await readManifest(root);
  const table = JSON.parse(await readFile(fixturePath(root, 'fixtures/mock/scripts.json'), 'utf8')) as ScriptsTable;
  const recordings: Record<string, RecordingEntry> = {};
  const captured = capturingRewriter(new ScriptedRewriter(table), recordings);
  const voices = new Map(await Promise.all(manifest.voices.map(async (voice) => [voice.id, await readFile(fixturePath(root, voice.path), 'utf8')] as const)));
  const pairs = [
    ...manifest.pairs,
    ...manifest.injected.flatMap((s) => manifest.voices.map((v) => ({ source_id: s.id, voice_id: v.id, split: 'excluded' as const }))),
  ];
  for (const pair of pairs) {
    const source = [...manifest.sources, ...manifest.injected].find((s) => s.id === pair.source_id);
    const sample = voices.get(pair.voice_id);
    if (!source || sample === undefined) throw new Error('recording pair has missing source or voice');
    const samples = [sample];
    const ledger = extract(source.text, { referenceTime: new Date(manifest.reference_time) });
    for (const system of ['B2', 'B3', 'B4'] as const) {
      const namespace = system === 'B4'
        ? (await deriveNamespace(fixtureSeedId(source.id, pair.voice_id, system), [source.text, ...samples])).namespace
        : null;
      const run: PipelineRun = {
        system, sourceId: source.id, voiceId: pair.voice_id, sourceText: source.text, samples, ledger,
        referenceTime: manifest.reference_time, protectedTerms: [], aliases: {}, maskNamespace: namespace,
      };
      // runPipeline calls the actual B2/B3/B4 versioned prompt builders; B4's real step/repair builder
      // controls reached retries. Do not synthesise prompts from the table or hand-predict flags.
      const result = await runPipeline(run, { rewriter: captured, model: MOCK_MODEL });
      if (result.error) throw new Error(`incomplete mock capture for ${source.id}/${pair.voice_id}/${system}: ${result.error}`);
    }
  }

  // Demo uses different source/sample bodies from the full corpus, so capture its actual prompts separately.
  // Both toggled and untoggled journeys are captured; identical requests must have identical scripted replies.
  const demoCaptured = capturingRewriter(new ScriptedRewriter(DEMO_SCRIPTS), recordings);
  for (const pair of DEMO_PAIRINGS) {
    const base = demoRunSpec(pair.sourceId, pair.voiceId);
    const prepared = await prepareRun(base);
    const suggestion = DEMO_IGNORE_SUGGESTION[pair.sourceId];
    const ignored = suggestion ? prepared.ledger.find((f) => f.raw === suggestion.raw && f.kind === 'entity') : undefined;
    const specs = ignored ? [base, { ...base, toggles: { [ignored.id]: 'ignored' as const } }] : [base];
    for (const spec of specs) {
      const result = await runPipeline(await prepareRun(spec), { rewriter: demoCaptured, model: MOCK_MODEL });
      if (result.error) throw new Error(`incomplete demo capture: ${pair.sourceId}/${pair.voiceId}`);
    }
  }

  // Corpus claims are overlap-only. No LLM judge replies are invented here; judge measurements remain absent.
  // A future explicitly authored judge case must call buildJudgePrompt and recordingKey for its exact batch/token cap.
  const file: RecordingsFile = { version: 1, prompt_version: PROMPT_VERSION, mask_version: MASK_VERSION, recordings };
  await writeFile(fixturePath(root, 'fixtures/mock/recordings.json'), `${JSON.stringify(file, null, 2)}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildMockRecordings();
