// GENERATED from src/lib/factledger/entities.ts; edit the source and run npm run sync:functions.
// Entities: user protected terms (with explicit aliases), then capitalised runs not explained by sentence position,
// acronyms (2+ capitals) and mixed-case brands (iPhone, GitHub). A name after a title ("Dr. Ada Lin") is the entity
// "Ada Lin". A sentence-initial (or Markdown heading) word counts only when it also appears capitalised mid-sentence in
// the text or in opts.contextText, or is an acronym / mixed-case / protected term.

import type { Candidate, ExtractOptions, Span } from './types.ts';
import { isFree, normaliseEntityText } from './normalise.ts';
import { sentences } from '../text/segment.ts';
import { wholeTokenOccurrences } from '../text/tokens.ts';

const TOKEN_RE = /\p{L}[\p{L}\p{M}]*(?:['’&.-]\p{L}[\p{L}\p{M}]*)*/gu;
const TITLES = new Set(['Dr', 'Mr', 'Mrs', 'Ms', 'Mx', 'Prof', 'Sir', 'Dame', 'Rev', 'Gen', 'Col', 'Capt', 'Lt', 'Sgt']);
const CONNECTORS = new Set(['of', '&', 'de', 'van', 'von', 'der', 'du', 'da', 'la']);
const NOT_ACRONYMS = new Set(['OK', 'AM', 'PM']);
/** Common capitalised sentence starters, dropped from the front of a sentence-initial run. */
const STARTERS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'our', 'we', 'it', 'its', 'in', 'on', 'at', 'for', 'but', 'and',
  'or', 'if', 'when', 'while', 'after', 'before', 'today', 'yesterday', 'tomorrow', 'next', 'last', 'please', 'there',
  'here', 'they', 'he', 'she', 'you', 'your', 'my', 'his', 'her', 'their', 'as', 'by', 'from', 'with', 'all', 'some',
  'most', 'no', 'not', 'every', 'each', 'also', 'however', 'then', 'so', 'to', 'of', 'what', 'why', 'how', 'who',
  'where', 'once', 'since', 'until', 'during', 'over', 'under', 'about', 'both', 'per', 'via', 'dear', 'hi', 'hello',
  'thanks', 'update', 'note', 'summary', 'status', 'impact',
]);

interface Tok {
  text: string;
  start: number;
  end: number;
  /** first word of a sentence, or any word of a Markdown heading line */
  initial: boolean;
  heading: boolean;
}

