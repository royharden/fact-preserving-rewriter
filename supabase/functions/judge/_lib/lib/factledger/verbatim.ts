// GENERATED from src/lib/factledger/verbatim.ts; edit the source and run npm run sync:functions.
// Verbatim spans: code, URLs, emails, versions, identifiers and paths. They are compared byte-for-byte, masked before
// the model sees the text, and never read as numbers or entities.

import type { Candidate } from './types.ts';

const PATTERNS: readonly RegExp[] = [
  /```[\s\S]*?```/g, // fenced code block
  /`[^`\n]+`/g, // inline code span
  /\b(?:https?:\/\/|www\.)[^\s<>"'“”‘’]+/gi, // URL (trailing punctuation trimmed below)
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, // email
  /\bv?\d+\.\d+\.\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]*[0-9A-Za-z])?/g, // version 2.3.1 / v2.3.1-rc.1 / IPv4
  /\bv\d+(?:\.\d+)?\b/g, // v2, v2.3
  /\b[A-Z][A-Z0-9]*-\d+(?:-[A-Za-z0-9]+)*\b/g, // ticket ids: ABC-1234, COVID-19
  /\b[A-Za-z]+\d[A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*\b/g, // letters then digit: H100, IPv6, S3, Q3, x86
  /\b\d+[A-Za-z]+\d[A-Za-z0-9]*\b/g, // digit-letter-digit mixes such as hashes: 3f2a9c1
  /\b[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\b/g, // snake_case identifiers
  /(?<![\w/.])\/(?:[\w.-]+\/)+[\w.-]*/g, // absolute paths: /var/log/app/
  /\b[\w-]+\.(?:js|mjs|ts|tsx|json|ya?ml|md|py|txt|log|sql|csv|html|css|sh|toml|env)\b/g, // file names
];

function trimUrl(raw: string): string {
  let s = raw.replace(/[.,;:!?]+$/, '');
  // drop a trailing ")" or "]" that has no opener inside the URL
  while (/[)\]]$/.test(s)) {
    const close = s.endsWith(')') ? ')' : ']';
    const open = close === ')' ? '(' : '[';
    if (s.split(open).length >= s.split(close).length) break;
    s = s.slice(0, -1).replace(/[.,;:!?]+$/, '');
  }
  return s;
}

/** Non-overlapping verbatim candidates, earliest start first, longest wins at the same start. */
export function findVerbatim(text: string): Candidate[] {
  const found: Candidate[] = [];
  PATTERNS.forEach((re, i) => {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      const raw = i === 2 ? trimUrl(m[0]) : m[0].replace(/-+$/, '');
      if (raw === '') continue;
      found.push({ kind: 'verbatim', start, end: start + raw.length, normalised: raw });
    }
  });
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Candidate[] = [];
  let lastEnd = -1;
  for (const c of found) {
    if (c.start >= lastEnd) {
      out.push(c);
      lastEnd = c.end;
    }
  }
  return out;
}
