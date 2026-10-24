import { describe, it, expect } from 'vitest';
import { ex, norms, raws } from './helpers.ts';
import { bareHalfSpans } from '../../../src/lib/factledger/numbers.ts';

describe('numbers: currency and magnitudes', () => {
  it('$1.2M = 1,200,000 dollars = 1.2 million dollars', () => {
    const a = norms(ex('Revenue was $1.2M this quarter.'), 'number');
    const b = norms(ex('Revenue was 1,200,000 dollars this quarter.'), 'number');
    const c = norms(ex('Revenue was 1.2 million dollars this quarter.'), 'number');
    expect(a).toEqual(['currency 1200000 USD']);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('3 million = 3,000,000 (explicit equivalence)', () => {
    expect(norms(ex('The budget is 3 million.'), 'number')).toEqual(['scalar 3000000']);
    expect(norms(ex('The budget is 3,000,000.'), 'number')).toEqual(['scalar 3000000']);
    expect(norms(ex('The budget is three million.'), 'number')).toEqual(['scalar 3000000']);
  });

  it('keeps exact decimal strings (no float rounding)', () => {
    expect(norms(ex('It cost $0.15 per call and 2.5bn overall.'), 'number')).toEqual(['currency 0.15 USD', 'scalar 2500000000']);
  });
});

describe('numbers: percent', () => {
  it('50% = fifty percent = 50 per cent (explicit equivalence)', () => {
    const a = norms(ex('Churn fell 50% last month.'), 'number');
    expect(a).toEqual(['percent 50']);
    expect(norms(ex('Churn fell fifty percent last month.'), 'number')).toEqual(a);
    expect(norms(ex('Churn fell 50 per cent last month.'), 'number')).toEqual(a);
  });
});

describe('numbers: ranges', () => {
  it('5 to 7 = 5-7 = five to seven = between 5 and 7', () => {
    const expected = ['range 5..7 minute'];
    expect(norms(ex('Recovery takes 5 to 7 minutes.'), 'number')).toEqual(expected);
    expect(norms(ex('Recovery takes 5-7 minutes.'), 'number')).toEqual(expected);
    expect(norms(ex('Recovery takes five to seven minutes.'), 'number')).toEqual(expected);
    expect(norms(ex('Recovery takes between 5 and 7 minutes.'), 'number')).toEqual(expected);
  });

  it('a unit swap changes the value', () => {
    expect(norms(ex('Recovery takes 5 to 7 hours.'), 'number')).toEqual(['range 5..7 hour']);
  });

  it('a magnitude written once applies to both ends', () => {
    expect(norms(ex('We expect $5-7M in bookings.'), 'number')).toEqual(['range 5000000..7000000 USD']);
  });
});

describe('numbers: spelled out', () => {
  it('twelve is 12', () => {
    expect(norms(ex('The team has twelve engineers.'), 'number')).toEqual(['scalar 12']);
    expect(norms(ex('The team has 12 engineers.'), 'number')).toEqual(['scalar 12']);
  });

  it('two to ninety-nine, hyphenated or not', () => {
    expect(norms(ex('We saw twenty-one alerts and ninety nine retries.'), 'number')).toEqual(['scalar 21', 'scalar 99']);
  });

  it('bare and pronoun "one" are not numbers', () => {
    expect(norms(ex('No one noticed, and one of the nodes is the one we fixed.'), 'number')).toEqual([]);
  });

  it('"one" before a magnitude is a number', () => {
    expect(norms(ex('We reached one million users.'), 'number')).toEqual(['scalar 1000000']);
  });
});

describe('numbers: half', () => {
  it('half a million is 500000', () => {
    expect(norms(ex('We saved half a million dollars.'), 'number')).toEqual(['currency 500000 USD']);
  });

  it('half (of) the <noun> equals 50% of the <noun> with the same head only', () => {
    const f = ex('Half the servers failed; 50% of the servers recovered; half of the routers rebooted.');
    expect(norms(f, 'number')).toEqual(['fraction 0.5 servers', 'fraction 0.5 servers', 'fraction 0.5 routers']);
    expect(raws(f, 'number')[1]).toBe('50% of the servers');
  });

  it('a bare half is not a fact but is reported by bareHalfSpans', () => {
    const text = 'About half failed, half a million were saved and half the disks survived.';
    expect(norms(ex('About half failed.'), 'number')).toEqual([]);
    expect(bareHalfSpans(text)).toEqual([{ start: 6, end: 10 }]);
  });
});

describe('numbers: what is not a number', () => {
  it('numbers inside verbatim spans are never numbers (ABC-1234, v2.3.1)', () => {
    const f = ex('Ticket ABC-1234 shipped in v2.3.1 for 4 teams.');
    expect(raws(f, 'verbatim')).toEqual(['ABC-1234', 'v2.3.1']);
    expect(norms(f, 'number')).toEqual(['scalar 4']);
  });

  it('ordered-list markers and decades are not numbers', () => {
    expect(norms(ex('1. Restart the pod\n2. Verify'), 'number')).toEqual([]);
    expect(norms(ex('Popular in the 1990s.'), 'number')).toEqual([]);
  });

  it('ordinals and attached units are kept with their unit', () => {
    expect(norms(ex('Our 4th try took 30s and used 10GB.'), 'number')).toEqual([
      'scalar 4 ordinal',
      'scalar 30 second',
      'scalar 10 GB',
    ]);
  });
});
