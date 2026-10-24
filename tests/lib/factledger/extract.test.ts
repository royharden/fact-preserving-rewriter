import { describe, it, expect } from 'vitest';
import { ex, expectWellFormed, norms, raws } from './helpers.ts';
import { unknownToggleIds } from '../../../src/lib/factledger/extract.ts';
import { findQuotes } from '../../../src/lib/factledger/quotes.ts';

describe('quotes', () => {
  it('curly double and single quotes are quote facts; numbers inside are not numbers', () => {
    const f = ex('She said “we will ship 3 fixes” and called it ‘a 2-day job’ again.');
    expect(norms(f, 'quote')).toEqual(['we will ship 3 fixes', 'a 2-day job']);
    expect(raws(f, 'quote')).toEqual(['“we will ship 3 fixes”', '‘a 2-day job’']);
    expect(norms(f, 'number')).toEqual([]);
  });

  it('straight quotes work; apostrophes are not quotes', () => {
    expect(norms(ex('Ops said "roll back now" but we don’t know Ada’s plan.'), 'quote')).toEqual(['roll back now']);
    expect(norms(ex("We don't know if it's done."), 'quote')).toEqual([]);
  });

  it('a quote never crosses a blank line', () => {
    expect(findQuotes('He said "first\n\nsecond" later')).toEqual([]);
  });
});

describe('verbatim', () => {
  it('URLs, emails, code spans, versions, identifiers and hashes are verbatim', () => {
    const f = ex('See https://example.com/a?b=1. Mail ops@example.com or run `npm ci` on build 3f2a9c1 (v2.3.1, ABC-1234).');
    expect(raws(f, 'verbatim')).toEqual(['https://example.com/a?b=1', 'ops@example.com', '`npm ci`', '3f2a9c1', 'v2.3.1', 'ABC-1234']);
    expect(norms(f, 'number')).toEqual([]);
  });
});

describe('extract: precedence, offsets, ids', () => {
  it('precedence verbatim -> quote -> date -> number -> entity, with no overlaps', () => {
    const text = 'Ticket ABC-1234 says "deploy v2.3.1 by 5 pm" and costs $5.';
    const f = ex(text);
    expectWellFormed(text, f);
    expect(f.map((x) => `${x.id}:${x.kind}`)).toEqual(['V1:verbatim', 'Q1:quote', 'N1:number']);
    // the verbatim span fully inside the quote is absorbed by the quote; the time inside it is not a date
    expect(f.some((x) => x.raw === 'v2.3.1')).toBe(false);
  });

  it('ids are per kind, in document order', () => {
    const f = ex('Costs rose 5% and 7% while Acme and Globex waited.');
    expect(f.map((x) => `${x.id}=${x.raw}`)).toEqual(['N1=5%', 'N2=7%', 'E1=Acme', 'E2=Globex']);
  });

  it('half-open UTF-16 offsets survive emoji (surrogate pairs)', () => {
    const text = '🚀 Launch: Acme raised $1.2M on 2026-10-24 (ticket ABC-1234) 🎉 “ship it” said Dr. Ada Lin.';
    const f = ex(text);
    expectWellFormed(text, f);
    for (const x of f) expect(text.slice(x.start, x.end)).toBe(x.raw);
    const at = (raw: string) => f.find((x) => x.raw === raw);
    expect(at('$1.2M')?.start).toBe(text.indexOf('$1.2M'));
    expect(at('$1.2M')?.end).toBe(text.indexOf('$1.2M') + 5);
    expect(at('ABC-1234')?.start).toBe(text.indexOf('ABC-1234'));
    expect(at('“ship it”')?.start).toBe(text.indexOf('“ship it”'));
    expect(at('Ada Lin')?.start).toBe(text.indexOf('Ada Lin'));
    expect(at('2026-10-24')?.kind).toBe('date');
    expect(norms(f, 'entity')).toEqual(['Acme', 'Ada Lin']);
  });

  it('toggles mark facts ignored; unknown toggle ids are reported', () => {
    const f = ex('Costs rose 5% and 7%.', { toggles: { N1: 'ignored' } });
    expect(f.map((x) => x.required)).toEqual([false, true]);
    expect(unknownToggleIds(f, { N1: 'ignored', N9: 'required', E1: 'ignored' })).toEqual(['E1', 'N9']);
  });

  it('extraction is deterministic', () => {
    const text = 'Dr. Ada Lin said “ship v2.3.1” and we saved $1.2M next Friday.';
    expect(ex(text)).toEqual(ex(text));
  });
});
