// extract(text, opts) -> Fact[]: runs the recognisers in precedence order (verbatim, quote, date, number, entity),
// each one only on text not claimed by a higher kind, then assigns per-kind ids in document order.

import type { Candidate, ExtractOptions, Fact } from './types.ts';
import { KIND_PREFIX } from './types.ts';
import { overlaps } from './normalise.ts';
import { findVerbatim } from './verbatim.ts';
import { findQuotes } from './quotes.ts';
import { findDates } from './dates.ts';
import { findNumbers } from './numbers.ts';
import { findEntities } from './entities.ts';

export function extract(text: string, opts: ExtractOptions): Fact[] {
  let claimed: Candidate[] = findVerbatim(text);

  // A quote that fully contains verbatim spans absorbs them (the whole quote is masked and compared byte-for-byte);
  // a quote that only partly overlaps a verbatim span loses to it.
  for (const q of findQuotes(text)) {
    const hits = claimed.filter((c) => overlaps(c, q));
    if (hits.every((h) => q.start <= h.start && h.end <= q.end)) {
      claimed = claimed.filter((c) => !hits.includes(c));
      claimed.push(q);
    }
  }
  claimed.push(...findDates(text, opts.referenceTime, claimed));
  claimed.push(...findNumbers(text, claimed));
  claimed.push(...findEntities(text, claimed, opts));

  claimed.sort((a, b) => a.start - b.start || a.end - b.end);
  const counters: Record<string, number> = {};
  return claimed.map((c) => {
    const prefix = KIND_PREFIX[c.kind];
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    const id = `${prefix}${counters[prefix]}`;
    return {
      id,
      kind: c.kind,
      raw: text.slice(c.start, c.end),
      normalised: c.normalised,
      start: c.start,
      end: c.end,
      required: opts.toggles?.[id] !== 'ignored',
    };
  });
}

/** Fact ids in the ledger that a toggle map names but the ledger does not contain (the server rejects these: HTTP 422). */
export function unknownToggleIds(ledger: readonly Fact[], toggles: Readonly<Record<string, unknown>>): string[] {
  const ids = new Set(ledger.map((f) => f.id));
  return Object.keys(toggles).filter((id) => !ids.has(id)).sort();
}
