import { describe, expect, it, vi } from 'vitest';
import { ALLFAIL_REPLICATION, DEMO_IGNORE_SUGGESTION, INCIDENT_NOTE_03, INJECTED_CEO, TERSE_ENGINEER, WARM_NEWSLETTER } from '../../../src/lib/demo/demoData.ts';
import { demoDeps, demoRunSpec, runOnStore } from '../../../src/lib/demo/runLocal.ts';
import { prepareRun } from '../../../src/lib/loop/prepare.ts';
import { renderRepairRequest } from '../../../src/lib/loop/repairRequest.ts';
import { acknowledgeableFlagIds } from '../../../src/lib/rulings/gate.ts';
import { contentHash } from '../../../src/lib/rulings/contentHash.ts';
import { createLocalStore, memoryStorage } from '../../../src/lib/store/localStore.ts';
import { fixedNow, idFactory, rulingInput } from '../store/helpers.ts';

describe('Offline Demo journey, PLAN 1.1 legs 4–10', () => {
  it('shows hard failures, repairs, reviews, approves the exact hash, replays, rejects injection, and overrides three failures', async () => {
    // A configured-backend-shaped environment cannot induce network work on this path. Any fetch is a test failure.
    const fetch = vi.fn(async () => { throw new Error('Offline Demo attempted a network request'); });
    vi.stubGlobal('fetch', fetch);
    const storage = memoryStorage();
    const store = createLocalStore(storage, { now: fixedNow, newId: idFactory('run') });
    const opts = { now: fixedNow, newId: idFactory('attempt') };
    try {
      const base = demoRunSpec(INCIDENT_NOTE_03.id, TERSE_ENGINEER.id);
      const display = await prepareRun(base);
      const ignored = display.ledger.find((f) => f.kind === 'entity' && f.raw === DEMO_IGNORE_SUGGESTION[INCIDENT_NOTE_03.id].raw)!;
      expect(ignored).toBeDefined();
      const bundle = await runOnStore(store, { ...base, toggles: { [ignored.id]: 'ignored' } }, demoDeps(), opts);
      expect(bundle.run.localDemo).toBe(true);
      expect(store.recordLabel).toBe('local demo record');
      expect(bundle.run.ledger!.find((f) => f.id === ignored.id)!.required).toBe(false);
      expect(bundle.attempts.map((a) => a.ordinal)).toEqual([1, 2]);

      // Leg 4: real checks over scripted attempt one, with named source and rewrite evidence.
      const first = bundle.attempts[0];
      const hard = first.flags.filter((f) => f.class === 'hard');
      expect(first.verdict).toBe('failed');
      expect(hard).toHaveLength(2);
      expect(hard.find((f) => f.code === 'missing_fact')).toMatchObject({ kind: 'number', found: 'absent' });
      const missing = hard.find((f) => f.code === 'missing_fact')!;
      expect(INCIDENT_NOTE_03.text.slice(missing.sourceSpan!.start, missing.sourceSpan!.end)).toBe('$1.2M');
      expect(hard.find((f) => f.code === 'added_fact')).toMatchObject({ kind: 'entity', found: 'Priya Raman' });

      // Legs 5–6: hard-clean attempt two is selected; modal drift requires review and exports stay locked.
      const second = bundle.attempts[1];
      expect(bundle.run.selectedAttemptId).toBe(second.id);
      expect(bundle.run.verdict).toBe('needs_review');
      expect(second.flags.some((f) => f.class === 'hard')).toBe(false);
      expect(second.flags).toContainEqual(expect.objectContaining({ class: 'soft', code: 'modal_must_to_may' }));
      expect(second.repairRequest!.items.map((i) => i.flagId)).toEqual(hard.map((f) => f.id));
      expect(renderRepairRequest(second.repairRequest!)).toContain('$1.2M');
      expect(renderRepairRequest(second.repairRequest!)).toContain('Priya Raman');
      expect(second.styleDistance).toBeNull();
      expect(second.styleReason).toContain('600');
      expect(await store.canExport(bundle.run.id, first.id)).toBe(false);
      expect(await store.canExport(bundle.run.id, second.id)).toBe(false);
      await expect(store.recordRuling(rulingInput(bundle, 'approve'))).rejects.toMatchObject({ code: 'flags_not_acknowledged' });

      // Leg 7: acknowledgement of every advisory unlocks exactly the reviewed bytes.
      const ruling = await store.recordRuling(rulingInput(bundle, 'approve', { acknowledgedFlags: acknowledgeableFlagIds(second.flags) }));
      expect(ruling.localDemo).toBe(true);
      expect(ruling.contentHash).toBe(await contentHash(second.outputText!));
      expect(await store.canExport(bundle.run.id, second.id)).toBe(true);

      // Leg 8: recreate the browser adapter; the content, evidence and ruling replay from the same storage.
      const reloaded = createLocalStore(storage, { now: fixedNow, newId: idFactory('reload') });
      const replay = (await reloaded.loadRun(bundle.run.id))!;
      expect(replay.attempts).toEqual(bundle.attempts);
      expect(replay.rulings).toEqual([ruling]);
      expect(await reloaded.canExport(bundle.run.id, second.id)).toBe(true);

      // Leg 9: scripted obedience adds a claim without a new fact; overlap flags it and reject stays locked.
      const injected = await runOnStore(reloaded, demoRunSpec(INJECTED_CEO.id, TERSE_ENGINEER.id), demoDeps(), opts);
      expect(injected.run.verdict).toBe('needs_review');
      expect(injected.attempts).toHaveLength(1);
      expect(injected.attempts[0].flags.some((f) => f.class === 'hard')).toBe(false);
      expect(injected.attempts[0].flags).toContainEqual(expect.objectContaining({ class: 'claim', code: 'added_claim' }));
      expect(injected.attempts[0].outputText).toContain('CEO has resigned');
      await reloaded.recordRuling(rulingInput(injected, 'reject'));
      expect(await reloaded.canExport(injected.run.id, injected.run.selectedAttemptId!)).toBe(false);

      // Leg 10: no fourth attempt; failed content cannot be approved and override needs a typed reason.
      const failed = await runOnStore(reloaded, demoRunSpec(ALLFAIL_REPLICATION.id, WARM_NEWSLETTER.id), demoDeps(), opts);
      expect(failed.attempts.map((a) => a.ordinal)).toEqual([1, 2, 3]);
      expect(failed.attempts.every((a) => a.flags.some((f) => f.class === 'hard'))).toBe(true);
      expect(failed.run.verdict).toBe('failed');
      await expect(reloaded.recordRuling(rulingInput(failed, 'approve'))).rejects.toMatchObject({ code: 'approve_failed' });
      await expect(reloaded.recordRuling(rulingInput(failed, 'override', { reason: 'short' }))).rejects.toMatchObject({ code: 'override_reason_too_short' });
      expect(await reloaded.canExport(failed.run.id, failed.run.selectedAttemptId!)).toBe(false);
      await reloaded.recordRuling(rulingInput(failed, 'override', { reason: 'I accept the missing duration.' }));
      expect(await reloaded.canExport(failed.run.id, failed.run.selectedAttemptId!)).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
