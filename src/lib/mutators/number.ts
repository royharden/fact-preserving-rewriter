import type { Edit, GoldSpan } from './types.ts';
export function numberEdits(text: string, gold: readonly GoldSpan[]): Edit[] {
  return gold.filter((f) => f.kind === 'number').flatMap((f) => {
    const digit = /\d/.exec(f.raw);
    if (digit) return [{ start: f.start + digit.index, end: f.start + digit.index + 1, replacement: digit[0] === '9' ? '8' : String(Number(digit[0]) + 1) }];
    const word = /\b(?:two|three|four|five|six|seven|eight|nine|ten|twelve|fifty|half)\b/i.exec(f.raw);
    return word ? [{ start: f.start + word.index, end: f.start + word.index + word[0].length, replacement: word[0].toLowerCase() === 'two' ? 'three' : 'two' }] : [];
  });
}
