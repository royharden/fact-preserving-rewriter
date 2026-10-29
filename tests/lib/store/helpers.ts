import type { Attempt, ClaimStatus, Decision, Flag } from '../../../src/contracts/run.ts';
import { verdictOf } from '../../../src/lib/loop/verdict.ts';
import { contentHash } from '../../../src/lib/rulings/contentHash.ts';
import type { RulingInput } from '../../../src/lib/rulings/types.ts';
import { createLocalStore, memoryStorage } from '../../../src/lib/store/localStore.ts';
import type { RunBundle } from '../../../src/lib/store/types.ts';

export const TEST_TIME = '2026-10-24T12:00:00.000Z';
export const fixedNow = () => new Date(TEST_TIME);
export function idFactory(prefix = 'id'): () => string {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

export function rulingInput(bundle: RunBundle, decision: Decision, overrides: Partial<RulingInput> = {}): RulingInput {
  const attempt = bundle.attempts.find((a) => a.id === bundle.run.selectedAttemptId)!;
  return { runId: bundle.run.id, attemptId: attempt.id, decision, expectedHash: attempt.contentHash!,
    evidenceVersion: bundle.run.evidenceVersion, ...overrides };
}

export async function readyStore(flags: Flag[] = [], claimStatus: ClaimStatus = 'overlap_only') {
  const storage = memoryStorage();
  const store = createLocalStore(storage, { now: fixedNow, newId: idFactory() });
  const run = await store.createRun({ system: 'B4', mode: 'demo', sourceId: 'test', voiceId: 'test',
    sourceText: 'Checked output.', samples: ['Write brief notes.'], toggles: {}, aliases: {}, protectedTerms: [] });
  const attempt: Attempt = {
    id: 'attempt-1', runId: run.id, ordinal: 1, requestKey: null, state: 'complete', outputText: 'Checked output.',
    contentHash: await contentHash('Checked output.'), flags, repairRequest: null, verdict: verdictOf(flags, claimStatus),
    claimStatus, judgeCoverage: null, styleDistance: null, styleReason: 'Under 600 words.', error: null, createdAt: TEST_TIME,
  };
  await store.appendAttempt(attempt);
  await store.finishRun(run.id, { status: 'review_ready', selectedAttemptId: attempt.id, verdict: attempt.verdict, error: null });
  const bundle = (await store.loadRun(run.id))!;
  return { storage, store, bundle, attempt };
}