const isCapitalised = (t: string): boolean => /^\p{Lu}/u.test(t);
const isAcronym = (t: string): boolean => /^[\p{Lu}&]{2,}s?$/u.test(t) && /\p{Lu}.*\p{Lu}/u.test(t) && !NOT_ACRONYMS.has(t);
const isMixedCase = (t: string): boolean => /^\p{Ll}+\p{Lu}/u.test(t) || /^\p{Lu}\p{Ll}+\p{Lu}/u.test(t);
const isPronounI = (t: string): boolean => t === 'I' || /^I['’]/.test(t);
const isCapLike = (t: string): boolean => (isCapitalised(t) || isMixedCase(t)) && !isPronounI(t);

/** Tokens with a trailing possessive ('s / ’s) cut off, flagged when they are the first word of a sentence or heading. */
function tokenise(text: string): Tok[] {
  const initialStarts = new Set<number>();
  const first = new RegExp(TOKEN_RE.source, 'gu'); // own instance: exec() mutates lastIndex
  for (const s of sentences(text)) {
    first.lastIndex = s.start;
    const m = first.exec(text);
    if (m && m.index < s.end) initialStarts.add(m.index);
  }
  const headings: Span[] = [];
  for (const m of text.matchAll(/^#{1,6}[ \t].*$/gm)) headings.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  const out: Tok[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    const word = m[0].replace(/['’]s$/, '');
    const inHeading = headings.some((h) => h.start <= start && start < h.end);
    out.push({ text: word, start, end: start + word.length, initial: initialStarts.has(start) || inHeading, heading: inHeading });
  }
  return out;
}

/** Capitalised words that appear somewhere not at a sentence start (they license sentence-initial uses). */
function midSentenceCapitals(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokenise(text)) if (!t.initial && isCapLike(t.text)) out.add(t.text);
  return out;
}

function protectedHits(text: string, opts: ExtractOptions, claimed: readonly Span[]): Candidate[] {
  const canonicalOf = new Map<string, string>();
  for (const term of opts.protectedTerms ?? []) if (term.trim() !== '') canonicalOf.set(term, term);
  for (const [canonical, aliases] of Object.entries(opts.aliases ?? {})) {
    if (canonical.trim() === '') continue;
    canonicalOf.set(canonical, canonical);
    for (const alias of aliases) if (alias.trim() !== '') canonicalOf.set(alias, canonical);
  }
  const terms = [...canonicalOf.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const out: Candidate[] = [];
  for (const term of terms) {
    for (const start of wholeTokenOccurrences(text, term)) {
      const end = start + term.length;
      if (!isFree(claimed, start, end) || !isFree(out, start, end)) continue;
      out.push({ kind: 'entity', start, end, normalised: normaliseEntityText(canonicalOf.get(term) ?? term) });
    }
  }
  return out;
}

/** True when the gap between two tokens joins them into one run (a single space). */
const joins = (text: string, a: Tok, b: Tok): boolean => /^[  ]$/.test(text.slice(a.end, b.start));

export function findEntities(text: string, claimed: readonly Span[], opts: ExtractOptions): Candidate[] {
  const out = protectedHits(text, opts, claimed);
  const taken = [...claimed, ...out];
  const licensed = midSentenceCapitals(text);
  if (opts.contextText) for (const w of midSentenceCapitals(opts.contextText)) licensed.add(w);
  const strong = (t: string): boolean => isAcronym(t) || isMixedCase(t);
  const singleOk = (t: Tok): boolean => strong(t.text) || licensed.has(t.text);

  const toks = tokenise(text).filter((t) => isFree(taken, t.start, t.end));
  const emit = (run: Tok[]): void => {
    while (run.length > 0 && CONNECTORS.has(run[run.length - 1].text)) run.pop();
    if (run.length === 0) return;
    const start = run[0].start;
    const end = run[run.length - 1].end;
    out.push({ kind: 'entity', start, end, normalised: normaliseEntityText(text.slice(start, end)) });
  };

  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (!isCapLike(t.text) || TITLES.has(t.text)) {
      i++;
      continue;
    }
    // collect a run: cap-like tokens joined by single spaces, allowing a connector between two cap-like tokens
    const run: Tok[] = [t];
    let j = i + 1;
    while (j < toks.length) {
      const prev = run[run.length - 1];
      const next = toks[j];
      if (joins(text, prev, next) && isCapLike(next.text) && !TITLES.has(next.text)) {
        run.push(next);
        j++;
      } else if (CONNECTORS.has(next.text) && joins(text, prev, next) && j + 1 < toks.length && joins(text, next, toks[j + 1]) && isCapLike(toks[j + 1].text)) {
        run.push(next, toks[j + 1]);
        j += 2;
      } else {
        break;
      }
    }
    const prevTok = i > 0 ? toks[i - 1] : undefined;
    i = j;

    const afterTitle = prevTok !== undefined && TITLES.has(prevTok.text) && /^\.? $/.test(text.slice(prevTok.end, t.start));
    if (afterTitle) {
      emit(run);
      continue;
    }
    if (run[0].heading) {
      // heading words are all position-explained: keep only maximal sub-runs of individually licensed words
      let sub: Tok[] = [];
      for (const r of run) {
        if (singleOk(r)) sub.push(r);
        else {
          emit(sub);
          sub = [];
        }
      }
      emit(sub);
      continue;
    }
    if (!run[0].initial) {
      emit(run);
      continue;
    }
    // sentence-initial run
    if (STARTERS.has(run[0].text.toLowerCase()) && !strong(run[0].text) && !licensed.has(run[0].text)) {
      const rest = run.slice(1);
      while (rest.length > 0 && CONNECTORS.has(rest[0].text)) rest.shift();
      if (rest.length > 0) emit(rest);
      continue;
    }
    if (run.length >= 2 || singleOk(run[0])) emit(run);
  }
  return out;
}
