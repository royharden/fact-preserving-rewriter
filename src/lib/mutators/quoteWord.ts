import type { Edit, GoldSpan } from './types.ts';
export function quoteWordEdits(_text: string, gold: readonly GoldSpan[]): Edit[] {
  return gold.filter((f) => f.kind === 'quote').flatMap((f) => {
    const word = /\p{L}+/u.exec(f.raw);
    return word ? [{ start: f.start + word.index, end: f.start + word.index + word[0].length, replacement: word[0] === 'altered' ? 'changed' : 'altered' }] : [];
  });
}
