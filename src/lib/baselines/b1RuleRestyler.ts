import { extract } from '../factledger/extract.ts';
import { checkAttempt } from '../checks/index.ts';
import { sentences } from '../text/segment.ts';
/** Every sentence is hard-rechecked; a whole-text guard catches boundary effects. */
export function b1RuleRestyler(sourceText: string, _samples: readonly string[] = [], referenceTime = new Date('2026-10-24T12:00:00.000Z')): string {
  const ledger = extract(sourceText, { referenceTime });
  const safe = (source: string, candidate: string): boolean => !checkAttempt({ sourceText: source, ledger: extract(source, { referenceTime }), samples: [], referenceTime, maskNamespace: null }, candidate).flags.some((f) => f.class === 'hard');
  const original = sentences(sourceText);
  const restyled = original.map((s) => {
    const protectedSpans = ledger.filter((f) => f.start < s.end && f.end > s.start);
    if (protectedSpans.some((f) => f.start < s.start || f.end > s.end)) return s.text;
    let candidate = '', cursor = s.start;
    const restyle = (t: string): string => t.replace(/\bdo not\b/g, "don't").replace(/\bcannot\b/g, "can't").replace(/\bis not\b/g, "isn't").replace(/\bare not\b/g, "aren't").replace(/\s+--\s+/g, ' — ').replace(/;\s+(?=[a-z])/g, '. ').replace(/\.\s+(?=[a-z])/g, '; ');
    for (const f of protectedSpans) {
      candidate += restyle(sourceText.slice(cursor, f.start)) + f.raw;
      cursor = f.end;
    }
    candidate += restyle(sourceText.slice(cursor, s.end));
    return safe(s.text, candidate) ? candidate : s.text;
  });
  // A deterministic adjacent-sentence merge is also checked against both original sentences.
  const merged: string[] = [];
  for (let i = 0; i < original.length; i++) {
    if (i + 1 < original.length && /\.\s+$/.test(restyled[i])) {
      const candidate = restyled[i].replace(/\.\s+$/, '; ') + restyled[i + 1];
      if (safe(original[i].text + original[i + 1].text, candidate)) { merged.push(candidate); i++; continue; }
    }
    merged.push(restyled[i]);
  }
  const result = merged.join('');
  return safe(sourceText, result) ? result : sourceText;
}
