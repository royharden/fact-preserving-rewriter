// Descriptive style profile (spec item 4, PLAN section 3). Features per text block: sentence length mean and sd; per
// 1,000 words commas, semicolons, em dashes, exclamations, questions and contractions; mean word length; type-token
// ratio. Samples are cut into blocks of BLOCK_SENTENCES consecutive sentences so a single sample still has a spread;
// the profile holds each feature's mean and sd across blocks. Not a validated metric.

import { sentences } from '../text/segment.ts';
import { wordTokens } from '../text/tokens.ts';
import { pickExcerpts } from './excerpts.ts';

export const STYLE_VERSION = 'style-v1';
export const MIN_STYLE_WORDS = 600;
export const BLOCK_SENTENCES = 5;

export const FEATURES = [
  'sentence_length_mean',
  'sentence_length_sd',
  'comma_rate',
  'semicolon_rate',
  'em_dash_rate',
  'exclamation_rate',
  'question_rate',
  'contraction_rate',
  'mean_word_length',
  'type_token_ratio',
] as const;
export type FeatureName = (typeof FEATURES)[number];
export type FeatureVector = Record<FeatureName, number>;

export interface FeatureStat {
  mean: number;
  sd: number;
}

export interface StyleProfile {
  version: string;
  wordCount: number;
  blockCount: number;
  features: Record<FeatureName, FeatureStat>;
  excerpts: string[];
  /** false under MIN_STYLE_WORDS sample words: the style score is disabled (rewriting is never blocked). */
  scoreEnabled: boolean;
  disabledReason: string | null;
}

const CONTRACTION_RE = /\p{L}['’](?:t|s|re|ve|ll|d|m)\b/giu;

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n - 1); 0 for fewer than two values. */
export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

const per1000 = (n: number, words: number): number => (words === 0 ? 0 : (n * 1000) / words);
const countOf = (text: string, re: RegExp): number => [...text.matchAll(re)].length;

export function featureVector(text: string): FeatureVector {
  const words = wordTokens(text);
  const n = words.length;
  const sentLens = sentences(text)
    .map((s) => wordTokens(s.text).length)
    .filter((len) => len > 0);
  const lower = words.map((w) => w.text.toLowerCase().replace(/’/g, "'"));
  return {
    sentence_length_mean: mean(sentLens),
    sentence_length_sd: sd(sentLens),
    comma_rate: per1000(countOf(text, /,/g), n),
    semicolon_rate: per1000(countOf(text, /;/g), n),
    em_dash_rate: per1000(countOf(text, /—|(?<!-)--(?!-)/g), n),
    exclamation_rate: per1000(countOf(text, /!/g), n),
    question_rate: per1000(countOf(text, /\?/g), n),
    contraction_rate: per1000(countOf(text, CONTRACTION_RE), n),
    mean_word_length: n === 0 ? 0 : mean(words.map((w) => [...w.text].length)),
    type_token_ratio: n === 0 ? 0 : new Set(lower).size / n,
  };
}

/** Consecutive blocks of `size` sentences; a short tail (< half a block) is merged into the previous block. */
export function blocks(text: string, size = BLOCK_SENTENCES): string[] {
  const sents = sentences(text).filter((s) => s.text.trim() !== '');
  const out: string[] = [];
  for (let i = 0; i < sents.length; i += size) {
    const group = sents.slice(i, i + size);
    const chunk = text.slice(group[0].start, group[group.length - 1].end);
    if (out.length > 0 && group.length < Math.ceil(size / 2)) out[out.length - 1] += chunk;
    else out.push(chunk);
  }
  return out;
}

export function profile(samples: readonly string[]): StyleProfile {
  const wordCount = samples.reduce((a, s) => a + wordTokens(s).length, 0);
  const vectors = samples.flatMap((s) => blocks(s)).map(featureVector);
  const features = {} as Record<FeatureName, FeatureStat>;
  for (const f of FEATURES) {
    const xs = vectors.map((v) => v[f]);
    features[f] = { mean: mean(xs), sd: sd(xs) };
  }
  const scoreEnabled = wordCount >= MIN_STYLE_WORDS;
  return {
    version: STYLE_VERSION,
    wordCount,
    blockCount: vectors.length,
    features,
    excerpts: pickExcerpts(samples),
    scoreEnabled,
    disabledReason: scoreEnabled ? null : `Style score disabled: the samples have ${wordCount} words (needs ${MIN_STYLE_WORDS}).`,
  };
}

const round1 = (x: number): string => (Math.round(x * 10) / 10).toString();

/** Short code-written description of the profile for the rewrite prompt (no model involvement). */
export function describeProfile(p: StyleProfile): string {
  if (p.wordCount === 0) return 'No style statistics (no sample words).';
  const f = p.features;
  return [
    `Sentence length: about ${round1(f.sentence_length_mean.mean)} words (spread ${round1(f.sentence_length_sd.mean)}).`,
    `Per 1,000 words: ${round1(f.comma_rate.mean)} commas, ${round1(f.semicolon_rate.mean)} semicolons, ${round1(f.em_dash_rate.mean)} dashes, ${round1(f.exclamation_rate.mean)} exclamations, ${round1(f.question_rate.mean)} questions, ${round1(f.contraction_rate.mean)} contractions.`,
    `Mean word length ${round1(f.mean_word_length.mean)} letters.`,
  ].join(' ');
}
