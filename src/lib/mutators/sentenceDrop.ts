import { sentences } from '../text/segment.ts';
import type { Edit } from './types.ts';
export function sentenceDropEdits(text: string): Edit[] {
  return sentences(text).filter((s) => s.text.trim().length > 0).map((s) => ({ start: s.start, end: s.end, replacement: '' }));
}
