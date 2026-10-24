import { describe, it, expect } from 'vitest';
import { ex, norms, raws } from './helpers.ts';

describe('entities', () => {
  it('sentence-initial capitals are not entities on their own', () => {
    expect(norms(ex('Payments were slow. Customers waited.'), 'entity')).toEqual([]);
  });

  it('a sentence-initial word counts when it is also capitalised mid-sentence', () => {
    expect(norms(ex('Payments were slow. We fixed Payments quickly.'), 'entity')).toEqual(['Payments', 'Payments']);
  });

  it('contextText (the source) licenses a sentence-initial word in a rewrite', () => {
    expect(norms(ex('Stripe was hit.'), 'entity')).toEqual([]);
    expect(norms(ex('Stripe was hit.', { contextText: 'The outage hit Stripe.' }), 'entity')).toEqual(['Stripe']);
  });

  it('mixed-case brands are entities even at sentence start', () => {
    expect(norms(ex('iPhone sales rose while GitHub was down.'), 'entity')).toEqual(['iPhone', 'GitHub']);
  });

  it('a title + name yields the name, and "Dr." does not end the sentence', () => {
    const f = ex('Dr. Ada Lin joined. She leads SRE.');
    expect(norms(f, 'entity')).toEqual(['Ada Lin', 'SRE']);
    expect(raws(f, 'entity')[0]).toBe('Ada Lin');
  });

  it('acronyms (2+ capitals) are entities', () => {
    expect(norms(ex('Latency on the API rose; the CEO was told.'), 'entity')).toEqual(['API', 'CEO']);
  });

  it('a capitalised run after a sentence starter keeps the name only', () => {
    expect(norms(ex('The Payments API failed.'), 'entity')).toEqual(['Payments API']);
  });

  it('Markdown heading words need a licence like sentence-initial words', () => {
    expect(norms(ex('# Incident Summary\nThe Payments API failed.'), 'entity')).toEqual(['Payments API']);
  });

  it('possessives are cut from the entity span', () => {
    const f = ex('We met Acme’s team.');
    expect(raws(f, 'entity')).toEqual(['Acme']);
  });

  it('protected terms are entities whatever their case or position', () => {
    expect(norms(ex('Run kubectl daily.', { protectedTerms: ['kubectl'] }), 'entity')).toEqual(['kubectl']);
  });

  it('explicit aliases normalise to their canonical term', () => {
    const aliases = { 'Acme Cloud': ['AC'] };
    expect(norms(ex('The move to Acme Cloud finished.', { aliases }), 'entity')).toEqual(['Acme Cloud']);
    const rewrite = ex('The move to AC finished.', { aliases });
    expect(norms(rewrite, 'entity')).toEqual(['Acme Cloud']);
    expect(raws(rewrite, 'entity')).toEqual(['AC']);
  });

  it('the pronoun I is not an entity', () => {
    expect(norms(ex('Then I checked it and I’m sure.'), 'entity')).toEqual([]);
  });
});
