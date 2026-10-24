// GENERATED from src/lib/loop/verdict.ts; edit the source and run npm run sync:functions.
// verdictOf (PLAN section 5): failed if any hard flag; else needs_review if any soft, claim or coverage flag
// (llm_unavailable, truncated, operational_incomplete) or a claim status short of full coverage; else pass.

import type { ClaimStatus, Flag, Verdict } from '../../contracts/run.ts';

export function verdictOf(flags: readonly Flag[], claimStatus: ClaimStatus | null = null): Verdict {
  if (flags.some((f) => f.class === 'hard')) return 'failed';
  if (flags.length > 0) return 'needs_review';
  if (claimStatus === 'llm_unavailable' || claimStatus === 'truncated') return 'needs_review';
  return 'pass';
}
