// Quoted spans in straight or curly quotes. The fact span includes the quote marks (so masking hides them too); the
// normalised value is the inner text, compared byte-for-byte.

import type { Candidate } from './types.ts';

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const OPEN_CONTEXT = /[\s([{—–-]/;

/** Single-quote openers must start a word: preceded by start/space/bracket/dash, followed by a non-space. */
function singleOpenOk(text: string, i: number): boolean {
  const before = text.charAt(i - 1);
  const after = text.charAt(i + 1);
  return (i === 0 || OPEN_CONTEXT.test(before)) && after !== '' && /\S/.test(after);
}

/** Single-quote closers follow a non-space and are not followed by a letter/digit (so "don’t" is not a closer). */
function singleCloseOk(text: string, j: number): boolean {
  const after = text.charAt(j + 1);
  return /\S/.test(text.charAt(j - 1)) && !(after !== '' && LETTER_OR_DIGIT.test(after));
}

/**
 * Index of the closing mark, or -1. Double quotes may span single line breaks but never a blank line; single quotes
 * stay on one line.
 */
function findClose(text: string, from: number, isClose: (j: number) => boolean, multiLine: boolean): number {
  for (let j = from; j < text.length; j++) {
    const c = text.charAt(j);
    if (c === '\n') {
      if (!multiLine) return -1;
      if (/^\n[ \t]*\n/.test(text.slice(j, j + 64))) return -1;
    }
    if (isClose(j)) return j;
  }
  return -1;
}

export function findQuotes(text: string): Candidate[] {
  const out: Candidate[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    let close = -1;
    if (c === '“') close = findClose(text, i + 1, (j) => text.charAt(j) === '”', true);
    else if (c === '"') close = findClose(text, i + 1, (j) => text.charAt(j) === '"', true);
    else if (c === '‘' && singleOpenOk(text, i)) close = findClose(text, i + 1, (j) => text.charAt(j) === '’' && singleCloseOk(text, j), false);
    else if (c === "'" && singleOpenOk(text, i)) close = findClose(text, i + 1, (j) => text.charAt(j) === "'" && singleCloseOk(text, j), false);
    if (close > i + 1) {
      out.push({ kind: 'quote', start: i, end: close + 1, normalised: text.slice(i + 1, close) });
      i = close + 1;
    } else {
      i++;
    }
  }
  return out;
}
