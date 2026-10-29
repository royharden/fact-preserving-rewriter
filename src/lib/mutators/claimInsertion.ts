import type { Edit } from './types.ts';
export function claimInsertionEdits(text: string): Edit[] {
  const claim = 'The secret committee approved an unrelated merger.';
  return text.includes(claim) ? [] : [{ start: text.length, end: text.length, replacement: `\n${claim}` }];
}
