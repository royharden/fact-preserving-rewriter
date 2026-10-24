// GENERATED from src/lib/checks/index.ts; edit the source and run npm run sync:functions.
// checkAttempt(): the one deterministic checker used by browser, tests, eval and the edge function.
// Order: placeholder integrity on the raw model output (B4 only) -> restore -> re-extract the restored text -> hard
// checks a..d -> soft checks. Returns Flag[] with ids numbered per class in that emission order.

import type { Flag, FlagDraft } from '../../contracts/run.ts';
import type { Fact } from '../factledger/types.ts';
import { extract } from '../factledger/extract.ts';
import { match } from '../factledger/match.ts';
import type { MaskResult } from '../mask/mask.ts';
import { mask, PLACEHOLDER_RE } from '../mask/mask.ts';
import type { IntegrityFailure } from '../mask/integrity.ts';
import { restore } from '../mask/restore.ts';
import { addedFactFlags, copiedSampleRunFlags, missingFactFlags, placeholderFlags } from './hard.ts';
import { softFlags } from './soft.ts';
import { numberFlags } from './flags.ts';

export { numberFlags, appendFlags, countByClass } from './flags.ts';
export { validateInputs } from './limits.ts';

export const CHECKER_VERSION = 'checks-v1';

export interface CheckContext {
  sourceText: string;
  /** Frozen source ledger (toggles already applied as `required`). */
  ledger: readonly Fact[];
  samples: readonly string[];
  referenceTime: Date;
  protectedTerms?: readonly string[];
  aliases?: Readonly<Record<string, readonly string[]>>;
  /** Mask namespace when the model saw masked text (B4); null when it saw the plain source (B0-B3). */
  maskNamespace: string | null;
}

export interface CheckResult {
  /** Text the checks ran on: the restored rewrite (best-effort restore when placeholder integrity failed). */
  text: string;
  rewriteLedger: Fact[];
  flags: Flag[];
  integrityFailures: IntegrityFailure[];
}

/** Restores every issued placeholder that is present and leaves anything broken in place (used only after a failure). */
function lenientRestore(output: string, maskResult: MaskResult, sourceText: string): string {
  const byToken = new Map(maskResult.slots.map((s) => [s.token, s] as const));
  return output.replace(PLACEHOLDER_RE, (token) => {
    const slot = byToken.get(token);
    return slot ? sourceText.slice(slot.start, slot.end) : token;
  });
}

export function checkAttempt(ctx: CheckContext, output: string): CheckResult {
  let text = output;
  let integrityFailures: IntegrityFailure[] = [];
  if (ctx.maskNamespace !== null) {
    const maskResult = mask(ctx.sourceText, ctx.ledger, ctx.maskNamespace);
    const restored = restore(output, maskResult, ctx.sourceText);
    if (restored.ok) {
      text = restored.text;
    } else {
      integrityFailures = restored.failures;
      text = lenientRestore(output, maskResult, ctx.sourceText);
    }
  }

  const rewriteLedger = extract(text, {
    referenceTime: ctx.referenceTime,
    protectedTerms: ctx.protectedTerms,
    aliases: ctx.aliases,
    contextText: ctx.sourceText,
  });
  const result = match(ctx.ledger, rewriteLedger, text, ctx.sourceText);
  // a fact whose placeholder is already reported missing/duplicated is not reported again as a missing fact
  const reported = new Set(integrityFailures.filter((f) => f.factId && (f.code === 'missing' || f.code === 'duplicate')).map((f) => f.factId as string));

  const drafts: FlagDraft[] = [
    ...missingFactFlags(result, reported),
    ...addedFactFlags(result),
    ...placeholderFlags(integrityFailures),
    ...copiedSampleRunFlags(text, ctx.samples, ctx.sourceText),
    ...softFlags(ctx.sourceText, text),
  ];
  return { text, rewriteLedger, flags: numberFlags(drafts), integrityFailures };
}
