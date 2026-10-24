import type { Edit, GoldSpan } from './types.ts';
export function dateEdits(_text: string, gold: readonly GoldSpan[]): Edit[] {
  return gold.filter((f) => f.kind === 'date').map((f) => ({ start: f.start, end: f.end, replacement: f.raw === 'January 1, 2044' ? 'January 2, 2044' : 'January 1, 2044' }));
}
