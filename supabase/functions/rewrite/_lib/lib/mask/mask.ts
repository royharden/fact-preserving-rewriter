// GENERATED from src/lib/mask/mask.ts; edit the source and run npm run sync:functions.
// mask(): replaces every quote and verbatim fact with a placeholder ⟦<ns>:<factId>⟧ (e.g. ⟦k3x9a1:Q1⟧) before the
// model sees the text. Slots record the original offsets so restore() can copy the exact source slice back.

import type { Fact } from '../factledger/types.ts';
import { NAMESPACE_RE } from './namespace.ts';

export { MASK_VERSION } from './namespace.ts';

export interface MaskSlot {
  token: string;
  factId: string;
  start: number;
  end: number;
}

export interface MaskResult {
  namespace: string;
  masked: string;
  slots: MaskSlot[];
}

/** Well-formed placeholder, any namespace: group 1 = namespace, group 2 = fact id. */
export const PLACEHOLDER_RE = /⟦([0-9a-z]{6}):([QV][1-9]\d*)⟧/g;

export function placeholder(namespace: string, factId: string): string {
  return `⟦${namespace}:${factId}⟧`;
}

export function isMaskedKind(fact: Pick<Fact, 'kind'>): boolean {
  return fact.kind === 'quote' || fact.kind === 'verbatim';
}

export function mask(text: string, facts: readonly Fact[], namespace: string): MaskResult {
  if (!NAMESPACE_RE.test(namespace)) throw new Error(`invalid mask namespace: ${namespace}`);
  const masked = facts.filter(isMaskedKind).sort((a, b) => a.start - b.start);
  const slots: MaskSlot[] = [];
  let out = '';
  let pos = 0;
  for (const f of masked) {
    if (f.start < pos || f.end > text.length || text.slice(f.start, f.end) !== f.raw) {
      throw new Error(`fact ${f.id} does not match the text at ${f.start}-${f.end}`);
    }
    const token = placeholder(namespace, f.id);
    out += text.slice(pos, f.start) + token;
    slots.push({ token, factId: f.id, start: f.start, end: f.end });
    pos = f.end;
  }
  out += text.slice(pos);
  return { namespace, masked: out, slots };
}
