// localStore: the Offline Demo store. Runs, attempts and rulings live in a Storage-like backend (window.localStorage in
// the browser, an in-memory map in tests) and replay on reload. Every record is marked localDemo and labelled "local
// demo record": nothing here is a server-enforced ruling. Rulings use the same gate as the record_ruling RPC; attempts
// are append-only and frozen once the run is review_ready.

import type { Attempt, Run, Ruling } from '../../contracts/run.ts';
import { LOCAL_DEMO_LABEL } from '../../contracts/run.ts';
import { canExport, validateRuling } from '../rulings/gate.ts';
import type { RulingInput } from '../rulings/types.ts';
import { RulingRefused } from '../rulings/types.ts';
import { MAX_ATTEMPTS } from '../loop/runPipeline.ts';
import { selectAttempt } from '../loop/select.ts';
import { verdictOf } from '../loop/verdict.ts';
import type { NewRunInput, RunBundle, RunFinish, Store } from './types.ts';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory StorageLike (tests, and the fallback when browser storage is unavailable). */
export function memoryStorage(): StorageLike & { keys(): string[] } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    keys: () => [...map.keys()],
  };
}

export interface LocalStoreOptions {
  now?: () => Date;
  newId?: () => string;
  prefix?: string;
}

export const LOCAL_STORE_PREFIX = 'fpr:v1:';

