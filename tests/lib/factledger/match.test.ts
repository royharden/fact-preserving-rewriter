import { describe, it, expect } from 'vitest';
import { ex } from './helpers.ts';
import { match } from '../../../src/lib/factledger/match.ts';
import type { ExtractOptions } from '../../../src/lib/factledger/types.ts';

function run(source: string, rewrite: string, opts: Partial<ExtractOptions> = {}) {
  const src = ex(source, opts);
  const rw = ex(rewrite, { ...opts, toggles: undefined, contextText: source });
  return { src, rw, result: match(src, rw, rewrite, source) };
}

describe('match: missing', () => {
  it('reports a missing fact with its id and source span', () => {
    const { result } = run('Revenue hit $1.2M on 2026-10-24.', 'Revenue hit a record on 2026-10-24.');
    expect(result.missing).toHaveLength(1);
    const m = result.missing[0];
    expect(m.fact.id).toBe('N1');
    expect(m.fact.raw).toBe('$1.2M');
    expect([m.fact.start, m.fact.end]).toEqual([12, 17]);
    expect(m.found).toBeNull();
    expect(result.added).toEqual([]);
  });

  it('names what was found instead, and reports it as added', () => {
    const { result } = run('Revenue hit $1.2M on 2026-10-24.', 'Revenue hit $1.3M on 2026-10-24.');
    expect(result.missing.map((m) => [m.fact.raw, m.found?.raw])).toEqual([['$1.2M', '$1.3M']]);
    expect(result.added.map((a) => a.fact.raw)).toEqual(['$1.3M']);
  });

  it('equivalent forms are kept, not missing', () => {
    const { result } = run(
      'Revenue was $1.2M; the budget is 3 million; churn fell 50%; recovery takes 5 to 7 minutes.',
      'Revenue was 1,200,000 dollars; the budget is 3,000,000; churn fell fifty percent; recovery takes five to seven minutes.',
    );
    expect(result.missing).toEqual([]);
    expect(result.added).toEqual([]);
    expect(result.kept).toHaveLength(4);
  });

  it('multiplicity counts: two required 3s need two 3s', () => {
    const { result } = run('We added 3 nodes and 3 disks.', 'We added 3 nodes and some disks.');
    expect(result.missing.map((m) => m.fact.id)).toEqual(['N2']);
  });

  it('a different date precision is not a match', () => {
    const { result } = run('It shipped on October 24, 2026.', 'It shipped in October 2026.');
    expect(result.missing.map((m) => m.fact.kind)).toEqual(['date']);
    expect(result.added.map((a) => a.fact.kind)).toEqual(['date']);
  });

  it('a relative date must survive byte-identical', () => {
    const { result } = run('The fix lands next Friday.', 'The fix lands on Friday next week.');
    expect(result.missing.map((m) => m.fact.raw)).toEqual(['next Friday']);
  });
});

describe('match: added', () => {
  it('a capitalised word moved mid-sentence that occurs in the source as the same token is not added', () => {
    const { result } = run('Payments were slow. The team fixed it.', 'The team fixed Payments, which were slow.');
    expect(result.added).toEqual([]);
  });

  it('substring occurrences never exempt an added entity', () => {
    const { result } = run('Outages hit Acmeville twice.', 'Outages hit Acme twice.');
    expect(result.added.map((a) => a.fact.raw)).toEqual(['Acme']);
    expect(result.missing.map((m) => m.fact.raw)).toEqual(['Acmeville']);
  });

  it('a number leaked from elsewhere is added', () => {
    const { result } = run('We fixed the bug.', 'We fixed the bug in 12 hours for Globex.');
    expect(result.added.map((a) => a.fact.normalised)).toEqual(['scalar 12 hour', 'Globex']);
  });

  it('a whole-token occurrence inside a different-kind fact does not exempt', () => {
    // "1234" appears in the source only inside the verbatim id ABC-1234
    const { result } = run('Ticket ABC-1234 is closed.', 'Ticket ABC-1234 is closed after 1234 checks.');
    expect(result.added.map((a) => a.fact.raw)).toEqual(['1234']);
  });
});

describe('match: ignored facts', () => {
  it('ignored facts are exempt from missing only, never from added', () => {
    const { src, result } = run('Ada Lin and Bob Ray met.', 'Ada Lin met Carol Diaz.', { toggles: { E2: 'ignored' } });
    expect(src.map((f) => `${f.id}:${f.raw}:${f.required}`)).toEqual(['E1:Ada Lin:true', 'E2:Bob Ray:false']);
    expect(result.missing).toEqual([]);
    expect(result.added.map((a) => a.fact.raw)).toEqual(['Carol Diaz']);
  });

  it('ignoring a number does not license a changed number', () => {
    const { result } = run('Revenue hit $1.2M.', 'Revenue hit $1.3M.', { toggles: { N1: 'ignored' } });
    expect(result.missing).toEqual([]);
    expect(result.added.map((a) => a.fact.raw)).toEqual(['$1.3M']);
  });
});

describe('match: aliases', () => {
  it('a protected-term alias in the rewrite matches its canonical term', () => {
    const { result } = run('The move to Acme Cloud finished.', 'The move to AC finished.', { aliases: { 'Acme Cloud': ['AC'] } });
    expect(result.missing).toEqual([]);
    expect(result.added).toEqual([]);
  });
});
