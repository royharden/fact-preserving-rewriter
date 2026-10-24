// Run contracts shared by browser, Node scripts and edge functions. M1 defines only the Flag shape (PLAN section 3);
// Run / Attempt / Ruling / Verdict types are added in M2.

import type { FactKind, Span } from '../lib/factledger/types.ts';

export type FlagClass = 'hard' | 'soft' | 'claim' | 'coverage';

/** Id prefix per class; id = prefix + 1-based index in deterministic emission order on one attempt (H1, S1, C1, G1). */
export const FLAG_PREFIX: Readonly<Record<FlagClass, string>> = {
  hard: 'H',
  soft: 'S',
  claim: 'C',
  coverage: 'G',
};

export interface Flag {
  id: string;
  class: FlagClass;
  /** Machine code, e.g. 'missing_fact', 'added_fact', 'placeholder_missing', 'half_dropped', 'llm_unavailable'. */
  code: string;
  factId?: string;
  kind?: FactKind;
  sourceSpan?: Span;
  rewriteSpan?: Span;
  /** What was found instead (human-readable). */
  found: string;
  evidence?: string;
}
