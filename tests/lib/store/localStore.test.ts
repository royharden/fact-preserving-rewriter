import { describe, expect, it } from 'vitest';
import { createLocalStore, LOCAL_STORE_PREFIX } from '../../../src/lib/store/localStore.ts';
import { fixedNow, idFactory, readyStore, rulingInput } from './helpers.ts';

describe('local browser-storage replay', () => {
  it('replays the exact run, attempts and append-only rulings after a new store instance', async () => {
    const { storage, store, bundle, attempt } = await readyStore();
    await store.recordRuling(rulingInput(bundle, 'approve'));
    const before = await store.loadRun(bundle.run.id);
    const reloaded = createLocalStore(storage, { now: fixedNow, newId: idFactory('reload') });
    expect(reloaded.kind).toBe('local');
    expect(reloaded.recordLabel).toBe('local demo record');
    expect(await reloaded.loadRun(bundle.run.id)).toEqual(before);
    expect(await reloaded.canExport(bundle.run.id, attempt.id)).toBe(true);
    expect((await reloaded.listRuns())[0].localDemo).toBe(true);
    await reloaded.recordRuling(rulingInput(bundle, 'reject'));
    expect(await store.canExport(bundle.run.id, attempt.id)).toBe(false);
    expect((await store.loadRun(bundle.run.id))!.rulings.map((r) => r.decision)).toEqual(['approve', 'reject']);
  });

  it('does not accept new attempts or change selection after review_ready', async () => {
    const { store, bundle, attempt } = await readyStore();
    await expect(store.appendAttempt({ ...attempt, id: 'attempt-2', ordinal: 2 })).rejects.toThrow('frozen');
    await expect(store.finishRun(bundle.run.id, { status: 'review_ready', selectedAttemptId: attempt.id, verdict: 'failed', error: null })).rejects.toThrow('already review_ready');
  });

  it('does not use a ruling on stale evidence, another selection, or a still-judging run', async () => {
    const { store, storage, bundle, attempt } = await readyStore();
    await store.recordRuling(rulingInput(bundle, 'approve'));
    const key = `${LOCAL_STORE_PREFIX}run:${bundle.run.id}`;
    storage.setItem(key, JSON.stringify({ ...bundle.run, evidenceVersion: bundle.run.evidenceVersion + 1 }));
    expect(await store.canExport(bundle.run.id, attempt.id)).toBe(false);
    storage.setItem(key, JSON.stringify({ ...bundle.run, selectedAttemptId: 'other-attempt' }));
    expect(await store.canExport(bundle.run.id, attempt.id)).toBe(false);
    storage.setItem(key, JSON.stringify({ ...bundle.run, status: 'judging' }));
    expect(await store.canExport(bundle.run.id, attempt.id)).toBe(false);
  });

  it('deletes only this app prefix and reports corrupted records instead of silently resetting history', async () => {
    const { store, storage, bundle } = await readyStore();
    storage.setItem('other-app', 'keep');
    storage.setItem(`${LOCAL_STORE_PREFIX}run:${bundle.run.id}`, '{broken JSON');
    await expect(store.loadRun(bundle.run.id)).rejects.toThrow('corrupted record');
    await store.deleteMyData();
    expect(await store.listRuns()).toEqual([]);
    expect(storage.keys()).toEqual(['other-app']);
  });
});
