// Code-written repair requests (spec item 9): built only from the previous attempt's stored hard flags, never from
// model critique. Quote/verbatim facts are named by their placeholder, so masked text is never re-sent raw.

import type { Flag, RepairItem, RepairRequest } from '../../contracts/run.ts';
import type { Fact } from '../factledger/types.ts';
import { isMaskedKind, placeholder } from '../mask/mask.ts';

export function buildRepairRequest(fromOrdinal: number, flags: readonly Flag[], ledger: readonly Fact[], namespace: string | null): RepairRequest | null {
  const byId = new Map(ledger.map((f) => [f.id, f] as const));
  const items: RepairItem[] = flags
    .filter((f) => f.class === 'hard')
    .map((f) => {
      const fact = f.factId ? byId.get(f.factId) : undefined;
      const value = fact ? (isMaskedKind(fact) && namespace ? placeholder(namespace, fact.id) : fact.raw) : undefined;
      return {
        flagId: f.id,
        code: f.code,
        ...(f.factId ? { factId: f.factId } : {}),
        ...(f.kind ? { kind: f.kind } : {}),
        ...(value !== undefined ? { value } : {}),
        found: f.found,
      };
    });
  return items.length > 0 ? { version: 'repair-v1', fromOrdinal, items } : null;
}

function line(item: RepairItem): string {
  const what = item.kind ? `${item.kind} ` : '';
  switch (item.code) {
    case 'missing_fact':
      return `Missing ${what}${item.factId ?? ''}: ${item.value ?? '(unknown)'} must appear in the rewrite with the same meaning. Found instead: ${item.found}.`;
    case 'added_fact':
      return `Added ${what}"${item.found}" does not appear in the source. Remove it.`;
    case 'placeholder_missing':
      return `Placeholder ${item.value ?? item.factId ?? ''} is missing. Include it exactly once, unchanged.`;
    case 'placeholder_duplicate':
      return `Placeholder ${item.value ?? item.factId ?? ''} ${item.found}. Include it exactly once.`;
    case 'placeholder_unknown':
      return `Placeholder "${item.found}" was never issued. Remove it.`;
    case 'placeholder_malformed':
      return `A placeholder is broken near "${item.found}". Copy every placeholder exactly as given.`;
    case 'copied_sample_run':
      return `This passage is copied from a style sample: "${item.found}". Rephrase it; imitate the style, not the words.`;
    default:
      return `${item.code}: ${item.found}.`;
  }
}

/** The exact text sent in the <repair_request> block and shown to the user verbatim. */
export function renderRepairRequest(req: RepairRequest): string {
  return [
    `The previous attempt (attempt ${req.fromOrdinal}) failed these checks, run by code. Fix every item and keep everything else.`,
    ...req.items.map((item, i) => `${i + 1}. [${item.flagId}] ${line(item)}`),
  ].join('\n');
}
