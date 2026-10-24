// Sentence and word segmentation on Intl.Segmenter, with a merge step so that title abbreviations such as "Dr." do not
// end a sentence (ICU's default rules break "Dr. Ada" into two sentences).

export interface TextSpan {
  start: number;
  end: number;
  text: string;
}

/** Abbreviations that never end a sentence when followed by more text. Deliberately excludes "etc." and "Inc.". */
export const NON_TERMINAL_ABBREVIATIONS: ReadonlySet<string> = new Set([
  'Dr.', 'Mr.', 'Mrs.', 'Ms.', 'Mx.', 'Prof.', 'Sr.', 'Jr.', 'St.', 'Rev.', 'Gen.', 'Col.', 'Capt.', 'Lt.', 'Sgt.',
  'vs.', 'e.g.', 'i.e.', 'approx.', 'No.', 'Fig.', 'cf.',
]);

let sentenceSegmenter: Intl.Segmenter | null = null;
let wordSegmenter: Intl.Segmenter | null = null;

function getSentenceSegmenter(): Intl.Segmenter {
  sentenceSegmenter ??= new Intl.Segmenter('en', { granularity: 'sentence' });
  return sentenceSegmenter;
}

function getWordSegmenter(): Intl.Segmenter {
  wordSegmenter ??= new Intl.Segmenter('en', { granularity: 'word' });
  return wordSegmenter;
}

function endsWithNonTerminalAbbreviation(segment: string): boolean {
  const m = /(\S+)$/.exec(segment.trimEnd());
  if (!m) return false;
  const last = m[1].replace(/^[("“‘'[]+/, '');
  // A single capital initial is not a sentence end only when it follows another capitalised word ("John F. Kennedy"),
  // so "We chose Plan A. Then we shipped." still splits; bare leading initials ("J. Smith") are rare in our genres.
  if (NON_TERMINAL_ABBREVIATIONS.has(last)) return true;
  if (!/^\p{Lu}\.$/u.test(last)) return false;
  const words = segment.trimEnd().split(/\s+/);
  const before = words.length >= 2 ? words[words.length - 2] : '';
  return /^\p{Lu}\p{Ll}+$/u.test(before) && !/^(?:Plan|Zone|Phase|Option|Tier|Level|Stage|Team|Building|Room|Step|Version|Group|Section|Part|Appendix|Grade|Type)$/u.test(before);
}

/** Sentences with half-open UTF-16 offsets; each span includes its trailing whitespace (as Intl.Segmenter does). */
export function sentences(text: string): TextSpan[] {
  const raw: { start: number; end: number }[] = [];
  for (const s of getSentenceSegmenter().segment(text)) {
    raw.push({ start: s.index, end: s.index + s.segment.length });
  }
  const merged: { start: number; end: number }[] = [];
  for (const span of raw) {
    const prev = merged[merged.length - 1];
    if (prev && endsWithNonTerminalAbbreviation(text.slice(prev.start, prev.end)) && !/\n\s*$/.test(text.slice(prev.start, prev.end))) {
      prev.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }
  return merged.map((s) => ({ ...s, text: text.slice(s.start, s.end) }));
}

/** Word-like segments (Intl.Segmenter isWordLike) with half-open UTF-16 offsets. */
export function words(text: string): TextSpan[] {
  const out: TextSpan[] = [];
  for (const s of getWordSegmenter().segment(text)) {
    if (s.isWordLike) out.push({ start: s.index, end: s.index + s.segment.length, text: s.segment });
  }
  return out;
}
