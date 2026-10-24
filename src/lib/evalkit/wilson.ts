export interface Interval { successes: number; total: number; rate: number | null; lower: number | null; upper: number | null }
/** Two-sided 95% Wilson score interval; n=0 is unmeasured, never zero recall. */
export function wilson(successes: number, total: number, z = 1.959963984540054): Interval {
  if (!Number.isSafeInteger(successes) || !Number.isSafeInteger(total) || total < 0 || successes < 0 || successes > total || !Number.isFinite(z) || z <= 0) throw new Error('invalid binomial counts');
  if (total === 0) return { successes, total, rate: null, lower: null, upper: null };
  const rate = successes / total, zz = z * z, denominator = 1 + zz / total;
  const center = (rate + zz / (2 * total)) / denominator;
  const half = z * Math.sqrt(rate * (1 - rate) / total + zz / (4 * total * total)) / denominator;
  return { successes, total, rate, lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}
