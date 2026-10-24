import { describe, it, expect } from 'vitest';
import { extract } from '../../../src/lib/factledger/extract.ts';
import { mask, placeholder } from '../../../src/lib/mask/mask.ts';
import type { MaskResult } from '../../../src/lib/mask/mask.ts';
import { restore } from '../../../src/lib/mask/restore.ts';
import { checkIntegrity } from '../../../src/lib/mask/integrity.ts';
import { deriveNamespace, fixtureSeedId, MASK_VERSION, namespaceFor } from '../../../src/lib/mask/namespace.ts';

const REF = new Date('2026-10-24T12:00:00Z');
const NS = 'abc123';
// "$&" inside the quote would be expanded by a string replacement; restore must copy the slice untouched
const SOURCE = 'Ops said “restart at $&1 now” for v2.3.1 and ABC-1234 🚀.';

function masked(): MaskResult {
  return mask(SOURCE, extract(SOURCE, { referenceTime: REF }), NS);
}

describe('mask', () => {
  it('replaces quote and verbatim facts with namespaced placeholders', () => {
    const m = masked();
    expect(m.masked).toBe('Ops said ⟦abc123:Q1⟧ for ⟦abc123:V1⟧ and ⟦abc123:V2⟧ 🚀.');
    expect(m.slots.map((s) => s.factId)).toEqual(['Q1', 'V1', 'V2']);
    expect(m.masked).not.toContain('restart');
  });

  it('rejects an invalid namespace', () => {
    expect(() => mask(SOURCE, [], 'ABC')).toThrow();
  });
});

describe('restore', () => {
  it('round-trips byte-identically', () => {
    const m = masked();
    const r = restore(m.masked, m, SOURCE);
    expect(r).toEqual({ ok: true, text: SOURCE });
  });

  it('copies the original source slices into reordered output', () => {
    const m = masked();
    const output = `For ${placeholder(NS, 'V1')} and ${placeholder(NS, 'V2')}, Ops said ${placeholder(NS, 'Q1')} 🚀.`;
    const r = restore(output, m, SOURCE);
    expect(r).toEqual({ ok: true, text: 'For v2.3.1 and ABC-1234, Ops said “restart at $&1 now” 🚀.' });
  });

  it('uses the source text slice, not any other copy of the value', () => {
    const m: MaskResult = { namespace: NS, masked: 'x ⟦abc123:Q1⟧', slots: [{ token: '⟦abc123:Q1⟧', factId: 'Q1', start: 2, end: 7 }] };
    // slot 2-7 of the source text is '"hi" ' (quote marks and trailing space included)
    expect(restore('y ⟦abc123:Q1⟧', m, 'a "hi" b')).toEqual({ ok: true, text: 'y "hi" ' });
  });

  it('refuses to restore when integrity fails', () => {
    const m = masked();
    const r = restore(m.masked.replace('⟦abc123:V2⟧', ''), m, SOURCE);
    expect(r.ok).toBe(false);
  });
});

describe('integrity (checked before restore)', () => {
  const codes = (output: string) => checkIntegrity(output, masked()).map((f) => f.code);

  it('passes on the untouched masked text', () => {
    expect(codes(masked().masked)).toEqual([]);
  });

  it('missing placeholder', () => {
    const f = checkIntegrity(masked().masked.replace('⟦abc123:V2⟧', 'it'), masked());
    expect(f.map((x) => [x.code, x.factId])).toEqual([['missing', 'V2']]);
  });

  it('duplicated placeholder', () => {
    const f = checkIntegrity(`${masked().masked} again ⟦abc123:Q1⟧`, masked());
    expect(f.map((x) => [x.code, x.factId])).toEqual([['duplicate', 'Q1']]);
  });

  it('unknown placeholder (never issued, or another namespace)', () => {
    expect(codes(`${masked().masked} ⟦abc123:V9⟧`)).toEqual(['unknown']);
    expect(codes(`${masked().masked} ⟦zzz999:Q1⟧`)).toEqual(['unknown']);
  });

  it('malformed placeholder', () => {
    expect(codes(`${masked().masked} ⟧`)).toEqual(['malformed']);
    expect(codes(`${masked().masked} abc123:Q1`)).toEqual(['malformed']);
    const broken = codes(masked().masked.replace('⟦abc123:Q1⟧', '⟦abc123:Q1'));
    expect(broken).toContain('malformed');
    expect(broken).toContain('missing');
  });

  it('each failure kind has a distinct code', () => {
    const all = new Set([
      ...codes(masked().masked.replace('⟦abc123:V2⟧', '')),
      ...codes(`${masked().masked} ⟦abc123:Q1⟧`),
      ...codes(`${masked().masked} ⟦abc123:V9⟧`),
      ...codes(`${masked().masked} ⟧`),
    ]);
    expect([...all].sort()).toEqual(['duplicate', 'malformed', 'missing', 'unknown']);
  });
});

describe('namespace', () => {
  it('is deterministic from the seed and versioned', async () => {
    const a = await namespaceFor('run-1', 0);
    expect(a).toMatch(/^[0-9a-z]{6}$/);
    expect(await namespaceFor('run-1', 0)).toBe(a);
    expect(await namespaceFor('run-2', 0)).not.toBe(a);
    expect(MASK_VERSION).toBe('mask-v1');
  });

  it('uses counter 0 when there is no collision', async () => {
    const seed = fixtureSeedId('incident-note-03', 'terse-engineer', 'B4');
    expect(seed).toBe('fixture:incident-note-03:terse-engineer:B4');
    const ns = await deriveNamespace(seed, ['source text', 'sample text']);
    expect(ns).toEqual({ namespace: await namespaceFor(seed, 0), counter: 0 });
  });

  it('increments the counter while the namespace occurs in the source or any sample', async () => {
    const seed = 'run-collide';
    const first = await namespaceFor(seed, 0);
    const texts = ['plain source', `a sample that contains ${first} by chance`];
    const ns = await deriveNamespace(seed, texts);
    expect(ns.counter).toBeGreaterThan(0);
    expect(ns.namespace).not.toBe(first);
    expect(ns.namespace).toBe(await namespaceFor(seed, ns.counter));
    for (const t of texts) expect(t).not.toContain(ns.namespace);
  });
});
