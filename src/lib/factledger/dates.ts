// Dates: chrono-node recognises spans against a fixed reference instant; this module filters chrono's matches and
// normalises them itself, keeping precision (year | month | day | time) and the written time zone. Relative dates
// ("next Friday") and numeric slash dates ("03/04") are compared byte-for-byte, never converted.

import * as chrono from 'chrono-node';
import type { Candidate, Span } from './types.ts';
import { isFree } from './normalise.ts';

/** Same names as chrono-node's Component union. */
export type DateComponent =
  | 'year' | 'month' | 'day' | 'weekday' | 'hour' | 'minute' | 'second' | 'millisecond' | 'meridiem' | 'timezoneOffset';

/** The subset of chrono's ParsedComponents this module reads (method syntax keeps it assignable from chrono's type). */
export interface DateComponents {
  get(component: DateComponent): number | null;
  isCertain(component: DateComponent): boolean;
}

const RELATIVE_RE =
  /\b(?:next|last|this|coming|past|previous|tomorrow|yesterday|today|tonight|ago|later|earlier|within|hence|from now|in (?:a|an|\d+|[a-z]+) (?:days?|weeks?|months?|years?))\b/i;
const SUBDAY_DURATION_RE = /\b(?:seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i;
const NUMERIC_DATE_RE = /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/;
const TIME_MARKER_RE = /\d:\d{2}|\d\s?[ap]\.?m\.?|\bnoon\b|\bmidnight\b|o['’]clock/i;
const LEADING_WORD_RE = /^(?:on|at|by|the)\s+/i;
const ZONE_RE = /\b(?:UTC|GMT|Z|[A-Z]{1,4}T)(?:[+-]\d{1,2}(?::?\d{2})?)?(?![\p{L}])/u;
const KEEP_LOWERCASE_SINGLE = /^(?:today|tomorrow|yesterday|tonight|noon|midnight)$/i;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function zoneOf(c: DateComponents, raw: string): string {
  const offset = c.get('timezoneOffset');
  if (c.isCertain('timezoneOffset') && offset !== null) return formatOffset(offset);
  const m = ZONE_RE.exec(raw);
  return m ? m[0].toUpperCase() : 'local';
}

interface DatePoint {
  precision: 'year' | 'month' | 'day' | 'time';
  value: string;
}

function point(c: DateComponents, raw: string): DatePoint | null {
  const y = c.get('year');
  const mo = c.get('month');
  const d = c.get('day');
  const ymd = y !== null && mo !== null && d !== null ? `${pad(y, 4)}-${pad(mo)}-${pad(d)}` : null;
  if (c.isCertain('hour')) {
    const h = c.get('hour') ?? 0;
    const mi = c.get('minute') ?? 0;
    const sec = c.isCertain('second') ? `:${pad(c.get('second') ?? 0)}` : '';
    const day = c.isCertain('day') && ymd ? ymd : '';
    return { precision: 'time', value: `${day}T${pad(h)}:${pad(mi)}${sec} ${zoneOf(c, raw)}` };
  }
  // Year-less dates take chrono's implied year from the fixed reference time.
  if (c.isCertain('day') && ymd) return { precision: 'day', value: ymd };
  if (c.isCertain('month') && y !== null && mo !== null) return { precision: 'month', value: `${pad(y, 4)}-${pad(mo)}` };
  if (c.isCertain('year') && y !== null) return { precision: 'year', value: pad(y, 4) };
  return null;
}

/**
 * Normalised value of a recognised date span. Different precisions never compare equal; a zone is kept as written
 * (offset when chrono is certain of it, else the abbreviation, else "local") and never converted.
 */
export function normaliseDate(raw: string, start: DateComponents, end?: DateComponents | null): string {
  const text = raw.trim();
  if (NUMERIC_DATE_RE.test(text)) return `numeric ${raw}`;
  if (RELATIVE_RE.test(text) || (start.isCertain('weekday') && !start.isCertain('day'))) return `relative ${raw}`;
  const a = point(start, text);
  if (!a) return `relative ${raw}`;
  const b = end ? point(end, text) : null;
  if (!b) return `${a.precision} ${a.value}`;
  return a.precision === b.precision ? `${a.precision} ${a.value}..${b.value}` : `${a.precision} ${a.value}..${b.precision} ${b.value}`;
}

/** Rejects chrono matches that are numbers, durations or ordinary words rather than dates. */
function acceptable(raw: string, start: DateComponents, end?: DateComponents | null): boolean {
  if (raw === '' || /^now$/i.test(raw)) return false;
  // a single lower-case word ("may", "march", "sun") is a word, not a date
  if (/^[a-z]+$/.test(raw) && !KEEP_LOWERCASE_SINGLE.test(raw)) return false;
  // durations below a day are numbers ("within 5 minutes")
  if (SUBDAY_DURATION_RE.test(raw)) return false;
  // a bare duration ("7 days") with no relative word is a number, not a date
  if (/^[\d\s.,]+(?:days?|weeks?|months?|years?)$/i.test(raw)) return false;
  // "1.2", "5-7": numeric with '.' or '-' separators and no four-digit year is a number, not a date
  if (/^[\d\s.\-–]+$/.test(raw) && !/\d{4}/.test(raw)) return false;
  // a time with no date part needs an explicit time marker ("at 5" is not a time)
  const hasDatePart = ['year', 'month', 'day', 'weekday'].some((k) => start.isCertain(k as DateComponent));
  if (!hasDatePart && start.isCertain('hour') && !TIME_MARKER_RE.test(raw)) return false;
  if (!hasDatePart && !start.isCertain('hour') && !RELATIVE_RE.test(raw) && !KEEP_LOWERCASE_SINGLE.test(raw)) return false;
  if (end && !hasDatePart && end.isCertain('hour') && !TIME_MARKER_RE.test(raw)) return false;
  return true;
}

/** Date candidates that do not overlap already-claimed spans (verbatim, quotes). */
export function findDates(text: string, referenceTime: Date, claimed: readonly Span[]): Candidate[] {
  const results = chrono.parse(text, { instant: referenceTime, timezone: 'UTC' }, { forwardDate: false });
  const out: Candidate[] = [];
  for (const r of results) {
    let start = r.index;
    let raw = r.text;
    const lead = LEADING_WORD_RE.exec(raw);
    if (lead) {
      start += lead[0].length;
      raw = raw.slice(lead[0].length);
    }
    const trimmed = raw.replace(/[\s,;:]+$/, '');
    const end = start + trimmed.length;
    if (!acceptable(trimmed, r.start, r.end)) continue;
    // a numeric date glued to a currency sign, decimal point or letter is part of something else
    if (/^\d/.test(trimmed) && /[$€£¥.\p{L}\p{N}]/u.test(text.charAt(start - 1))) continue;
    if (!isFree(claimed, start, end)) continue;
    if (out.some((o) => start < o.end && o.start < end)) continue;
    out.push({ kind: 'date', start, end, normalised: normaliseDate(trimmed, r.start, r.end) });
  }
  return out;
}
