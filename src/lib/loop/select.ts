// Attempt selection (PLAN section 5): among completed attempts, fewest hard flags, then fewest soft + claim flags,
// then the earliest ordinal. null when no attempt completed (the run has no exportable content).

import type { AttemptState, Flag } from '../../contracts/run.ts';

export interface Selectable {
  ordinal: number;
  state: AttemptState;
  flags: readonly Flag[];
}

const hard = (a: Selectable): number => a.flags.filter((f) => f.class === 'hard').length;
const review = (a: Selectable): number => a.flags.filter((f) => f.class === 'soft' || f.class === 'claim').length;

export function selectAttempt<T extends Selectable>(attempts: readonly T[]): T | null {
  const done = attempts.filter((a) => a.state === 'complete');
  if (done.length === 0) return null;
  return [...done].sort((a, b) => hard(a) - hard(b) || review(a) - review(b) || a.ordinal - b.ordinal)[0];
}
