import { describe, expect, it } from 'vitest';
import { checkAttempt } from '../../../src/lib/checks/index.ts';
import type { CheckContext } from '../../../src/lib/checks/index.ts';
import { appendFlags, numberFlags } from '../../../src/lib/checks/flags.ts';
import { copiedSampleRunFlags } from '../../../src/lib/checks/hard.ts';
import { softFlags } from '../../../src/lib/checks/soft.ts';
import { SOURCE_MAX_BYTES, SAMPLES_MAX_BYTES, validateInputs } from '../../../src/lib/checks/limits.ts';
import { mask } from '../../../src/lib/mask/mask.ts';
import { ex, REF } from '../factledger/helpers.ts';

function context(sourceText: string, samples: string[] = []): CheckContext {
  return { sourceText, samples, ledger: ex(sourceText), referenceTime: REF, maskNamespace: null };
}

describe('hard checks and deterministic flags', () => {
  it('names missing facts, their original spans, and the changed value before added facts', () => {
    const source = 'The cache served 12 requests.';
    const rewrite = 'The cache served 13 requests.';
    const result = checkAttempt(context(source), rewrite);
    const hard = result.flags.filter((f) => f.class === 'hard');
    expect(hard.map((f) => [f.id, f.code])).toEqual([['H1', 'missing_fact'], ['H2', 'added_fact']]);
    expect(hard[0]).toMatchObject({ factId: 'N1', kind: 'number', found: '13' });
    expect(source.slice(hard[0].sourceSpan!.start, hard[0].sourceSpan!.end)).toBe('12');
    expect(rewrite.slice(hard[1].rewriteSpan!.start, hard[1].rewriteSpan!.end)).toBe('13');
    expect(checkAttempt(context(source), rewrite)).toEqual(result);
  });

  it('ignoring a number exempts its absence, but never authorizes a changed number', () => {
    const ctx = context('The cache served 12 requests.');
    ctx.ledger = ctx.ledger.map((f) => ({ ...f, required: false }));
    const codes = checkAttempt(ctx, 'The cache served 99 requests.').flags.map((f) => f.code);
    expect(codes).not.toContain('missing_fact');
    expect(codes).toContain('added_fact');
  });

  it('does not let one occurrence satisfy two required occurrences', () => {
    const result = checkAttempt(context('The cache served 12 requests and queued 12 requests.'), 'The cache served 12 requests.');
    expect(result.flags.filter((f) => f.code === 'missing_fact')).toHaveLength(1);
  });

  it.each(['missing', 'duplicate', 'unknown', 'malformed'] as const)('checks %s placeholders before restoring', (code) => {
    const source = 'The operator wrote “keep this unchanged” and used ABC-1234.';
    const ctx = { ...context(source), maskNamespace: 'abc123' };
    const masked = mask(source, ctx.ledger, 'abc123');
    const token = masked.slots[0].token;
    const output = {
      missing: masked.masked.replace(token, ''),
      duplicate: `${masked.masked} ${token}`,
      unknown: `${masked.masked} ⟦abc123:Q99⟧`,
      malformed: masked.masked.replace(token, token.replace('⟧', ']')),
    }[code];
    const result = checkAttempt(ctx, output);
    expect(result.flags.some((f) => f.class === 'hard' && f.code === `placeholder_${code}`)).toBe(true);
    expect(result.integrityFailures.some((f) => f.code === code)).toBe(true);
  });

  it('restores original protected slices and then compares facts', () => {
    const source = 'The operator wrote “keep this unchanged” and used ABC-1234.';
    const ctx = { ...context(source), maskNamespace: 'abc123' };
    const result = checkAttempt(ctx, mask(source, ctx.ledger, 'abc123').masked);
    expect(result.text).toBe(source);
    expect(result.flags).toEqual([]);
  });

  it('ignores a copied eight-word sample run that also occurs in the source', () => {
    const shared = 'The release keeps every existing setting unchanged for customers';
    expect(copiedSampleRunFlags(shared, [`${shared}. More sample words.`], `${shared}.`)).toEqual([]);
    const copied = copiedSampleRunFlags(shared.toUpperCase(), [`${shared}.`], 'We shipped a patch.');
    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatchObject({ class: 'hard', code: 'copied_sample_run', rewriteSpan: { start: 0, end: shared.length } });
    expect(copiedSampleRunFlags('one two three four five six seven', ['one two three four five six seven'], '')).toEqual([]);
  });

  it('keeps existing class ids unchanged when later judge and coverage flags are appended', () => {
    const existing = numberFlags([{ class: 'soft', code: 'modal_drift', found: 'may' }, { class: 'claim', code: 'added_claim', found: 'added' }]);
    const flags = appendFlags(existing, [{ class: 'claim', code: 'dropped_claim', found: 'lost' }, { class: 'coverage', code: 'truncated', found: '120/121' }]);
    expect(flags.map((f) => f.id)).toEqual(['S1', 'C1', 'C2', 'G1']);
    expect(flags.slice(0, 2)).toEqual(existing);
  });
});

