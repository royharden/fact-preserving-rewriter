// GENERATED from src/lib/claims/judge.ts; edit the source and run npm run sync:functions.
// ClaimJudge interface (spec item 8, PLAN section 4): one interface for the `overlap` judge (no model), the optional
// `llm` judge and a third slot (Jev, phase 2; a test double in tests). Judges only flag; they can never change the
// ledger, the verdict floor or approval.

import type { FlagDraft } from '../../contracts/run.ts';
import type { Span } from '../factledger/types.ts';

export type ClaimLabel = 'supports' | 'contradicts' | 'says_nothing';
/** forward: rewrite sentence judged against source context (added claim); reverse: source against rewrite (dropped). */
export type ClaimDirection = 'forward' | 'reverse';

export interface ClaimPair {
  /** F<n> (forward) or R<n> (reverse), n = 1-based sentence index in the claim's text. */
  pairId: string;
  direction: ClaimDirection;
  /** 0-based sentence index in the claim's text. */
  index: number;
  /** Claim sentence with numbers and dates blanked. */
  claim: string;
  /** Original claim sentence (trimmed), for display. */
  claimText: string;
  claimSpan: Span;
  /** Top-k aligned context sentences (blanked), in document order. */
  context: string[];
  contextSpans: Span[];
}

export interface ClaimFlag {
  pairId: string;
  label: Exclude<ClaimLabel, 'supports'>;
  /** Judge-specific score (overlap: covered fraction), when it has one. */
  score?: number;
  evidence: string;
}

export interface ClaimJudge {
  readonly name: string;
  judge(pairs: readonly ClaimPair[]): Promise<ClaimFlag[]>;
}

function codeOf(pair: ClaimPair, flag: ClaimFlag): string {
  if (flag.label === 'contradicts') return 'contradicted_claim';
  return pair.direction === 'forward' ? 'added_claim' : 'dropped_claim';
}

/** Claim flag drafts in the fixed order: forward pairs then reverse pairs, each by sentence index. */
export function claimFlagDrafts(pairs: readonly ClaimPair[], flags: readonly ClaimFlag[], judgeName: string): FlagDraft[] {
  const byId = new Map(pairs.map((p) => [p.pairId, p] as const));
  const ordered = flags
    .filter((f) => byId.has(f.pairId))
    .map((f) => ({ f, p: byId.get(f.pairId) as ClaimPair }))
    .sort((a, b) => (a.p.direction === b.p.direction ? a.p.index - b.p.index : a.p.direction === 'forward' ? -1 : 1));
  return ordered.map(({ f, p }): FlagDraft => {
    const ctx = p.contextSpans[0];
    const spans = p.direction === 'forward'
      ? { rewriteSpan: p.claimSpan, ...(ctx ? { sourceSpan: ctx } : {}) }
      : { sourceSpan: p.claimSpan, ...(ctx ? { rewriteSpan: ctx } : {}) };
    return { class: 'claim', code: codeOf(p, f), ...spans, found: p.claimText, evidence: `${judgeName}: ${f.evidence}`, pairId: p.pairId };
  });
}
