// GENERATED from src/lib/claims/overlap.ts; edit the source and run npm run sync:functions.
// `overlap` claim judge (no model, the baseline; runs on every B4 attempt): a claim whose content words are covered by
// its aligned context below OVERLAP_SUPPORT_MIN "says nothing" (forward: added claim; reverse: dropped claim). It never
// returns `contradicts` (lexical overlap cannot see contradiction). Thresholds are uncalibrated (thresholds.ts).

import { contentWords, coverage } from './align.ts';
import type { ClaimFlag, ClaimJudge, ClaimPair } from './judge.ts';
import { OVERLAP_MIN_CONTENT_WORDS, OVERLAP_SUPPORT_MIN } from './thresholds.ts';

export interface OverlapOptions {
  supportMin?: number;
  minContentWords?: number;
}

export function judgeOverlap(pairs: readonly ClaimPair[], opts: OverlapOptions = {}): ClaimFlag[] {
  const supportMin = opts.supportMin ?? OVERLAP_SUPPORT_MIN;
  const minWords = opts.minContentWords ?? OVERLAP_MIN_CONTENT_WORDS;
  const flags: ClaimFlag[] = [];
  for (const p of pairs) {
    const claim = contentWords(p.claim);
    if (claim.size < minWords) continue;
    const ctx = new Set<string>();
    for (const c of p.context) for (const w of contentWords(c)) ctx.add(w);
    const score = coverage(claim, ctx);
    if (score >= supportMin) continue;
    const missing = [...claim].filter((w) => !ctx.has(w));
    flags.push({
      pairId: p.pairId,
      label: 'says_nothing',
      score,
      evidence: p.context.length === 0
        ? `no ${p.direction === 'forward' ? 'source' : 'rewrite'} sentence shares its content words`
        : `covers ${Math.round(score * claim.size)}/${claim.size} content words; unmatched: ${missing.slice(0, 8).join(', ')}`,
    });
  }
  return flags;
}

export function createOverlapJudge(opts: OverlapOptions = {}): ClaimJudge {
  return {
    name: 'overlap',
    judge: async (pairs) => judgeOverlap(pairs, opts),
  };
}

export const overlapJudge: ClaimJudge = createOverlapJudge();
