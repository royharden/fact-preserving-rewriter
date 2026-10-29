// Hard checks (PLAN section 3), emitted in fixed order a -> d:
//   (a) missing_fact      every required source fact kept after normalisation (multiplicity counts)
//   (b) added_fact        no number/date/entity absent from the source ledger with no same-kind whole-token occurrence
//   (c) placeholder_*     placeholder integrity, detected on the raw model output before restore
//   (d) copied_sample_run no >= 8-word run (lower-cased, punctuation-stripped tokens) shared with a sample unless the
//                         same run also occurs in the source

import type { FlagDraft } from '../../contracts/run.ts';
import type { MatchResult } from '../factledger/match.ts';
import type { IntegrityFailure } from '../mask/integrity.ts';
import { normalisedWords, wordTokens } from '../text/tokens.ts';

export const COPY_RUN_WORDS = 8;
const MAX_FOUND_CHARS = 200;

export function missingFactFlags(result: MatchResult, skipFactIds: ReadonlySet<string> = new Set()): FlagDraft[] {
  return result.missing
    .filter((m) => !skipFactIds.has(m.fact.id))
    .map((m): FlagDraft => ({
      class: 'hard',
      code: 'missing_fact',
      factId: m.fact.id,
      kind: m.fact.kind,
      sourceSpan: { start: m.fact.start, end: m.fact.end },
      ...(m.found ? { rewriteSpan: { start: m.found.start, end: m.found.end } } : {}),
      found: m.found ? m.found.raw : 'absent',
      evidence: `required ${m.fact.kind} ${m.fact.id} "${m.fact.raw}" (${m.fact.normalised}) not found in the rewrite`,
    }));
}

export function addedFactFlags(result: MatchResult): FlagDraft[] {
  return result.added.map((a): FlagDraft => ({
    class: 'hard',
    code: 'added_fact',
    kind: a.fact.kind,
    rewriteSpan: { start: a.fact.start, end: a.fact.end },
    found: a.fact.raw,
    evidence: `${a.fact.kind} "${a.fact.raw}" (${a.fact.normalised}) is not in the source`,
  }));
}

export function placeholderFlags(failures: readonly IntegrityFailure[]): FlagDraft[] {
  return failures.map((f): FlagDraft => ({
    class: 'hard',
    code: `placeholder_${f.code}`,
    ...(f.factId ? { factId: f.factId } : {}),
    ...(f.index !== undefined ? { rewriteSpan: { start: f.index, end: f.index + (f.token?.length ?? 1) } } : {}),
    found: f.found,
    evidence: f.token ? `placeholder ${f.token}` : 'broken placeholder characters',
  }));
}

function ngramSet(words: readonly string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

const normToken = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** One flag per maximal run of >= n rewrite words whose every flagged n-gram occurs in a sample and not in the source. */
export function copiedSampleRunFlags(text: string, samples: readonly string[], sourceText: string, n = COPY_RUN_WORDS): FlagDraft[] {
  const tokens = wordTokens(text)
    .map((t) => ({ w: normToken(t.text), start: t.start, end: t.end }))
    .filter((t) => t.w !== '');
  if (tokens.length < n) return [];
  const sampleSets = samples.map((s) => ngramSet(normalisedWords(s), n));
  const sourceSet = ngramSet(normalisedWords(sourceText), n);

  // window i covers tokens i..i+n-1; sampleOf[i] = index of the first sample sharing it, or -1
  const sampleOf: number[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    const gram = tokens.slice(i, i + n).map((t) => t.w).join(' ');
    sampleOf.push(sourceSet.has(gram) ? -1 : sampleSets.findIndex((set) => set.has(gram)));
  }

  const flags: FlagDraft[] = [];
  let i = 0;
  while (i < sampleOf.length) {
    if (sampleOf[i] === -1) {
      i++;
      continue;
    }
    const first = i;
    while (i + 1 < sampleOf.length && sampleOf[i + 1] !== -1) i++;
    const start = tokens[first].start;
    const end = tokens[i + n - 1].end;
    const run = text.slice(start, end);
    flags.push({
      class: 'hard',
      code: 'copied_sample_run',
      rewriteSpan: { start, end },
      found: run.length > MAX_FOUND_CHARS ? `${run.slice(0, MAX_FOUND_CHARS)}…` : run,
      evidence: `${i - first + n} words copied from style sample ${sampleOf[first] + 1} and not in the source`,
    });
    i++;
  }
  return flags;
}
