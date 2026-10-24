import { expect, it } from 'vitest';
import { formatPointer, parsePointer, resolvePointer } from '../../../src/lib/cited/pointer.ts';

it('round-trips half-open UTF-16 pointers without accepting malformed or out-of-range spans', () => {
  const text = '😀 cache';
  expect(formatPointer({ start: 3, end: 8 })).toBe('text:3-8');
  expect(parsePointer('text:3-8')).toEqual({ start: 3, end: 8 });
  expect(resolvePointer(text, 'text:3-8')).toBe('cache');
  for (const pointer of ['text:03-8', 'text:8-3', 'text:-1-2', 'text:0-900']) expect(resolvePointer(text, pointer)).toBeNull();
  expect(() => formatPointer({ start: 4, end: 3 })).toThrow();
});
