// Placeholder integrity, checked on model output BEFORE restore. Each problem is its own failure:
//   missing   - an expected placeholder does not appear
//   duplicate - an expected placeholder appears more than once
//   unknown   - a well-formed placeholder that was never issued (unknown fact id or another namespace)
//   malformed - a broken placeholder: stray ⟦ / ⟧ beyond those already in the masked input, or "<ns>:" outside brackets

import type { MaskResult } from './mask.ts';
import { PLACEHOLDER_RE } from './mask.ts';

export type IntegrityCode = 'missing' | 'duplicate' | 'unknown' | 'malformed';

export interface IntegrityFailure {
  code: IntegrityCode;
  token?: string;
  factId?: string;
  /** UTF-16 offset in the model output, when there is one. */
  index?: number;
  found: string;
}

const blankTokens = (s: string): string => s.replace(PLACEHOLDER_RE, (m) => ' '.repeat(m.length));

function bracketPositions(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) if (s[i] === '⟦' || s[i] === '⟧') out.push(i);
  return out;
}

function snippet(s: string, index: number): string {
  return s.slice(Math.max(0, index - 12), index + 16);
}

export function checkIntegrity(output: string, maskResult: Pick<MaskResult, 'namespace' | 'slots' | 'masked'>): IntegrityFailure[] {
  const { namespace, slots, masked } = maskResult;
  const failures: IntegrityFailure[] = [];
  const counts = new Map<string, number>();
  const firstIndex = new Map<string, number>();
  const issued = new Set(slots.map((s) => s.token));

  for (const m of output.matchAll(PLACEHOLDER_RE)) {
    const token = m[0];
    const index = m.index ?? 0;
    if (m[1] !== namespace || !issued.has(token)) {
      failures.push({ code: 'unknown', token, factId: m[2], index, found: token });
      continue;
    }
    counts.set(token, (counts.get(token) ?? 0) + 1);
    if (!firstIndex.has(token)) firstIndex.set(token, index);
  }
  for (const slot of slots) {
    const n = counts.get(slot.token) ?? 0;
    if (n === 0) failures.push({ code: 'missing', token: slot.token, factId: slot.factId, found: 'absent' });
    else if (n > 1) failures.push({ code: 'duplicate', token: slot.token, factId: slot.factId, index: firstIndex.get(slot.token), found: `appears ${n} times` });
  }

  const residual = blankTokens(output);
  const inputBrackets = bracketPositions(blankTokens(masked)).length;
  const outputBrackets = bracketPositions(residual);
  if (outputBrackets.length > inputBrackets) {
    for (const index of outputBrackets) failures.push({ code: 'malformed', index, found: snippet(output, index) });
  }
  const bare = `${namespace}:`;
  for (let i = residual.indexOf(bare); i !== -1; i = residual.indexOf(bare, i + 1)) {
    if (!outputBrackets.some((b) => Math.abs(b - i) <= 1)) failures.push({ code: 'malformed', index: i, found: snippet(output, i) });
  }
  return failures;
}
