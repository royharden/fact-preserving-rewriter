import { describe, it, expect } from 'vitest';
import { canonicalDecimal, factKey, halveDecimal, normaliseEntityText, shiftDecimal } from '../../../src/lib/factledger/normalise.ts';

describe('exact decimal strings', () => {
  it('canonicalDecimal strips separators and redundant zeros', () => {
    expect(canonicalDecimal('1,200,000.50')).toBe('1200000.5');
    expect(canonicalDecimal('007')).toBe('7');
    expect(canonicalDecimal('-0.0')).toBe('0');
    expect(canonicalDecimal('.5')).toBe('0.5');
    expect(() => canonicalDecimal('abc')).toThrow();
  });

  it('shiftDecimal multiplies by powers of ten exactly', () => {
    expect(shiftDecimal('1.2', 6)).toBe('1200000');
    expect(shiftDecimal('50', -2)).toBe('0.5');
    expect(shiftDecimal('0.1', 1)).toBe('1');
    expect(shiftDecimal('3', -4)).toBe('0.0003');
  });

  it('halveDecimal halves exactly', () => {
    expect(halveDecimal('1000000')).toBe('500000');
    expect(halveDecimal('3')).toBe('1.5');
    expect(halveDecimal('0.1')).toBe('0.05');
  });
});

describe('keys', () => {
  it('factKey combines kind and normalised value', () => {
    expect(factKey({ kind: 'number', normalised: 'percent 50' })).toBe('number:percent 50');
  });

  it('normaliseEntityText collapses whitespace and straightens apostrophes', () => {
    expect(normaliseEntityText('Ada  Lin')).toBe('Ada Lin');
    expect(normaliseEntityText('O’Neil')).toBe("O'Neil");
  });
});
