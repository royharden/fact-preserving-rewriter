// prepareRun(): derives the frozen run inputs from raw inputs, exactly as the rewrite edge function does on ordinal 1
// (PLAN section 6.2): source hash, ledger (with toggles; unknown toggle ids rejected), mask namespace (B4 only) and
// versions. Local demo runs compute this in the browser; live runs have it computed server-side.

import type { System } from '../../contracts/run.ts';
import type { Fact, Toggle } from '../factledger/types.ts';
import { extract, unknownToggleIds } from '../factledger/extract.ts';
import { deriveNamespace, MASK_VERSION } from '../mask/namespace.ts';
import { sha256Hex } from '../text/hash.ts';
import { CHECKER_VERSION } from '../checks/index.ts';
import { validateInputs } from '../checks/limits.ts';
import { PROMPT_VERSION } from '../prompts/version.ts';
import type { StepRun } from './step.ts';

export interface RunSpec {
  system: System;
  sourceText: string;
  samples: readonly string[];
  /** Fixed reference instant (ISO 8601). Live: the server's now() at freeze time; fixtures/demo: a constant. */
  referenceTime: string;
  toggles?: Readonly<Record<string, Toggle>>;
  aliases?: Readonly<Record<string, readonly string[]>>;
  protectedTerms?: readonly string[];
  /** Mask namespace seed: the run id (live) or fixtureSeedId(source, voice, system) (fixtures/mock/demo). */
  seedId: string;
  sourceId?: string | null;
  voiceId?: string | null;
}

export interface PreparedRun extends StepRun {
  sourceHash: string;
  toggles: Record<string, Toggle>;
  sourceId: string | null;
  voiceId: string | null;
  checkerVersion: string;
  promptVersion: string;
  maskVersion: string;
}

export class UnknownToggleError extends Error {
  readonly ids: string[];

  constructor(ids: string[]) {
    super(`toggles name unknown fact ids: ${ids.join(', ')}`);
    this.name = 'UnknownToggleError';
    this.ids = ids;
  }
}

export async function prepareRun(spec: RunSpec): Promise<PreparedRun> {
  const problems = validateInputs(spec.sourceText, spec.samples);
  if (problems.length > 0) throw new Error(`invalid_inputs: ${problems.map((p) => p.message).join(' ')}`);
  const referenceTime = new Date(spec.referenceTime);
  if (Number.isNaN(referenceTime.getTime())) throw new Error(`invalid reference time: ${spec.referenceTime}`);
  const toggles = { ...(spec.toggles ?? {}) };
  const base = { referenceTime, protectedTerms: spec.protectedTerms, aliases: spec.aliases };
  const untoggled: Fact[] = extract(spec.sourceText, base);
  const unknown = unknownToggleIds(untoggled, toggles);
  if (unknown.length > 0) throw new UnknownToggleError(unknown);
  const ledger = extract(spec.sourceText, { ...base, toggles });
  const maskNamespace = spec.system === 'B4' ? (await deriveNamespace(spec.seedId, [spec.sourceText, ...spec.samples])).namespace : null;
  return {
    system: spec.system,
    sourceText: spec.sourceText,
    samples: [...spec.samples],
    ledger,
    referenceTime: referenceTime.toISOString(),
    protectedTerms: [...(spec.protectedTerms ?? [])],
    aliases: Object.fromEntries(Object.entries(spec.aliases ?? {}).map(([k, v]) => [k, [...v]])),
    maskNamespace,
    sourceHash: await sha256Hex(spec.sourceText),
    toggles,
    sourceId: spec.sourceId ?? null,
    voiceId: spec.voiceId ?? null,
    checkerVersion: CHECKER_VERSION,
    promptVersion: PROMPT_VERSION,
    maskVersion: MASK_VERSION,
  };
}
