// match(): compares a source ledger with a rewrite ledger.
// - missing: a required source fact with no unconsumed rewrite fact of the same key (multiplicity counts). Ignored
//   facts are exempt from this check only.
// - added (number/date/entity only): a rewrite fact whose key is absent from the whole source ledger (toggles play no
//   part) AND whose raw text has no whole-token occurrence in the source outside facts of a different kind. Substring
//   occurrences never exempt.

import type { Fact, FactKind } from './types.ts';
import { factKey } from './normalise.ts';
import { wholeTokenOccurrences } from '../text/tokens.ts';

export interface MissingFact {
  fact: Fact;
  /** Best guess at what the rewrite has instead: an unmatched rewrite fact of the same kind nearest in relative position. */
  found: Fact | null;
}

export interface AddedFact {
  fact: Fact;
}

export interface KeptFact {
  source: Fact;
  rewrite: Fact;
}

export interface MatchResult {
  kept: KeptFact[];
  missing: MissingFact[];
  added: AddedFact[];
}

const ADDED_KINDS: ReadonlySet<FactKind> = new Set<FactKind>(['number', 'date', 'entity']);

function hasSameKindTokenOccurrence(fact: Fact, sourceLedger: readonly Fact[], sourceText: string): boolean {
  for (const start of wholeTokenOccurrences(sourceText, fact.raw)) {
    const end = start + fact.raw.length;
    const foreign = sourceLedger.some((s) => s.kind !== fact.kind && start < s.end && s.start < end);
    if (!foreign) return true;
  }
  return false;
}

export function match(sourceLedger: readonly Fact[], rewriteLedger: readonly Fact[], rewriteText: string, sourceText: string): MatchResult {
  const queues = new Map<string, Fact[]>();
  for (const r of rewriteLedger) {
    const k = factKey(r);
    const q = queues.get(k);
    if (q) q.push(r);
    else queues.set(k, [r]);
  }
  const used = new Set<Fact>();
  const kept: KeptFact[] = [];
  const missingFacts: Fact[] = [];
  // required facts consume first, so an ignored duplicate never steals a required fact's partner
  const ordered = [...sourceLedger.filter((f) => f.required), ...sourceLedger.filter((f) => !f.required)];
  for (const s of ordered) {
    const partner = queues.get(factKey(s))?.find((r) => !used.has(r));
    if (partner) {
      used.add(partner);
      kept.push({ source: s, rewrite: partner });
    } else if (s.required) {
      missingFacts.push(s);
    }
  }
  kept.sort((a, b) => a.source.start - b.source.start);
  missingFacts.sort((a, b) => a.start - b.start);

  // "found instead": nearest unconsumed rewrite fact of the same kind by relative position, each used at most once
  const srcLen = Math.max(sourceText.length, 1);
  const rwLen = Math.max(rewriteText.length, 1);
  const spare = rewriteLedger.filter((r) => !used.has(r));
  const missing: MissingFact[] = missingFacts.map((fact) => {
    let best: Fact | null = null;
    let bestDist = Infinity;
    for (const r of spare) {
      if (r.kind !== fact.kind) continue;
      const dist = Math.abs(r.start / rwLen - fact.start / srcLen);
      if (dist < bestDist) {
        best = r;
        bestDist = dist;
      }
    }
    if (best) spare.splice(spare.indexOf(best), 1);
    return { fact, found: best };
  });

  const sourceKeys = new Set(sourceLedger.map(factKey));
  const added: AddedFact[] = rewriteLedger
    .filter((r) => ADDED_KINDS.has(r.kind))
    .filter((r) => !sourceKeys.has(factKey(r)) && !hasSameKindTokenOccurrence(r, sourceLedger, sourceText))
    .map((fact) => ({ fact }));

  return { kept, missing, added };
}
