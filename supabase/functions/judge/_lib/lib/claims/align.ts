// GENERATED from src/lib/claims/align.ts; edit the source and run npm run sync:functions.
// Sentence alignment for the claim check (SummaC-style pairs, own code). Sentences come from Intl.Segmenter
// (text/segment.ts). Each rewrite sentence is aligned to its top-3 source sentences by content-word overlap (forward,
// "added claim?") and each source sentence to its top-3 rewrite sentences (reverse, "dropped claim?"). Numbers and
// dates are blanked in claim and context using each text's own fact ledger.

import type { Fact } from '../factledger/types.ts';
import type { TextSpan } from '../text/segment.ts';
import { sentences } from '../text/segment.ts';
import { wordTokens } from '../text/tokens.ts';
import { blankSpan, MARK_RE } from './blank.ts';
import type { ClaimDirection, ClaimPair } from './judge.ts';
import { ALIGN_TOP_K } from './thresholds.ts';

const STOPWORDS: ReadonlySet<string> = new Set(
  (
    'a an the and or but nor of to in on at for per with by from into onto over under about as than then so if ' +
    'is are was were be been being am has have had do does did will would can could shall must should may might ' +
    'it its this that these those there here which who whom whose what when where why how ' +
    'i me my we us our you your he him his she her they them their ' +
    'not no never all any some most only every each both few more less very just also now still yet again ' +
    'up down out off after before during while until since because through within without'
  ).split(' '),
);

/** Lower-cased content words of a (possibly blanked) sentence: markers, stopwords and pure digits removed. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of wordTokens(text.replace(MARK_RE, ' '))) {
    const w = t.text.toLowerCase().replace(/’/g, "'");
    if (STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    out.add(w);
  }
  return out;
}

/** Non-blank sentences of a text. */
export function claimSentences(text: string): TextSpan[] {
  return sentences(text).filter((s) => /[\p{L}\p{N}]/u.test(s.text));
}

/** Fraction of `claim` words present in `context` (0 for an empty claim). */
export function coverage(claim: ReadonlySet<string>, context: ReadonlySet<string>): number {
  if (claim.size === 0) return 0;
  let hit = 0;
  for (const w of claim) if (context.has(w)) hit++;
  return hit / claim.size;
}

/** Indexes of the top-k `to` sentences by overlap with `from` (score > 0), best first, ties by earlier index. */
export function topK(from: ReadonlySet<string>, to: readonly ReadonlySet<string>[], k = ALIGN_TOP_K): number[] {
  return to
    .map((words, i) => ({ i, score: coverage(from, words) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, k)
    .map((x) => x.i);
}

interface Side {
  text: string;
  ledger: readonly Fact[];
}

function pairsFor(direction: ClaimDirection, claimSide: Side, contextSide: Side): ClaimPair[] {
  const claimSents = claimSentences(claimSide.text);
  const ctxSents = claimSentences(contextSide.text);
  const ctxBlank = ctxSents.map((s) => blankSpan(contextSide.text, s, contextSide.ledger));
  const ctxWords = ctxBlank.map(contentWords);
  return claimSents.map((s, index) => {
    const claim = blankSpan(claimSide.text, s, claimSide.ledger).trim();
    const chosen = topK(contentWords(claim), ctxWords).sort((a, b) => a - b);
    return {
      pairId: `${direction === 'forward' ? 'F' : 'R'}${index + 1}`,
      direction,
      index,
      claim,
      claimText: s.text.trim(),
      claimSpan: { start: s.start, end: s.start + s.text.trimEnd().length },
      context: chosen.map((i) => ctxBlank[i].trim()),
      contextSpans: chosen.map((i) => ({ start: ctxSents[i].start, end: ctxSents[i].start + ctxSents[i].text.trimEnd().length })),
    };
  });
}

/** Forward pairs (rewrite sentences vs source) followed by reverse pairs (source sentences vs rewrite). */
export function buildClaimPairs(sourceText: string, sourceLedger: readonly Fact[], rewriteText: string, rewriteLedger: readonly Fact[]): ClaimPair[] {
  const source = { text: sourceText, ledger: sourceLedger };
  const rewrite = { text: rewriteText, ledger: rewriteLedger };
  return [...pairsFor('forward', rewrite, source), ...pairsFor('reverse', source, rewrite)];
}
