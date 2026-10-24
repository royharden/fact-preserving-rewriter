import { describe, expect, it } from 'vitest';
import { FEATURES, featureVector, profile } from '../../../src/lib/style/profile.ts';
import { styleDistance, STYLE_LABEL } from '../../../src/lib/style/distance.ts';
import { pickExcerpts } from '../../../src/lib/style/excerpts.ts';

describe('descriptive style', () => {
  it('computes sentence lengths, spread, punctuation, contractions, word length and vocabulary ratio', () => {
    const v = featureVector("We don't rush, ever; we wait—quietly! Why?");
    expect(v.sentence_length_mean).toBeGreaterThan(0);
    expect(v.sentence_length_sd).toBeGreaterThan(0);
    for (const name of ['comma_rate', 'semicolon_rate', 'em_dash_rate', 'exclamation_rate', 'question_rate', 'contraction_rate'] as const) {
      expect(v[name]).toBeGreaterThan(0);
      expect(v[name]).toBe(v.comma_rate); // exactly one occurrence of each, with the same denominator
    }
    expect(featureVector('aa bb.').mean_word_length).toBe(2);
    expect(featureVector('aa aa.').type_token_ratio).toBe(0.5);
    expect(featureVector('aa bb.').sentence_length_mean).toBe(2);
    expect(featureVector('aa bb.').sentence_length_sd).toBe(0);
  });

  it('disables the score below 600 sample words without disabling profile or excerpts', () => {
    const sample = 'Keep the release notes short and explain the next action clearly.';
    const p = profile([sample]);
    expect(p.wordCount).toBe(11);
    expect(p.scoreEnabled).toBe(false);
    expect(p.excerpts).toEqual([sample]);
    const d = styleDistance('Short release notes.', p);
    expect(d.value).toBeNull();
    expect(d.reason).toContain('600');
    expect(d.label).toBe(STYLE_LABEL);
    expect(profile([Array.from({ length: 600 }, () => 'word').join(' ')]).scoreEnabled).toBe(true);
  });

  it('skips and lists zero variance instead of dividing by zero', () => {
    const p = profile([Array.from({ length: 120 }, () => 'We keep the work clear.').join(' ')]);
    expect(p.wordCount).toBe(600);
    const d = styleDistance('We keep the work clear.', p);
    expect(d.value).toBeNull();
    expect(d.reason).toContain('zero variance');
    expect(d.skipped).toEqual([...FEATURES]);
    expect(d.used).toEqual([]);
  });

  it('takes mean absolute z across only the features with nonzero spread', () => {
    const p = profile(['one two three four five '.repeat(120)]);
    for (const key of FEATURES) p.features[key] = { mean: 0, sd: 0 };
    p.features.mean_word_length = { mean: 1, sd: 2 };
    p.features.type_token_ratio = { mean: 0, sd: 0.5 };
    const d = styleDistance('aa bb.', p);
    expect(d.used).toEqual(['mean_word_length', 'type_token_ratio']);
    expect(d.perFeature).toEqual({ mean_word_length: 0.5, type_token_ratio: 2 });
    expect(d.value).toBe(1.25);
    expect(d.skipped).toContain('sentence_length_mean');
    expect(styleDistance('', p).reason).toContain('No text');
  });

  it('picks deterministic first, middle and last short excerpts, excluding numeric passages', () => {
    const a = 'We check the tiny details before we announce a release.';
    const b = 'The team keeps an eye on everything that could break.';
    const c = 'Our notes make the next step clear for the reader.';
    const numeric = 'There are 12 things to fix before we can ship.';
    expect(pickExcerpts([`${a} ${numeric} ${b} ${c}`])).toEqual([a, b, c]);
    expect(pickExcerpts([`${a} ${numeric} ${b} ${c}`])).toEqual(pickExcerpts([`${a} ${numeric} ${b} ${c}`]));
  });
});
