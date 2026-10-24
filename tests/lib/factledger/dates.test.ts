import { describe, it, expect } from 'vitest';
import { ex, norms, raws } from './helpers.ts';
import { normaliseDate } from '../../../src/lib/factledger/dates.ts';
import type { DateComponent, DateComponents } from '../../../src/lib/factledger/dates.ts';

/** Fake chrono components: `known` values are certain, `implied` values are not. */
function comps(known: Partial<Record<DateComponent, number>>, implied: Partial<Record<DateComponent, number>> = {}): DateComponents {
  return {
    get: (c) => known[c] ?? implied[c] ?? null,
    isCertain: (c) => known[c] !== undefined,
  };
}

describe('normaliseDate (own normaliser, no chrono)', () => {
  it('keeps precision; different precision never compares equal', () => {
    expect(normaliseDate('October 24, 2026', comps({ year: 2026, month: 10, day: 24 }))).toBe('day 2026-10-24');
    expect(normaliseDate('October 2026', comps({ year: 2026, month: 10 }, { day: 1 }))).toBe('month 2026-10');
    expect(normaliseDate('2026', comps({ year: 2026 }, { month: 1, day: 1 }))).toBe('year 2026');
  });

  it('keeps the written zone and does not convert it', () => {
    const implied = { year: 2026, month: 10, day: 24 };
    expect(normaliseDate('14:00 UTC', comps({ hour: 14, minute: 0, timezoneOffset: 0 }, implied))).toBe('time T14:00 +00:00');
    expect(normaliseDate('6:00 PST', comps({ hour: 6, minute: 0, timezoneOffset: -480 }, implied))).toBe('time T06:00 -08:00');
    expect(normaliseDate('14:00', comps({ hour: 14, minute: 0 }, implied))).toBe('time T14:00 local');
    expect(normaliseDate('Oct 24 at 14:00 UTC', comps({ month: 10, day: 24, hour: 14, minute: 0, timezoneOffset: 0 }, { year: 2026 }))).toBe(
      'time 2026-10-24T14:00 +00:00',
    );
  });

  it('compares relative and ambiguous numeric dates verbatim', () => {
    expect(normaliseDate('next Friday', comps({ weekday: 5 }, { year: 2026, month: 10, day: 30 }))).toBe('relative next Friday');
    expect(normaliseDate('03/04', comps({ month: 3, day: 4 }, { year: 2026 }))).toBe('numeric 03/04');
  });
});

describe('dates through extract (chrono-node recognition)', () => {
  it('"next Friday" is a relative date kept verbatim', () => {
    const f = ex('The fix lands next Friday.');
    expect(norms(f, 'date')).toEqual(['relative next Friday']);
    expect(raws(f, 'date')).toEqual(['next Friday']);
  });

  it('absolute dates in different formats normalise equally', () => {
    expect(norms(ex('It shipped on October 24, 2026.'), 'date')).toEqual(['day 2026-10-24']);
    expect(norms(ex('It shipped on 24 October 2026.'), 'date')).toEqual(['day 2026-10-24']);
    expect(norms(ex('It shipped on 2026-10-24.'), 'date')).toEqual(['day 2026-10-24']);
  });

  it('a month-only date has month precision', () => {
    expect(norms(ex('It shipped in October 2026.'), 'date')).toEqual(['month 2026-10']);
  });

  it('uses the fixed reference time, never the wall clock', () => {
    expect(norms(ex('It shipped on October 24.'), 'date')).toEqual(['day 2026-10-24']);
    expect(norms(ex('It shipped on October 24.', { referenceTime: new Date('2030-10-01T00:00:00Z') }), 'date')).toEqual(['day 2030-10-24']);
  });

  it('time zones: UTC = GMT, PST differs, no zone differs', () => {
    const utc = norms(ex('The window opens at 14:00 UTC.'), 'date');
    expect(utc).toEqual(['time T14:00 +00:00']);
    expect(norms(ex('The window opens at 14:00 GMT.'), 'date')).toEqual(utc);
    expect(norms(ex('The window opens at 14:00 PST.'), 'date')).not.toEqual(utc);
    expect(norms(ex('The window opens at 14:00.'), 'date')).not.toEqual(utc);
  });

  it('03/04 is ambiguous and compared verbatim (never converted)', () => {
    expect(norms(ex('The audit is due 03/04.'), 'date')).toEqual(['numeric 03/04']);
    expect(norms(ex('The audit is due 3/4.'), 'date')).toEqual(['numeric 3/4']);
  });

  it('modal "may", durations and money are not dates', () => {
    expect(norms(ex('We may restart within 5 minutes for $1.2M.'), 'date')).toEqual([]);
  });
});
