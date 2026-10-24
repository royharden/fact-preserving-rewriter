import type { Edit } from './types.ts';
export function modalEdits(text: string): Edit[] {
  return [...text.matchAll(/\b(?:must|should|may)\b/gi)].map((m) => ({ start: m.index, end: m.index + m[0].length, replacement: m[0].toLowerCase() === 'may' ? 'must' : 'may' }));
}
