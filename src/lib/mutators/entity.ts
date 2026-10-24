import type { Edit, GoldSpan } from './types.ts';
export function entityEdits(_text: string, gold: readonly GoldSpan[]): Edit[] {
  return gold.filter((f) => f.kind === 'entity').map((f) => ({ start: f.start, end: f.end, replacement: f.raw === 'Zorven Labs' ? 'Pelora Works' : 'Zorven Labs' }));
}
