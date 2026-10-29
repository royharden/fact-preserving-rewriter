// GENERATED from src/lib/claims/blank.ts; edit the source and run npm run sync:functions.
// Number and date blanking (spec item 8): code already checks numbers and dates, so judged sentences show markers
// instead. Uses the fact ledger of the text, so blanking matches exactly what the hard checks compared.

import type { Fact, Span } from '../factledger/types.ts';

export const NUMBER_MARK = '[NUMBER]';
export const DATE_MARK = '[DATE]';
export const MARK_RE = /\[(?:NUMBER|DATE)\]/g;

/** text[span] with every number/date fact (clipped to the span) replaced by its marker. */
export function blankSpan(text: string, span: Span, ledger: readonly Fact[]): string {
  const facts = ledger
    .filter((f) => (f.kind === 'number' || f.kind === 'date') && f.start < span.end && span.start < f.end)
    .sort((a, b) => a.start - b.start);
  let out = '';
  let pos = span.start;
  for (const f of facts) {
    const start = Math.max(f.start, pos);
    if (start > pos) out += text.slice(pos, start);
    out += f.kind === 'number' ? NUMBER_MARK : DATE_MARK;
    pos = Math.min(f.end, span.end);
  }
  return out + text.slice(pos, span.end);
}

/** Whole text blanked. */
export function blankFacts(text: string, ledger: readonly Fact[]): string {
  return blankSpan(text, { start: 0, end: text.length }, ledger);
}
