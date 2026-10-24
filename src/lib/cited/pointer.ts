// `cited` pointer kind `text:start-end` (half-open UTF-16 offsets into a named text). Proposed to the `cited` owner as
// an addition; recorded as a deviation in docs/DESIGN.md (M6).

import type { Span } from '../factledger/types.ts';

const POINTER_RE = /^text:(0|[1-9]\d*)-(0|[1-9]\d*)$/;

export function formatPointer(span: Span): string {
  if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end < span.start) {
    throw new Error(`invalid span ${span.start}-${span.end}`);
  }
  return `text:${span.start}-${span.end}`;
}

export function parsePointer(pointer: string): Span | null {
  const m = POINTER_RE.exec(pointer);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
  return { start, end };
}

/** The slice a pointer names, or null when it is malformed or out of range. */
export function resolvePointer(text: string, pointer: string): string | null {
  const span = parsePointer(pointer);
  if (!span || span.end > text.length) return null;
  return text.slice(span.start, span.end);
}
