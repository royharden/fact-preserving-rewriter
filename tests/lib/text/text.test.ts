import { describe, it, expect } from 'vitest';
import { sentences, words } from '../../../src/lib/text/segment.ts';
import { isWholeTokenAt, normalisedWords, wholeTokenOccurrences, wordTokens } from '../../../src/lib/text/tokens.ts';
import { sha256Hex } from '../../../src/lib/text/hash.ts';

describe('sentences', () => {
  it('does not end a sentence at "Dr."', () => {
    const s = sentences('Dr. Ada Lin joined. She leads SRE.');
    expect(s).toHaveLength(2);
    expect(s[0].text.trim()).toBe('Dr. Ada Lin joined.');
    expect(s[1].text.trim()).toBe('She leads SRE.');
  });

  it('covers the whole input with contiguous half-open spans', () => {
    const text = 'One. Two? Three!\n\n# Heading\nFour e.g. five.';
    const s = sentences(text);
    expect(s.map((x) => x.text).join('')).toBe(text);
    for (let i = 1; i < s.length; i++) expect(s[i].start).toBe(s[i - 1].end);
    for (const x of s) expect(text.slice(x.start, x.end)).toBe(x.text);
  });

  it('keeps UTF-16 offsets with emoji', () => {
    const text = '🚀 Shipped. Done 🎉.';
    const s = sentences(text);
    for (const x of s) expect(text.slice(x.start, x.end)).toBe(x.text);
  });
});

describe('words', () => {
  it('returns word-like segments only', () => {
    expect(words('Hello, world 42!').map((w) => w.text)).toEqual(['Hello', 'world', '42']);
  });
});

describe('tokens', () => {
  it('wordTokens keeps internal apostrophes and offsets', () => {
    const t = wordTokens("Don't stop");
    expect(t.map((x) => x.text)).toEqual(["Don't", 'stop']);
    expect(t[1].start).toBe(6);
  });

  it('normalisedWords lower-cases and strips punctuation', () => {
    expect(normalisedWords("Don't STOP, now!")).toEqual(['dont', 'stop', 'now']);
  });

  it('whole-token occurrences never match substrings', () => {
    expect(wholeTokenOccurrences('Acmeville and Acme', 'Acme')).toEqual([14]);
    expect(wholeTokenOccurrences('cost 1.5 or 1,500', '5')).toEqual([]);
    expect(wholeTokenOccurrences('cost 5.', '5')).toEqual([5]);
  });

  it('isWholeTokenAt respects letter and digit boundaries', () => {
    expect(isWholeTokenAt('a Lin b', 2, 5)).toBe(true);
    expect(isWholeTokenAt('Linus', 0, 3)).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('matches known digests', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
