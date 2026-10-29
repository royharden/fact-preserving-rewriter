// GENERATED from src/lib/checks/flags.ts; edit the source and run npm run sync:functions.
// Deterministic flag ids (PLAN section 3): id = class prefix + 1-based index in emission order, numbered per class.
// Each check stage emits only its own classes (checkAttempt: hard + soft; claims: claim; judge/coverage: claim +
// coverage appended), so numbering each stage's drafts independently yields the same ids everywhere.

import type { Flag, FlagClass, FlagDraft } from '../../contracts/run.ts';
import { FLAG_PREFIX } from '../../contracts/run.ts';

function maxIndex(flags: readonly Flag[], cls: FlagClass): number {
  let max = 0;
  for (const f of flags) {
    if (f.class !== cls) continue;
    const n = Number(f.id.slice(FLAG_PREFIX[cls].length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

/** Ids for drafts, continuing after the highest existing id of each class (existing ids never change). */
export function numberFlags(drafts: readonly FlagDraft[], existing: readonly Flag[] = []): Flag[] {
  const next: Record<FlagClass, number> = {
    hard: maxIndex(existing, 'hard'),
    soft: maxIndex(existing, 'soft'),
    claim: maxIndex(existing, 'claim'),
    coverage: maxIndex(existing, 'coverage'),
  };
  return drafts.map((d) => {
    next[d.class] += 1;
    return { id: `${FLAG_PREFIX[d.class]}${next[d.class]}`, ...d };
  });
}

/** existing flags followed by the new drafts numbered after them. */
export function appendFlags(existing: readonly Flag[], drafts: readonly FlagDraft[]): Flag[] {
  return [...existing, ...numberFlags(drafts, existing)];
}

export function countByClass(flags: readonly Flag[], cls: FlagClass): number {
  return flags.filter((f) => f.class === cls).length;
}
