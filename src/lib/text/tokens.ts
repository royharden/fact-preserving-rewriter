// Word-token helpers shared by the fact ledger, the matcher and (later) the copy check.

export interface Token {
  text: string;
  start: number;
  end: number;
}

const TOKEN_CHAR = /[\p{L}\p{N}]/u;
const DIGIT = /[0-9]/;
const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/** True for a letter or digit (any script). Safe for out-of-range input ('' is not a token char). */
export function isTokenChar(ch: string): boolean {
  return ch !== '' && TOKEN_CHAR.test(ch);
}

/** Word tokens (letters/digits with internal apostrophes) with half-open UTF-16 offsets. */
export function wordTokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    const start = m.index ?? 0;
    out.push({ text: m[0], start, end: start + m[0].length });
  }
  return out;
}

/** Lower-cased, punctuation-stripped word tokens (used by the 8-word copy check). */
export function normalisedWords(text: string): string[] {
  return wordTokens(text)
    .map((t) => t.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w !== '');
}

/**
 * True when text[start,end) is bounded by non-token characters on both sides. A '.' or ',' between two digits is
 * treated as part of a number, so "5" inside "1.5" or "1,500" is not a whole token.
 */
export function isWholeTokenAt(text: string, start: number, end: number): boolean {
  const before = text.charAt(start - 1);
  const after = text.charAt(end);
  if (isTokenChar(before) || isTokenChar(after)) return false;
  if ((before === '.' || before === ',') && DIGIT.test(text.charAt(start - 2)) && DIGIT.test(text.charAt(start))) return false;
  if ((after === '.' || after === ',') && DIGIT.test(text.charAt(end + 1)) && DIGIT.test(text.charAt(end - 1))) return false;
  return true;
}

/** Start offsets of every whole-token occurrence of needle in text (case-sensitive, no substring hits). */
export function wholeTokenOccurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  if (needle === '') return out;
  let i = text.indexOf(needle);
  while (i !== -1) {
    if (isWholeTokenAt(text, i, i + needle.length)) out.push(i);
    i = text.indexOf(needle, i + 1);
  }
  return out;
}
