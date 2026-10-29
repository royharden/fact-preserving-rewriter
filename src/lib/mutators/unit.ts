import type { Edit } from './types.ts';
export function unitEdits(text: string): Edit[] {
  return [...text.matchAll(/\b(?:minutes?|hours?|seconds?|days?|dollars?|kilograms?|kilometers?|metres?|meters?|percent)\b|%/gi)].map((m) => ({ start: m.index, end: m.index + m[0].length, replacement: /^(?:minute|hour|second|day)/i.test(m[0]) ? (/^hours?$/i.test(m[0]) ? 'minutes' : 'hours') : /^dollars?$/i.test(m[0]) ? 'euros' : /^(?:percent|%)$/i.test(m[0]) ? 'dollars' : 'litres' }));
}
