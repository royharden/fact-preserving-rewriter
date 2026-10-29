import type { Edit } from './types.ts';
export function negationEdits(text: string): Edit[] {
  return [...text.matchAll(/\b(?:not|never|no)\b|n['’]t\b/gi)].map((m) => ({ start: m.index, end: m.index + m[0].length, replacement: '' }));
}
