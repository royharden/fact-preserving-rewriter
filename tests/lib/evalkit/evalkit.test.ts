import { describe, expect, it } from 'vitest';
import { wilson } from '../../../src/lib/evalkit/wilson.ts';
import { seededRandom, shuffle } from '../../../src/lib/evalkit/seed.ts';
import { assertSplitIsolation, assignSplits, assignVoicePairs } from '../../../src/lib/evalkit/seededSplit.ts';
import { evidenceLabel, summarizeRows, validateRow } from '../../../src/lib/evalkit/resultsMd.ts';
import type { EvalRow } from '../../../src/lib/evalkit/resultsMd.ts';
describe('Wilson source assertions (not executed during construction)', () => {
  // Hand calculation with z=1.95996398454: n=20, z²=3.84145882069.
  // 0/20 -> [0,z²/(20+z²)]; 10/20 -> .5±z*sqrt(.25/20+z²/1600)/(1+z²/20).
  it.each([[0, 0, 0.1611251580528194], [10, 0.2992980081982123, 0.7007019918017877], [20, 0.8388748419471806, 1]])('matches hand computed %i/20', (successes, lower, upper) => {
    const result = wilson(successes, 20);
    expect(result.lower).toBeCloseTo(lower, 10); expect(result.upper).toBeCloseTo(upper, 10);
  });
  it('zero observations remain unmeasured; impossible counts refuse', () => { expect(wilson(0, 0).rate).toBeNull(); expect(() => wilson(21, 20)).toThrow(); });
});
describe('frozen split and evidence', () => {
  const ids = Array.from({ length: 30 }, (_, i) => `source-${String(i).padStart(2, '0')}`);
  it('isolates every source across two voice pairings and ignores input order', () => {
    const split = assignSplits(ids), pairs = assignVoicePairs(ids, ['b', 'a', 'c']);
    expect(Object.values(split).filter((s) => s === 'dev')).toHaveLength(10);
    expect(assignSplits([...ids].reverse())).toEqual(split);
    expect(assignVoicePairs([...ids].reverse(), ['c', 'b', 'a'])).toEqual(pairs);
    expect(pairs.filter((p) => split[p.source_id] === 'heldout')).toHaveLength(40);
    expect(() => assertSplitIsolation(pairs.map((p) => ({ ...p, split: split[p.source_id] })))).not.toThrow();
    expect(() => assertSplitIsolation([{ source_id: 'x', split: 'dev' }, { source_id: 'x', split: 'heldout' }])).toThrow('leakage');
    expect(shuffle(ids, seededRandom(8))).toEqual(shuffle(ids, seededRandom(8)));
  });
  const row: EvalRow = { source_id: 's', voice_id: 'v', split: 'heldout', system: 'B4', mode: 'mock', label: 'mock (scripted outputs)', voice_placeholder: false, complete: false, error: 'provider failed', final_text: null, preserved: false, missing_facts: 2, added_facts: 0, style_delta: null, attempts: 1, latency_ms: 10, source_words: 100, ledger_ids: [], reserved_micro_usd: null, actual_micro_usd: null };
  it('never relabels mocks as live and refuses missing live ledger ids', () => {
    expect(evidenceLabel('B0', 'live')).toBe('computed, no model call');
    expect(() => validateRow({ ...row, mode: 'live', label: evidenceLabel('B4', 'live') })).toThrow('ledger');
    expect(() => validateRow({ ...row, mode: 'live', ledger_ids: ['call-1'], label: evidenceLabel('B4', 'live') })).toThrow('model ids');
    expect(() => validateRow({ ...row, label: 'live' })).toThrow('label');
    expect(() => validateRow({ ...row, preserved: true })).toThrow('incomplete');
  });
  it('failure stays in denominator, null cost never becomes a measured zero', () => {
    const summary = summarizeRows([row]) as { fact_preservation: { total: number; successes: number }; actual_usd_per_1000_source_words: number | null; source_cluster_count: number }[];
    expect(summary[0].fact_preservation).toMatchObject({ total: 1, successes: 0 });
    expect(summary[0].actual_usd_per_1000_source_words).toBeNull(); expect(summary[0].source_cluster_count).toBe(1);
  });
});
