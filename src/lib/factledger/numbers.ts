// Numbers: digits (with separators/decimals), magnitudes ($1.2M, 3 million), currency, percent ("per cent"), ranges
// ("5 to 7", "5-7", "between 5 and 7"), spelled two..ninety-nine (+ hundreds and magnitudes), "half" forms and a
// small unit list. Values are exact decimal strings; normalised forms:
//   scalar <v>[ <unit>] | currency <v> <CUR> | percent <v> | range <lo>..<hi>[ <unit>|percent|<CUR>] | fraction <v> <head>
// Bare/pronoun "one" is never a number; "half" with no resolvable head is not a fact (see bareHalfSpans).

import type { Candidate, Span } from './types.ts';
import { canonicalDecimal, claimedEndAt, halveDecimal, isFree, shiftDecimal } from './normalise.ts';

const MAGNITUDE: Readonly<Record<string, number>> = {
  thousand: 3, million: 6, billion: 9, trillion: 12,
  k: 3, K: 3, M: 6, mn: 6, m: 6, B: 9, bn: 9, T: 12,
};
const MAG_WORDS = new Set(['thousand', 'million', 'billion', 'trillion']);
const UNITS_1_9: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const SMALL: Readonly<Record<string, number>> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Readonly<Record<string, number>> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const CURRENCY_PREFIX: Readonly<Record<string, string>> = { 'US$': 'USD', $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', USD: 'USD', EUR: 'EUR', GBP: 'GBP', JPY: 'JPY' };
const CURRENCY_WORD: Readonly<Record<string, string>> = {
  dollar: 'USD', dollars: 'USD', usd: 'USD', euro: 'EUR', euros: 'EUR', eur: 'EUR', gbp: 'GBP', yen: 'JPY', jpy: 'JPY',
};
const UNIT_WORD: Readonly<Record<string, string>> = {
  millisecond: 'millisecond', milliseconds: 'millisecond', second: 'second', seconds: 'second', sec: 'second', secs: 'second',
  minute: 'minute', minutes: 'minute', min: 'minute', mins: 'minute', hour: 'hour', hours: 'hour', hr: 'hour', hrs: 'hour',
  day: 'day', days: 'day', week: 'week', weeks: 'week', month: 'month', months: 'month', year: 'year', years: 'year',
  yr: 'year', yrs: 'year', kilometre: 'km', kilometres: 'km', kilometer: 'km', kilometers: 'km', mile: 'mile',
  miles: 'mile', metre: 'm', metres: 'm', meter: 'm', meters: 'm', kilogram: 'kg', kilograms: 'kg', pound: 'lb',
  pounds: 'lb', degree: 'degree', degrees: 'degree', byte: 'byte', bytes: 'byte', times: 'x',
};
// abbreviations allowed attached ("10GB", "24h") or after one space ("10 GB"); case-sensitive
const UNIT_ABBR: Readonly<Record<string, string>> = {
  ms: 'millisecond', s: 'second', sec: 'second', min: 'minute', mins: 'minute', h: 'hour', hr: 'hour', hrs: 'hour',
  KB: 'KB', MB: 'MB', GB: 'GB', TB: 'TB', PB: 'PB', km: 'km', kg: 'kg', cm: 'cm', mm: 'mm', m: 'm', lb: 'lb',
  lbs: 'lb', '°C': '°C', '°F': '°F', x: 'x',
};
const HEAD_STOP = new Set(['of', 'a', 'an', 'the', 'and', 'or', 'to', 'in', 'on', 'at', 'is', 'are', 'was', 'were']);

const DIGITS_Y = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/y;
const MAG_Y = /(?: ((?:[Tt]housand|[Mm]illion|[Bb]illion|[Tt]rillion|THOUSAND|MILLION|BILLION|TRILLION))|(k|K|M|B|bn|mn|T|m))(?![\p{L}\p{N}])/uy;
const ORDINAL_Y = /(?:st|nd|rd|th)(?![\p{L}\p{N}])/uy;
const UNIT_ABBR_Y = / ?(ms|sec|mins?|hrs?|KB|MB|GB|TB|PB|km|kg|cm|mm|lbs?|°C|°F|[shmx])(?![\p{L}\p{N}])/uy;
const UNIT_WORD_Y = / ([A-Za-z]+)(?![\p{L}])/uy;
const PERCENT_Y = /(?:\s?%|\s(?:percent|per[ -]cent|pct)(?![\p{L}]))/uiy;
const CURRENCY_PREFIX_Y = /(?:US\$|\$|€|£|¥|(?:USD|EUR|GBP|JPY) ?)/y;
const CURRENCY_WORD_Y = / (?:US )?(dollars?|USD|euros?|EUR|GBP|yen|JPY)(?![\p{L}])/uiy;
const RANGE_SEP_Y = /(?: ?[-–—] ?| (?:to|through) )/y;
const BETWEEN_Y = /between /iy;
const AND_Y = / and /y;
const OF_THE_Y = / of the (\p{L}+)/uy;
const HALF_HEAD_Y = /half (?:of )?the (\p{L}+)/iuy;
const LIST_MARKER_Y = /[ \t]*\d+[.)][ \t]/y;
const WORD_Y = /[A-Za-z]+/y;

