// step(): one attempt, pure (no I/O, no clock, no mutation of its input; async only because hashing uses WebCrypto).
// Shared by the offline loop and the `rewrite` edge function: given the frozen run inputs, an ordinal and the parsed
// model output -> restore (B4), hard + soft checks, overlap claim check, style distance, verdict and content hash.

import type { ClaimStatus, Flag, System, Verdict } from '../../contracts/run.ts';
import type { Fact } from '../factledger/types.ts';
import { checkAttempt } from '../checks/index.ts';
import { numberFlags } from '../checks/flags.ts';
import { buildClaimPairs } from '../claims/align.ts';
import type { ClaimJudge, ClaimPair } from '../claims/judge.ts';
import { claimFlagDrafts } from '../claims/judge.ts';
import { overlapJudge } from '../claims/overlap.ts';
import type { StyleDistance } from '../style/distance.ts';
import { styleDistance } from '../style/distance.ts';
import type { StyleProfile } from '../style/profile.ts';
import { profile } from '../style/profile.ts';
import { contentHash } from '../rulings/contentHash.ts';
import { verdictOf } from './verdict.ts';

/** Frozen run inputs that every attempt is checked against. */
export interface StepRun {
  system: System;
  sourceText: string;
  samples: string[];
  ledger: Fact[];
  /** ISO 8601 */
  referenceTime: string;
  protectedTerms: string[];
  aliases: Record<string, string[]>;
  /** Mask namespace (B4 only; null for B0-B3, whose models see the plain source). */
  maskNamespace: string | null;
}

export interface StepInput {
  run: StepRun;
  ordinal: number;
  /** The model's `rewrite` field (masked form for B4) or, for B0/B1, the computed text. */
  output: string;
  /** Claim judge for the attempt; defaults to the `overlap` judge (the llm judge runs later, on the selection only). */
  claimJudge?: ClaimJudge;
  /** Precomputed profile of run.samples (recomputed when absent; it is a pure function of the samples). */
  profile?: StyleProfile;
}

export interface StepResult {
  ordinal: number;
  /** Restored text the checks ran on; this is what would be exported. */
  text: string;
  contentHash: string;
  flags: Flag[];
  verdict: Verdict;
  claimStatus: ClaimStatus;
  style: StyleDistance;
  rewriteLedger: Fact[];
  claimPairs: ClaimPair[];
}

export async function step(input: StepInput): Promise<StepResult> {
  const { run } = input;
  if (run.system === 'B4' && run.maskNamespace === null) throw new Error('B4 runs need a mask namespace');
  const check = checkAttempt(
    {
      sourceText: run.sourceText,
      ledger: run.ledger,
      samples: run.samples,
      referenceTime: new Date(run.referenceTime),
      protectedTerms: run.protectedTerms,
      aliases: run.aliases,
      maskNamespace: run.system === 'B4' ? run.maskNamespace : null,
    },
    input.output,
  );
  const claimPairs = buildClaimPairs(run.sourceText, run.ledger, check.text, check.rewriteLedger);
  const judge = input.claimJudge ?? overlapJudge;
  const claimFlags = await judge.judge(claimPairs);
  const flags = [...check.flags, ...numberFlags(claimFlagDrafts(claimPairs, claimFlags, judge.name), check.flags)];
  const claimStatus: ClaimStatus = 'overlap_only';
  return {
    ordinal: input.ordinal,
    text: check.text,
    contentHash: await contentHash(check.text),
    flags,
    verdict: verdictOf(flags, claimStatus),
    claimStatus,
    style: styleDistance(check.text, input.profile ?? profile(run.samples)),
    rewriteLedger: check.rewriteLedger,
    claimPairs,
  };
}
