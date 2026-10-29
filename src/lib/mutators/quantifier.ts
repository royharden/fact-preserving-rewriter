import type { Edit } from './types.ts';
export function quantifierEdits(text: string): Edit[] {
  return [...text.matchAll(/\b(?:all|only|most|some)\b/gi)].map((m) => ({ start: m.index, end: m.index + m[0].length, replacement: m[0].toLowerCase() === 'all' ? 'some' : 'all' }));
}