describe('soft checks', () => {
  it('detects per-paragraph negation and modal swaps even when global counts stay the same', () => {
    const flags = softFlags('We must not ship.\n\nWe may ship.', 'We may ship.\n\nWe must not ship.');
    expect(flags.filter((f) => f.code === 'negation_drift')).toHaveLength(2);
    expect(flags.some((f) => f.code === 'modal_must_to_may')).toBe(true);
    expect(flags.some((f) => f.code === 'modal_drift')).toBe(true);
    expect(flags[0].sourceSpan).toEqual({ start: 0, end: 17 });
  });

  it.each([
    ['merge', 'We must not ship the patch.\n\nWe may publish the notes.', 'We must not ship the patch. We may publish the notes.'],
    ['split', 'We must not ship the patch. We may publish the notes.', 'We must not ship the patch.\n\nWe may publish the notes.'],
  ])('reports uncertain paragraph correspondence after a %s even with unchanged wording', (_operation, source, rewrite) => {
    expect(softFlags(source, rewrite)).toEqual([{
      class: 'soft',
      code: 'paragraph_alignment_uncertain',
      sourceSpan: { start: 0, end: source.length },
      rewriteSpan: { start: 0, end: rewrite.length },
      found: expect.stringContaining('paragraphs: source'),
      evidence: expect.stringContaining('whole-text counts can hide movement'),
    }]);
  });

  it('retains whole-text drift findings when paragraph correspondence is uncertain', () => {
    const flags = softFlags('We must not ship the patch.\n\nWe may publish the notes.', 'We may ship the patch. We may publish the notes.');
    expect(flags.map((f) => f.code)).toEqual(['negation_drift', 'modal_must_to_may', 'paragraph_alignment_uncertain']);
    expect(flags[0].evidence).toBe('negation count changed in the whole text');
  });

  it.each([['not', ''], ['no', 'several'], ['never', 'always'], ["can't", 'can'], ['should', 'may']])('reports drift for %s', (word, replacement) => {
    expect(softFlags(`We ${word} ship the patch today.`, `We ${replacement} ship the patch today.`).length).toBeGreaterThan(0);
  });

  it.each(['all', 'only', 'most', 'some'])('reports %s quantifier drift', (word) => {
    expect(softFlags(`We serve ${word} customers.`, 'We serve customers.').map((f) => f.code)).toContain('quantifier_drift');
  });

  it.each(['fail to', 'no longer', 'only if'])('reports the loss and addition of %s', (phrase) => {
    const a = `We ${phrase} deploy the patch.`;
    const b = 'We deploy the patch.';
    expect(softFlags(a, b).some((f) => f.code === 'phrase_dropped')).toBe(true);
    expect(softFlags(b, a).some((f) => f.code === 'phrase_added')).toBe(true);
  });

  it('treats lost unresolved half as advisory and flags large length changes', () => {
    expect(softFlags('We went half ready into release.', 'We went ready into release.').map((f) => f.code)).toContain('half_dropped');
    expect(softFlags('We went half ready into release.', 'We went half ready into release.')).toEqual([]);
    expect(softFlags('We keep every setting for every customer after the release.', 'Done.').map((f) => f.code)).toContain('length_ratio');
  });
});

describe('input validation in UTF-8 bytes', () => {
  it('accepts exact byte limits and rejects one byte over', () => {
    expect(validateInputs('x'.repeat(SOURCE_MAX_BYTES), ['y'.repeat(SAMPLES_MAX_BYTES)])).toEqual([]);
    expect(validateInputs('x'.repeat(SOURCE_MAX_BYTES + 1), ['valid']).map((e) => e.code)).toContain('source_too_large');
    expect(validateInputs('valid', ['x'.repeat(SAMPLES_MAX_BYTES), 'y']).map((e) => e.code)).toContain('samples_too_large');
    expect(validateInputs('😀'.repeat(SOURCE_MAX_BYTES / 4 + 1), ['valid']).map((e) => e.code)).toContain('source_too_large');
  });

  it('accepts 1–5 samples or a built-in voice and rejects malformed/empty input', () => {
    expect(validateInputs('source', ['one'])).toEqual([]);
    expect(validateInputs('source', Array.from({ length: 5 }, () => 'sample'))).toEqual([]);
    expect(validateInputs('source', null)).toEqual([]);
    expect(validateInputs('source', []).map((e) => e.code)).toContain('samples_count');
    expect(validateInputs('source', Array.from({ length: 6 }, () => 'sample')).map((e) => e.code)).toContain('samples_count');
    expect(validateInputs({}, ['valid']).map((e) => e.code)).toContain('source_not_text');
    expect(validateInputs(' \n', ['valid']).map((e) => e.code)).toContain('source_empty');
    expect(validateInputs('binary\u0000data', ['valid']).map((e) => e.code)).toContain('source_not_text');
    expect(validateInputs('source', 'sample').map((e) => e.code)).toContain('samples_not_list');
    expect(validateInputs('source', [' ', 42, 'bad\u0000']).map((e) => e.code)).toEqual(['sample_empty', 'sample_not_text', 'sample_not_text']);
  });
});
