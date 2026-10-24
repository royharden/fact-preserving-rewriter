// Soft checks (PLAN section 3), reported but never blocking, emitted in list order:
//   negation_drift (not, no, never, cannot, n't) -> modal_must_to_may | modal_drift (must, should, may) ->
//   quantifier_drift (all, only, most, some) -> phrase_dropped | phrase_added (fail to, no longer, only if) ->
//   half_dropped -> length_ratio (outside 0.6-1.4) -> paragraph_alignment_uncertain.
// Drift checks compare paragraph by paragraph when source and rewrite have the same number of paragraphs (blank-line
// separated), otherwise the whole texts; within each check paragraphs are visited in order. A paragraph-count mismatch
// always adds an advisory: global count balance cannot establish that operators stayed with their original claims.

import type { FlagDraft } from '../../contracts/run.ts';
import type { Span } from '../factledger/types.ts';
import { bareHalfSpans } from '../factledger/numbers.ts';
import { wordTokens } from '../text/tokens.ts';

export const LENGTH_RATIO_MIN = 0.6;
export const LENGTH_RATIO_MAX = 1.4;

const NEGATION_RE = /\b(?:not|no|never|cannot)\b|n['’]t\b/gi;
const MODALS = ['must', 'should', 'may'] as const;
const QUANTIFIERS = ['all', 'only', 'most', 'some'] as const;
const PHRASES: readonly { label: string; re: RegExp }[] = [
  { label: 'fail to', re: /\bfail(?:s|ed|ing)? to\b/gi },
  { label: 'no longer', re: /\bno longer\b/gi },
  { label: 'only if', re: /\bonly if\b/gi },
];

function count(text: string, re: RegExp): number {
  return [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))].length;
}

const wordCount = (text: string, word: string): number => count(text, new RegExp(`\\b${word}\\b`, 'gi'));

/** Paragraph spans (blank-line separated, trimmed); a text with no non-blank content has no paragraphs. */
export function paragraphs(text: string): Span[] {
  const out: Span[] = [];
  const re = /\S[\s\S]*?(?=\r?\n[ \t]*\r?\n|$)/g;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].trimEnd().length;
    out.push({ start, end });
  }
  return out;
}

interface ParaPair {
  source: Span;
  rewrite: Span;
}

function pairParagraphs(sourceText: string, rewriteText: string): { pairs: ParaPair[]; sourceCount: number; rewriteCount: number } {
  const sp = paragraphs(sourceText);
  const rp = paragraphs(rewriteText);
  const pairs = sp.length > 0 && sp.length === rp.length
    ? sp.map((source, i) => ({ source, rewrite: rp[i] }))
    : [{ source: { start: 0, end: sourceText.length }, rewrite: { start: 0, end: rewriteText.length } }];
  return { pairs, sourceCount: sp.length, rewriteCount: rp.length };
}

function draft(code: string, pair: ParaPair, found: string, evidence: string): FlagDraft {
  return { class: 'soft', code, sourceSpan: pair.source, rewriteSpan: pair.rewrite, found, evidence };
}

export function softFlags(sourceText: string, rewriteText: string): FlagDraft[] {
  const { pairs, sourceCount, rewriteCount } = pairParagraphs(sourceText, rewriteText);
  const scope = sourceCount > 0 && sourceCount === rewriteCount ? 'this paragraph' : 'the whole text';
  const src = (p: ParaPair): string => sourceText.slice(p.source.start, p.source.end);
  const rw = (p: ParaPair): string => rewriteText.slice(p.rewrite.start, p.rewrite.end);
  const flags: FlagDraft[] = [];

  for (const p of pairs) {
    const a = count(src(p), NEGATION_RE);
    const b = count(rw(p), NEGATION_RE);
    if (a !== b) flags.push(draft('negation_drift', p, `negations: source ${a}, rewrite ${b}`, `negation count changed in ${scope}`));
  }

  for (const p of pairs) {
    const a = MODALS.map((m) => wordCount(src(p), m));
    const b = MODALS.map((m) => wordCount(rw(p), m));
    if (a.every((n, i) => n === b[i])) continue;
    const detail = MODALS.map((m, i) => `${m} ${a[i]}→${b[i]}`).join(', ');
    const mustToMay = b[0] < a[0] && b[2] > a[2];
    flags.push(draft(mustToMay ? 'modal_must_to_may' : 'modal_drift', p, detail, mustToMay ? '"must" weakened to "may"' : `modal verbs changed in ${scope}`));
  }

  for (const p of pairs) {
    const a = QUANTIFIERS.map((q) => wordCount(src(p), q));
    const b = QUANTIFIERS.map((q) => wordCount(rw(p), q));
    if (a.every((n, i) => n === b[i])) continue;
    const detail = QUANTIFIERS.map((q, i) => (a[i] === b[i] ? '' : `${q} ${a[i]}→${b[i]}`)).filter(Boolean).join(', ');
    flags.push(draft('quantifier_drift', p, detail, `quantifiers changed in ${scope}`));
  }

  for (const p of pairs) {
    for (const { label, re } of PHRASES) {
      const a = count(src(p), re);
      const b = count(rw(p), re);
      if (a === b) continue;
      flags.push(draft(b < a ? 'phrase_dropped' : 'phrase_added', p, `"${label}": source ${a}, rewrite ${b}`, `meaning-bearing phrase "${label}" ${b < a ? 'lost' : 'added'}`));
    }
  }

  const srcHalves = bareHalfSpans(sourceText);
  const rwHalves = bareHalfSpans(rewriteText);
  if (rwHalves.length < srcHalves.length) {
    flags.push({
      class: 'soft',
      code: 'half_dropped',
      sourceSpan: srcHalves[0],
      found: `"half": source ${srcHalves.length}, rewrite ${rwHalves.length}`,
      evidence: 'a "half" with no resolvable quantity disappeared; check the rewrite still says it',
    });
  }

  const srcWords = wordTokens(sourceText).length;
  const rwWords = wordTokens(rewriteText).length;
  if (srcWords > 0) {
    const ratio = rwWords / srcWords;
    if (ratio < LENGTH_RATIO_MIN || ratio > LENGTH_RATIO_MAX) {
      flags.push({
        class: 'soft',
        code: 'length_ratio',
        found: `ratio ${ratio.toFixed(2)} (${rwWords} / ${srcWords} words)`,
        evidence: `length ratio outside ${LENGTH_RATIO_MIN}-${LENGTH_RATIO_MAX}`,
      });
    }
  }
  if (sourceCount !== rewriteCount) {
    flags.push(draft(
      'paragraph_alignment_uncertain',
      { source: { start: 0, end: sourceText.length }, rewrite: { start: 0, end: rewriteText.length } },
      `paragraphs: source ${sourceCount}, rewrite ${rewriteCount}`,
      'paragraph correspondence is uncertain after a merge or split; whole-text counts can hide movement of negation, modality, quantifiers or conditional phrases between claims',
    ));
  }
  return flags;
}
