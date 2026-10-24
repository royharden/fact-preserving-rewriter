// GENERATED from src/lib/mask/restore.ts; edit the source and run npm run sync:functions.
// restore(): after an integrity check, replaces each placeholder with the ORIGINAL source slice
// (sourceText.slice(slot.start, slot.end)), so restored quotes and verbatim spans are byte-identical. The restored text
// is then re-extracted by the caller for the hard checks.

import type { MaskResult, MaskSlot } from './mask.ts';
import { PLACEHOLDER_RE } from './mask.ts';
import type { IntegrityFailure } from './integrity.ts';
import { checkIntegrity } from './integrity.ts';

export type RestoreResult = { ok: true; text: string } | { ok: false; failures: IntegrityFailure[] };

export function restore(output: string, maskResult: MaskResult, sourceText: string): RestoreResult {
  const failures = checkIntegrity(output, maskResult);
  if (failures.length > 0) return { ok: false, failures };
  const byToken = new Map<string, MaskSlot>(maskResult.slots.map((s) => [s.token, s]));
  for (const s of maskResult.slots) {
    if (s.end > sourceText.length) throw new Error(`mask slot ${s.factId} lies outside the source text`);
  }
  // function replacer: no "$&"-style substitution can alter the copied slice
  const text = output.replace(PLACEHOLDER_RE, (token) => {
    const slot = byToken.get(token);
    if (!slot) throw new Error(`unreachable: unchecked placeholder ${token}`);
    return sourceText.slice(slot.start, slot.end);
  });
  return { ok: true, text };
}
