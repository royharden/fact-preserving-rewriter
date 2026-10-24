// GENERATED from src/lib/style/excerpts.ts; edit the source and run npm run sync:functions.
// 2-3 short few-shot excerpts picked by code (never by a model): sentences of 8-40 words with no digits, taken at the
// first, middle and last candidate positions across the samples in order. Fewer are returned only when the samples
// have fewer candidates.

import { sentences } from '../text/segment.ts';
import { wordTokens } from '../text/tokens.ts';

export const MAX_EXCERPTS = 3;
export const EXCERPT_MIN_WORDS = 8;
export const EXCERPT_MAX_WORDS = 40;
export const EXCERPT_MAX_CHARS = 280;

export function pickExcerpts(samples: readonly string[], max = MAX_EXCERPTS): string[] {
  const candidates: string[] = [];
  for (const sample of samples) {
    for (const s of sentences(sample)) {
      const text = s.text.trim().replace(/\s+/g, ' ');
      const n = wordTokens(text).length;
      if (n < EXCERPT_MIN_WORDS || n > EXCERPT_MAX_WORDS || /\d/.test(text) || text.length > EXCERPT_MAX_CHARS) continue;
      candidates.push(text);
    }
  }
  if (candidates.length <= max || max <= 1) return candidates.slice(0, Math.max(0, max));
  const picks = new Set<number>();
  for (let k = 0; k < max; k++) picks.add(Math.round((k * (candidates.length - 1)) / (max - 1)));
  return [...picks].sort((a, b) => a - b).map((i) => candidates[i]);
}
