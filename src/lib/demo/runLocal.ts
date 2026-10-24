// Offline run driver: prepare -> create run -> runPipeline -> append attempts -> finish, all on a Store (localStore in
// the Offline Demo). Makes no backend request; the rewriter is the scripted mock in the demo.

import type { Attempt } from '../../contracts/run.ts';
import type { Toggle } from '../factledger/types.ts';
import { fixtureSeedId } from '../mask/namespace.ts';
import { prepareRun } from '../loop/prepare.ts';
import type { RunSpec } from '../loop/prepare.ts';
import type { PipelineDeps } from '../loop/runPipeline.ts';
import { runPipeline } from '../loop/runPipeline.ts';
import { createMockRewriter, MOCK_MODEL, MOCK_SOURCE } from '../providers/mock.ts';
import type { MockSource, RecordingsFile } from '../providers/mock.ts';
import type { Rewriter } from '../providers/types.ts';
import type { RunBundle, Store } from '../store/types.ts';
import { DEMO_REFERENCE_TIME, demoSource, demoVoice } from './demoData.ts';
import { DEMO_SCRIPTS } from './scriptedOutputs.ts';

export interface RunLocalOptions {
  now?: () => Date;
  newId?: () => string;
}

export async function runOnStore(store: Store, spec: RunSpec, deps: PipelineDeps, opts: RunLocalOptions = {}): Promise<RunBundle> {
  if (store.kind !== 'local') throw new Error('Offline Demo requires the local store');
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  const prepared = await prepareRun(spec);
  const run = await store.createRun({
    system: prepared.system,
    mode: 'demo',
    sourceId: prepared.sourceId,
    voiceId: prepared.voiceId,
    sourceText: prepared.sourceText,
    samples: prepared.samples,
    toggles: prepared.toggles,
    aliases: prepared.aliases,
    protectedTerms: prepared.protectedTerms,
    derived: {
      sourceHash: prepared.sourceHash,
      ledger: prepared.ledger,
      maskNamespace: prepared.maskNamespace,
      referenceTime: prepared.referenceTime,
      checkerVersion: prepared.checkerVersion,
      promptVersion: prepared.promptVersion,
      maskVersion: prepared.maskVersion,
    },
  });

  const result = await runPipeline(prepared, deps);
  const ids = new Map<number, string>();
  for (const a of result.attempts) {
    const attempt: Attempt = {
      id: newId(),
      runId: run.id,
      ordinal: a.ordinal,
      requestKey: null,
      state: a.state,
      outputText: a.result?.text ?? null,
      contentHash: a.result?.contentHash ?? null,
      flags: a.result?.flags ?? [],
      repairRequest: a.repairRequest,
      verdict: a.result?.verdict ?? null,
      claimStatus: a.result?.claimStatus ?? null,
      judgeCoverage: null,
      styleDistance: a.result?.style.value ?? null,
      styleReason: a.result?.style.reason ?? null,
      error: a.error,
      createdAt: now().toISOString(),
    };
    ids.set(a.ordinal, attempt.id);
    await store.appendAttempt(attempt);
  }
  await store.finishRun(run.id, {
    status: 'review_ready',
    selectedAttemptId: result.selectedOrdinal === null ? null : ids.get(result.selectedOrdinal) ?? null,
    verdict: result.verdict,
    error: result.error,
  });
  const bundle = await store.loadRun(run.id);
  if (!bundle) throw new Error('run vanished from the store');
  return bundle;
}

/** RunSpec for a bundled demo source + voice (B4, fixed reference time, fixture mask seed). */
export function demoRunSpec(sourceId: string, voiceId: string, toggles: Readonly<Record<string, Toggle>> = {}): RunSpec {
  return {
    system: 'B4',
    sourceText: demoSource(sourceId).text,
    samples: demoVoice(voiceId).samples,
    referenceTime: DEMO_REFERENCE_TIME,
    toggles,
    seedId: fixtureSeedId(sourceId, voiceId, 'B4'),
    sourceId,
    voiceId,
  };
}

/** The demo's mock rewriter (MOCK_SOURCE-selected; scripted until recordings exist). */
export function demoRewriter(recordings?: RecordingsFile, source: MockSource = MOCK_SOURCE): Rewriter {
  return createMockRewriter({ scripts: DEMO_SCRIPTS, recordings }, source);
}

/** Browser callers inject a bundled RecordingsFile when MOCK_SOURCE is recordings. Missing data never falls back. */
export function demoDeps(recordings?: RecordingsFile, source: MockSource = MOCK_SOURCE): PipelineDeps {
  return { rewriter: demoRewriter(recordings, source), model: MOCK_MODEL };
}
