// Exact decimal-string arithmetic (no floats) and shared normalisation helpers.

import type { Fact, Span } from './types.ts';

const DECIMAL_RE = /^(-)?(\d*)(?:\.(\d*))?$/;

/** Canonical decimal string: separators removed, no leading zeros, no trailing fractional zeros, no "-0". */
export function canonicalDecimal(input: string): string {
  const m = DECIMAL_RE.exec(input.replace(/,/g, ''));
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`not a decimal: ${input}`);
  const int = (m[2] || '0').replace(/^0+(?=\d)/, '');
  const frac = (m[3] ?? '').replace(/0+$/, '');
  const negative = m[1] === '-' && (int !== '0' || frac !== '');
  return (negative ? '-' : '') + int + (frac ? `.${frac}` : '');
}

/** value * 10^places, exact. */
export function shiftDecimal(value: string, places: number): string {
  const c = canonicalDecimal(value);
  const negative = c.startsWith('-');
  const [int, frac = ''] = (negative ? c.slice(1) : c).split('.');
  let digits = int + frac;
  let point = int.length + places;
  if (point <= 0) {
    digits = '0'.repeat(1 - point) + digits;
    point = 1;
  }
  if (point > digits.length) digits += '0'.repeat(point - digits.length);
  return canonicalDecimal(`${negative ? '-' : ''}${digits.slice(0, point)}.${digits.slice(point)}`);
}

/** value / 2, exact (computed as value * 5 / 10). */
export function halveDecimal(value: string): string {
  const c = canonicalDecimal(value);
  const negative = c.startsWith('-');
  const [int, frac = ''] = (negative ? c.slice(1) : c).split('.');
  const times5 = (BigInt(int + frac) * 5n).toString();
  return canonicalDecimal((negative ? '-' : '') + shiftDecimal(times5, -(frac.length + 1)));
}

/** Entity comparison text: whitespace collapsed, curly apostrophes straightened. Case is kept. */
export function normaliseEntityText(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/’/g, "'").trim();
}

/** Matching key of a fact: kind + normalised value. */
export function factKey(fact: Pick<Fact, 'kind' | 'normalised'>): string {
  return `${fact.kind}:${fact.normalised}`;
}

export function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

export function isFree(claimed: readonly Span[], start: number, end: number): boolean {
  for (const c of claimed) if (start < c.end && c.start < end) return false;
  return true;
}

/** End of the claimed span containing pos, or -1. */
export function claimedEndAt(claimed: readonly Span[], pos: number): number {
  for (const c of claimed) if (c.start <= pos && pos < c.end) return c.end;
  return -1;
}
