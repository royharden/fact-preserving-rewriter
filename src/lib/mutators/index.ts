import { seededRandom } from '../evalkit/seed.ts';
import { numberEdits } from './number.ts';
import { unitEdits } from './unit.ts';
import { dateEdits } from './date.ts';
import { entityEdits } from './entity.ts';
import { quoteWordEdits } from './quoteWord.ts';
import { negationEdits } from './negation.ts';
import { modalEdits } from './modal.ts';
import { quantifierEdits } from './quantifier.ts';
import { sentenceDropEdits } from './sentenceDrop.ts';
import { claimInsertionEdits } from './claimInsertion.ts';
import type { Edit, GoldSpan, MutationResult, MutationType } from './types.ts';
export type { GoldSpan, Mutation, MutationResult, MutationType } from './types.ts';
export const MUTATION_TYPES: readonly MutationType[] = ['number', 'unit', 'date', 'entity', 'quote_word', 'negation', 'modal', 'quantifier', 'sentence_drop', 'claim_insertion'];
const edits: Record<MutationType, (text: string, gold: readonly GoldSpan[]) => Edit[]> = {
  number: numberEdits, unit: unitEdits, date: dateEdits, entity: entityEdits, quote_word: quoteWordEdits,
  negation: negationEdits, modal: modalEdits, quantifier: quantifierEdits, sentence_drop: sentenceDropEdits, claim_insertion: claimInsertionEdits,
};
/** Select among applicable edits. Missing targets and edits that change no bytes are explicit rejections. */
export function mutate(type: MutationType, text: string, gold: readonly GoldSpan[], seed: number): MutationResult {
  for (const f of gold) if (text.slice(f.start, f.end) !== f.raw) throw new Error(`stale gold span: ${f.id}`);
  const candidates = edits[type](text, gold).filter((e) => e.start >= 0 && e.end >= e.start && e.end <= text.length && text.slice(e.start, e.end) !== e.replacement);
  if (!candidates.length) return { mutation: null, rejected: 'no applicable non-noop target' };
  const e = candidates[Math.floor(seededRandom(seed)() * candidates.length)];
  const changed = text.slice(0, e.start) + e.replacement + text.slice(e.end);
  if (changed === text) return { mutation: null, rejected: 'no-op rejected' };
  return { mutation: { type, seed, text: changed, location: { start: e.start, end: e.end }, before: text.slice(e.start, e.end), after: e.replacement }, rejected: null };
}
