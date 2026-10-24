// Deterministic placeholder namespace: first 6 base-36 chars of sha256(seedId | MASK_VERSION | counter). The counter
// starts at 0 and increments while the namespace occurs in the source or any style sample. Seed id = the run id for
// live runs, fixtureSeedId(...) for fixtures and mock runs. The namespace is stored on the run and reused for retries.

import { sha256Hex } from '../text/hash.ts';

export const MASK_VERSION = 'mask-v1';
export const NAMESPACE_LENGTH = 6;
export const NAMESPACE_RE = /^[0-9a-z]{6}$/;
const MAX_COUNTER = 10_000;

export interface Namespace {
  namespace: string;
  counter: number;
}

export function fixtureSeedId(sourceId: string, voiceId: string, system: string): string {
  return `fixture:${sourceId}:${voiceId}:${system}`;
}

/** Namespace for one counter value (no collision scan). */
export async function namespaceFor(seedId: string, counter: number): Promise<string> {
  const hex = await sha256Hex(`${seedId}|${MASK_VERSION}|${counter}`);
  return BigInt(`0x${hex}`).toString(36).padStart(NAMESPACE_LENGTH, '0').slice(0, NAMESPACE_LENGTH);
}

/** First collision-free namespace for seedId against every text (source and samples). */
export async function deriveNamespace(seedId: string, texts: readonly string[]): Promise<Namespace> {
  for (let counter = 0; counter < MAX_COUNTER; counter++) {
    const namespace = await namespaceFor(seedId, counter);
    if (!texts.some((t) => t.includes(namespace))) return { namespace, counter };
  }
  throw new Error(`no collision-free mask namespace for seed ${seedId} within ${MAX_COUNTER} attempts`);
}
