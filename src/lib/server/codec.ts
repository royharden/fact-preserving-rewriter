// Explicit wire mapping; JSON payloads (Fact/Flag/repair/coverage) retain their contract camelCase keys.
import type { Attempt, Run, Ruling } from '../../contracts/run.ts';
import type { Row } from './types.ts';

export function runFromRow(r: Row): Run {
  return {
    id: r.id as string, userId: r.user_id as string, system: r.system as Run['system'],
    mode: r.mode === 'mock' ? 'demo' : 'live', sourceId: r.source_id as string | null,
    voiceId: r.voice_id as string | null, profileId: r.profile_id as string | null,
    sourceText: r.source_text as string, samples: r.samples as string[], toggles: r.toggles as Run['toggles'],
    aliases: r.aliases as Run['aliases'], protectedTerms: r.protected_terms as string[],
    sourceHash: r.source_hash as string | null, ledger: r.ledger as Run['ledger'],
    maskNamespace: r.mask_namespace as string | null, referenceTime: r.reference_time as string | null,
    checkerVersion: r.checker_version as string | null, promptVersion: r.prompt_version as string | null,
    maskVersion: r.mask_version as string | null, status: r.status as Run['status'],
    evidenceVersion: r.evidence_version as number, selectedAttemptId: r.selected_attempt_id as string | null,
    verdict: r.verdict as Run['verdict'], error: r.error as string | null, createdAt: r.created_at as string,
    localDemo: false,
  };
}
export function attemptFromRow(r: Row): Attempt {
  return {
    id: r.id as string, runId: r.run_id as string, ordinal: r.ordinal as number,
    requestKey: r.request_key as string | null, state: r.state as Attempt['state'],
    outputText: r.output_text as string | null, contentHash: r.content_hash as string | null,
    flags: r.flags as Attempt['flags'], repairRequest: r.repair_request as Attempt['repairRequest'],
    verdict: r.verdict as Attempt['verdict'], claimStatus: r.claim_status as Attempt['claimStatus'],
    judgeCoverage: r.judge_coverage as Attempt['judgeCoverage'], styleDistance: r.style_distance as number | null,
    styleReason: r.style_reason as string | null, error: r.error as string | null, createdAt: r.created_at as string,
  };
}
export function rulingFromRow(r: Row): Ruling {
  return {
    id: r.id as string, kind: 'rewrite', userId: r.user_id as string | null, runId: r.run_id as string,
    attemptId: r.attempt_id as string, contentHash: r.content_hash as string, evidenceVersion: r.evidence_version as number,
    decision: r.decision as Ruling['decision'], reason: r.reason as string | null,
    acknowledgedFlags: r.acknowledged_flags as string[], createdAt: r.created_at as string, localDemo: false,
  };
}
