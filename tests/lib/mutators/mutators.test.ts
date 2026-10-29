import { describe, expect, it } from 'vitest';
import { mutate, MUTATION_TYPES } from '../../../src/lib/mutators/index.ts';
import type { GoldSpan } from '../../../src/lib/mutators/types.ts';
describe('seeded corruption generation', () => {
  const text = 'We spent 12 dollars on March 3, 2026 with Pelora Works. She said “remain calm”. We must not change all records; only some are ready.';
  const make = (raw: string, kind: GoldSpan['kind'], id: string): GoldSpan => ({ raw, kind, id, start: text.indexOf(raw), end: text.indexOf(raw) + raw.length, required: true });
  const gold = [make('12 dollars', 'number', 'N1'), make('March 3, 2026', 'date', 'D1'), make('Pelora Works', 'entity', 'E1'), make('“remain calm”', 'quote', 'Q1')];
  it.each(MUTATION_TYPES)('%s records reproducible non-noop text and location', (type) => {
    const one = mutate(type, text, gold, 37), two = mutate(type, text, gold, 37);
    expect(one).toEqual(two); expect(one.mutation).not.toBeNull();
    if (!one.mutation) throw new Error('expected applicable mutation');
    const m = one.mutation;
    expect(m.text).not.toBe(text); expect(text.slice(m.location.start, m.location.end)).toBe(m.before);
    expect(text.slice(0, m.location.start) + m.after + text.slice(m.location.end)).toBe(m.text);
  });
  it('missing target refuses instead of manufacturing a no-op', () => {
    for (const type of ['number', 'date', 'entity', 'quote_word', 'negation', 'modal', 'quantifier', 'unit'] as const) expect(mutate(type, 'ordinary prose', [], 1)).toMatchObject({ mutation: null, rejected: 'no applicable non-noop target' });
    expect(mutate('sentence_drop', '', [], 1).mutation).toBeNull();
    expect(mutate('claim_insertion', 'The secret committee approved an unrelated merger.', [], 1).mutation).toBeNull();
  });
  it('stale annotation spans cannot silently corrupt a different location', () => { expect(() => mutate('number', 'changed', gold, 1)).toThrow('stale gold'); });
});
