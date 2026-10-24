import { extract } from '../../../src/lib/factledger/extract.ts';
import type { ExtractOptions, Fact, FactKind } from '../../../src/lib/factledger/types.ts';

/** Fixed reference instant used by every ledger test (never the wall clock). */
export const REF = new Date('2026-10-24T12:00:00Z');

export function ex(text: string, opts: Partial<ExtractOptions> = {}): Fact[] {
  return extract(text, { referenceTime: REF, ...opts });
}

export function norms(facts: readonly Fact[], kind: FactKind): string[] {
  return facts.filter((f) => f.kind === kind).map((f) => f.normalised);
}

export function raws(facts: readonly Fact[], kind: FactKind): string[] {
  return facts.filter((f) => f.kind === kind).map((f) => f.raw);
}

/** Invariants every ledger must satisfy: raw is the exact slice, spans never overlap, ids are per-kind sequential. */
export function expectWellFormed(text: string, facts: readonly Fact[]): void {
  const counters = new Map<string, number>();
  let lastEnd = -1;
  for (const f of facts) {
    if (text.slice(f.start, f.end) !== f.raw) throw new Error(`raw mismatch for ${f.id}`);
    if (f.start < lastEnd) throw new Error(`overlap at ${f.id}`);
    lastEnd = f.end;
    const prefix = f.id[0];
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    if (f.id !== `${prefix}${n}`) throw new Error(`id out of order: ${f.id}`);
  }
}