export function createLocalStore(storage: StorageLike, opts: LocalStoreOptions = {}): Store {
  const prefix = opts.prefix ?? LOCAL_STORE_PREFIX;
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  const k = {
    index: `${prefix}runs`,
    run: (id: string) => `${prefix}run:${id}`,
    attempts: (id: string) => `${prefix}attempts:${id}`,
    rulings: (id: string) => `${prefix}rulings:${id}`,
  };

  function read<T>(key: string, fallback: T): T {
    const raw = storage.getItem(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`local store: corrupted record ${key}`);
    }
  }
  const write = (key: string, value: unknown): void => storage.setItem(key, JSON.stringify(value));
  const ids = (): string[] => read<string[]>(k.index, []);
  const getRun = (id: string): Run | null => read<Run | null>(k.run(id), null);
  const getAttempts = (id: string): Attempt[] => read<Attempt[]>(k.attempts(id), []);
  const getRulings = (id: string): Ruling[] => read<Ruling[]>(k.rulings(id), []);

  function requireRun(id: string): Run {
    const run = getRun(id);
    if (!run) throw new Error(`local store: run ${id} not found`);
    return run;
  }

  const store: Store = {
    kind: 'local',
    recordLabel: LOCAL_DEMO_LABEL,

    async createRun(input: NewRunInput): Promise<Run> {
      if (input.mode === 'live') throw new Error('local store: live runs require the server store');
      const d = input.derived;
      const run: Run = {
        id: newId(),
        userId: null,
        system: input.system,
        mode: input.mode,
        sourceId: input.sourceId,
        voiceId: input.voiceId,
        profileId: input.profileId ?? null,
        sourceText: input.sourceText,
        samples: [...input.samples],
        toggles: { ...input.toggles },
        aliases: { ...input.aliases },
        protectedTerms: [...input.protectedTerms],
        sourceHash: d?.sourceHash ?? null,
        ledger: d?.ledger ?? null,
        maskNamespace: d?.maskNamespace ?? null,
        referenceTime: d?.referenceTime ?? null,
        checkerVersion: d?.checkerVersion ?? null,
        promptVersion: d?.promptVersion ?? null,
        maskVersion: d?.maskVersion ?? null,
        status: 'open',
        evidenceVersion: 0,
        selectedAttemptId: null,
        verdict: null,
        error: null,
        createdAt: now().toISOString(),
        localDemo: true,
      };
      write(k.run(run.id), run);
      write(k.index, [...ids(), run.id]);
      return run;
    },

    async listRuns(): Promise<Run[]> {
      return ids()
        .map(getRun)
        .filter((r): r is Run => r !== null)
        .reverse();
    },

    async loadRun(runId: string): Promise<RunBundle | null> {
      const run = getRun(runId);
      if (!run) return null;
      return { run, attempts: getAttempts(runId).sort((a, b) => a.ordinal - b.ordinal), rulings: getRulings(runId) };
    },

    async appendAttempt(attempt: Attempt): Promise<void> {
      const run = requireRun(attempt.runId);
      if (run.status !== 'open' && run.status !== 'attempting') throw new Error('local store: evidence is frozen once attempting ends');
      const existing = getAttempts(run.id);
      const cap = run.system === 'B4' ? MAX_ATTEMPTS : 1;
      if (!Number.isInteger(attempt.ordinal) || attempt.ordinal < 1 || attempt.ordinal > cap) throw new Error(`local store: ordinal ${attempt.ordinal} outside 1..${cap}`);
      if (existing.some((a) => a.ordinal === attempt.ordinal || a.id === attempt.id)) throw new Error(`local store: attempt ${attempt.ordinal} already exists`);
      if (attempt.ordinal !== existing.length + 1) throw new Error('local store: attempt ordinals must be consecutive');
      const previous = existing[existing.length - 1];
      if (previous && (previous.state !== 'complete' || !previous.flags.some((f) => f.class === 'hard'))) {
        throw new Error('local store: retry requires a completed attempt with hard failures');
      }
      write(k.attempts(run.id), [...existing, attempt]);
      if (run.status === 'open') write(k.run(run.id), { ...run, status: 'attempting' });
    },

    async finishRun(runId: string, finish: RunFinish): Promise<Run> {
      const run = requireRun(runId);
      if (run.status === 'review_ready') throw new Error('local store: run is already review_ready');
      if (finish.status !== 'review_ready' && finish.status !== 'judging') throw new Error('local store: finish must enter judging or review_ready');
      const selected = selectAttempt(getAttempts(runId));
      if ((selected?.id ?? null) !== finish.selectedAttemptId) throw new Error('local store: selection must be the best completed attempt');
      if (!selected && (finish.verdict !== null || finish.error === null)) throw new Error('local store: no completed content requires an error and no verdict');
      if (selected && (finish.verdict !== verdictOf(selected.flags, selected.claimStatus) || selected.verdict !== finish.verdict)) {
        throw new Error('local store: verdict must match selected evidence');
      }
      const next: Run = {
        ...run,
        status: finish.status,
        selectedAttemptId: finish.selectedAttemptId,
        verdict: finish.verdict,
        error: finish.error,
        evidenceVersion: finish.status === 'review_ready' ? run.evidenceVersion + 1 : run.evidenceVersion,
      };
      write(k.run(runId), next);
      return next;
    },

    async recordRuling(input: RulingInput): Promise<Ruling> {
      const run = getRun(input.runId);
      const attempt = run ? getAttempts(run.id).find((a) => a.id === input.attemptId) ?? null : null;
      const check = validateRuling(run, attempt, input);
      if (!check.ok) throw new RulingRefused(check.code, check.message);
      const r = run as Run;
      const a = attempt as Attempt;
      const ruling: Ruling = {
        id: newId(),
        kind: 'rewrite',
        userId: null,
        runId: r.id,
        attemptId: a.id,
        contentHash: a.contentHash as string,
        evidenceVersion: r.evidenceVersion,
        decision: input.decision,
        reason: input.reason?.trim() ? input.reason.trim() : null,
        acknowledgedFlags: [...(input.acknowledgedFlags ?? [])],
        createdAt: now().toISOString(),
        localDemo: true,
      };
      write(k.rulings(r.id), [...getRulings(r.id), ruling]);
      return ruling;
    },

    async canExport(runId: string, attemptId: string): Promise<boolean> {
      const run = getRun(runId);
      const attempt = getAttempts(runId).find((a) => a.id === attemptId);
      if (!run || run.status !== 'review_ready' || run.selectedAttemptId !== attemptId || !attempt ||
          attempt.state !== 'complete' || attempt.contentHash === null || attempt.outputText === null) return false;
      const rulings = getRulings(runId).filter((r) => r.runId === runId && r.evidenceVersion === run.evidenceVersion);
      return canExport(rulings, attemptId, attempt.contentHash);
    },

    async deleteMyData(): Promise<void> {
      for (const id of ids()) {
        storage.removeItem(k.run(id));
        storage.removeItem(k.attempts(id));
        storage.removeItem(k.rulings(id));
      }
      storage.removeItem(k.index);
    },
  };
  return store;
}