function at(re: RegExp, text: string, pos: number): RegExpExecArray | null {
  re.lastIndex = pos;
  return re.exec(text);
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isLetter = (c: string): boolean => c !== '' && /\p{L}/u.test(c);
const isAlnum = (c: string): boolean => c !== '' && /[\p{L}\p{N}]/u.test(c);

interface Atom {
  start: number;
  end: number;
  value: string;
  magExp: number;
  spelled: boolean;
}

interface Side {
  start: number;
  end: number;
  atom: Atom;
  currency?: string;
  percent: boolean;
  unit?: string;
}

function digitAtom(text: string, pos: number, allowLowerM: boolean): Atom | null {
  const before = text.charAt(pos - 1);
  if (!isDigit(text.charAt(pos)) || isAlnum(before) || ((before === '.' || before === ',') && isDigit(text.charAt(pos - 2)))) return null;
  const m = at(DIGITS_Y, text, pos);
  if (!m) return null;
  let end = pos + m[0].length;
  // "1,2345" or "1.2.3" leftovers: not a clean number
  if (isDigit(text.charAt(end)) || ((text.charAt(end) === '.' || text.charAt(end) === ',') && isDigit(text.charAt(end + 1)))) return null;
  let value = canonicalDecimal(m[1] + (m[2] ? `.${m[2]}` : ''));
  let magExp = 0;
  const mag = at(MAG_Y, text, end);
  if (mag) {
    const word = mag[1] !== undefined ? mag[1].toLowerCase() : mag[2];
    if (word !== 'm' || allowLowerM) {
      magExp = MAGNITUDE[word];
      value = shiftDecimal(value, magExp);
      end += mag[0].length;
    }
  }
  return { start: pos, end, value, magExp, spelled: false };
}

interface Word {
  w: string;
  start: number;
  end: number;
}

/** Up to `max` words joined by single spaces or hyphens, starting at pos. */
function wordsFrom(text: string, pos: number, max = 8): Word[] {
  const out: Word[] = [];
  let p = pos;
  while (out.length < max) {
    const m = at(WORD_Y, text, p);
    if (!m) break;
    out.push({ w: m[0].toLowerCase(), start: p, end: p + m[0].length });
    p += m[0].length;
    const sep = text.charAt(p);
    if ((sep !== ' ' && sep !== '-') || !/[A-Za-z]/.test(text.charAt(p + 1))) break;
    p += 1;
  }
  return out;
}

function under100(ws: readonly Word[], j: number, allowOne: boolean): { n: number; next: number } | null {
  const w = ws[j]?.w;
  if (w === undefined) return null;
  if (Object.hasOwn(TENS, w)) {
    const unit = ws[j + 1]?.w;
    if (unit !== undefined && Object.hasOwn(UNITS_1_9, unit)) return { n: TENS[w] + UNITS_1_9[unit], next: j + 2 };
    return { n: TENS[w], next: j + 1 };
  }
  if (Object.hasOwn(SMALL, w)) return { n: SMALL[w], next: j + 1 };
  if (w === 'one') {
    const nextWord = ws[j + 1]?.w;
    if (allowOne || nextWord === 'hundred' || (nextWord !== undefined && MAG_WORDS.has(nextWord))) return { n: 1, next: j + 1 };
  }
  return null;
}

/** Spelled numbers: "twelve", "twenty-one", "two hundred and fifty", "three million", "a million", "half a million". */
function spelledAtom(text: string, pos: number): Atom | null {
  if (isLetter(text.charAt(pos - 1))) return null;
  const ws = wordsFrom(text, pos);
  if (ws.length === 0) return null;
  const w = (k: number): string | undefined => ws[k]?.w;
  const done = (value: string, k: number, magExp: number): Atom | null =>
    isAlnum(text.charAt(ws[k - 1].end)) ? null : { start: pos, end: ws[k - 1].end, value, magExp, spelled: true };

  const mag2 = w(2);
  if (w(0) === 'half' && w(1) === 'a' && mag2 !== undefined && MAG_WORDS.has(mag2)) {
    return done(halveDecimal(shiftDecimal('1', MAGNITUDE[mag2])), 3, MAGNITUDE[mag2]);
  }
  let n: number;
  let i: number;
  const w1 = w(1);
  if (w(0) === 'a' && w1 !== undefined && (w1 === 'hundred' || MAG_WORDS.has(w1))) {
    n = 1;
    i = 1;
  } else {
    const u = under100(ws, 0, false);
    if (!u) return null;
    n = u.n;
    i = u.next;
  }
  if (w(i) === 'hundred') {
    n *= 100;
    i += 1;
    const j = w(i) === 'and' ? i + 1 : i;
    const rest = under100(ws, j, true);
    if (rest) {
      n += rest.n;
      i = rest.next;
    }
  }
  const magWord = w(i);
  if (magWord !== undefined && MAG_WORDS.has(magWord)) {
    return done(shiftDecimal(String(n), MAGNITUDE[magWord]), i + 1, MAGNITUDE[magWord]);
  }
  return done(String(n), i, 0);
}

function parseSide(text: string, pos: number): Side | null {
  let p = pos;
  let currency: string | undefined;
  const cur = at(CURRENCY_PREFIX_Y, text, p);
  if (cur && !isAlnum(text.charAt(pos - 1))) {
    currency = CURRENCY_PREFIX[cur[0].trim()];
    p += cur[0].length;
  }
  const atom = digitAtom(text, p, currency !== undefined) ?? (currency ? null : spelledAtom(text, p));
  if (!atom) return null;
  let end = atom.end;
  let percent = false;
  let unit: string | undefined;
  if (!currency) {
    const pc = at(PERCENT_Y, text, end);
    const cw = pc ? null : at(CURRENCY_WORD_Y, text, end);
    if (pc) {
      percent = true;
      end += pc[0].length;
    } else if (cw) {
      currency = CURRENCY_WORD[cw[1].toLowerCase()];
      end += cw[0].length;
    }
  }
  if (!percent && !currency) {
    const ord = atom.spelled ? null : at(ORDINAL_Y, text, end);
    const abbr = ord ? null : at(UNIT_ABBR_Y, text, end);
    // one-letter units (s, h, m, x) must be attached ("30s", "24h", "3x"); a bare "s" is never a decade ("1990s")
    const abbrOk =
      abbr !== null &&
      !(abbr[0].startsWith(' ') && /^[shmx]$/.test(abbr[1])) &&
      !(abbr[1] === 's' && (atom.value.length > 3 || atom.magExp > 0 || /^[1-9]0$/.test(atom.value)));
    const uw = ord || abbrOk ? null : at(UNIT_WORD_Y, text, end);
    if (ord) {
      unit = 'ordinal';
      end += ord[0].length;
    } else if (abbr && abbrOk) {
      unit = UNIT_ABBR[abbr[1]];
      end += abbr[0].length;
    } else if (uw && Object.hasOwn(UNIT_WORD, uw[1].toLowerCase())) {
      unit = UNIT_WORD[uw[1].toLowerCase()];
      end += uw[0].length;
    }
  }
  // "1990s", "2FA": digits glued to an unknown word are not numbers
  if (isAlnum(text.charAt(end - 1)) && isAlnum(text.charAt(end))) return null;
  return { start: pos, end, atom, currency, percent, unit };
}

function suffixOf(currency: string | undefined, percent: boolean, unit: string | undefined): string {
  if (currency) return ` ${currency}`;
  if (percent) return ' percent';
  return unit ? ` ${unit}` : '';
}

function rangeCandidate(start: number, L: Side, R: Side): Candidate | null {
  if (L.currency && R.currency && L.currency !== R.currency) return null;
  if (L.unit && R.unit && L.unit !== R.unit) return null;
  if (L.unit === 'ordinal' || R.unit === 'ordinal') return null;
  // a magnitude written once applies to both ends: "$5-7M", "between 2 and 3 million"
  const lo = L.atom.magExp === 0 && R.atom.magExp > 0 ? shiftDecimal(L.atom.value, R.atom.magExp) : L.atom.value;
  const suffix = suffixOf(L.currency ?? R.currency, L.percent || R.percent, R.unit ?? L.unit);
  return { kind: 'number', start, end: R.end, normalised: `range ${lo}..${R.atom.value}${suffix}` };
}

function singleCandidate(text: string, s: Side): Candidate {
  if (s.currency) return { kind: 'number', start: s.start, end: s.end, normalised: `currency ${s.atom.value} ${s.currency}` };
  if (s.percent) {
    const head = at(OF_THE_Y, text, s.end);
    if (head && s.atom.value === '50' && !HEAD_STOP.has(head[1].toLowerCase())) {
      // only "50% of the servers" becomes the fraction 0.5 with head "servers" (equal to "half the servers");
      // other percentages stay plain percents so ordinary paraphrases ("30% of budget") still match
      return { kind: 'number', start: s.start, end: s.end + head[0].length, normalised: `fraction ${shiftDecimal(s.atom.value, -2)} ${head[1].toLowerCase()}` };
    }
    return { kind: 'number', start: s.start, end: s.end, normalised: `percent ${s.atom.value}` };
  }
  return { kind: 'number', start: s.start, end: s.end, normalised: `scalar ${s.atom.value}${s.unit ? ` ${s.unit}` : ''}` };
}

/** Candidate readings at pos, longest first. */
function candidatesAt(text: string, pos: number): Candidate[] {
  const out: Candidate[] = [];
  if (!isLetter(text.charAt(pos - 1))) {
    const half = at(HALF_HEAD_Y, text, pos);
    if (half && !HEAD_STOP.has(half[1].toLowerCase())) {
      out.push({ kind: 'number', start: pos, end: pos + half[0].length, normalised: `fraction 0.5 ${half[1].toLowerCase()}` });
      return out;
    }
    const between = at(BETWEEN_Y, text, pos);
    if (between) {
      const L = parseSide(text, pos + between[0].length);
      const and = L ? at(AND_Y, text, L.end) : null;
      const R = L && and ? parseSide(text, L.end + and[0].length) : null;
      const range = L && R ? rangeCandidate(pos, L, R) : null;
      if (range) out.push(range);
      return out;
    }
  }
  const L = parseSide(text, pos);
  if (!L) return out;
  const sep = at(RANGE_SEP_Y, text, L.end);
  if (sep) {
    const R = parseSide(text, L.end + sep[0].length);
    const range = R ? rangeCandidate(pos, L, R) : null;
    if (range) out.push(range);
  }
  out.push(singleCandidate(text, L));
  return out;
}

function isLineStart(text: string, pos: number): boolean {
  return pos === 0 || text.charAt(pos - 1) === '\n';
}

/** Number candidates outside claimed spans, scanned left to right without overlaps. */
export function findNumbers(text: string, claimed: readonly Span[]): Candidate[] {
  const out: Candidate[] = [];
  let pos = 0;
  while (pos < text.length) {
    const inside = claimedEndAt(claimed, pos);
    if (inside !== -1) {
      pos = inside;
      continue;
    }
    if (isLineStart(text, pos)) {
      const marker = at(LIST_MARKER_Y, text, pos); // ordered-list markers ("1. ") are not facts
      if (marker) {
        pos += marker[0].length;
        continue;
      }
    }
    const c = text.charAt(pos);
    const startChar = isDigit(c) || '$€£¥'.includes(c) || (/[A-Za-z]/.test(c) && !isLetter(text.charAt(pos - 1)));
    if (startChar) {
      const hit = candidatesAt(text, pos).find((cand) => isFree(claimed, cand.start, cand.end));
      if (hit) {
        out.push(hit);
        pos = hit.end;
        continue;
      }
    }
    // skip the rest of the current word or digit run so no number starts mid-token
    if (isAlnum(c)) {
      while (pos < text.length && isAlnum(text.charAt(pos))) pos++;
    } else {
      pos++;
    }
  }
  return out;
}

/** Spans of "half" that are neither "half a <magnitude>" nor "half (of) the <noun>": not facts, but their loss is a soft flag. */
export function bareHalfSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(/\bhalf\b/gi)) {
    const pos = m.index ?? 0;
    const head = at(HALF_HEAD_Y, text, pos);
    if (head && !HEAD_STOP.has(head[1].toLowerCase())) continue;
    if (/^half a (?:thousand|million|billion|trillion)\b/i.test(text.slice(pos, pos + 20))) continue;
    out.push({ start: pos, end: pos + 4 });
  }
  return out;
}
