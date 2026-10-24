import { mkdir, writeFile } from 'node:fs/promises';
import { loadCorpus, invoked, projectPath } from './common.ts';
export interface LivePlan {
  version: number; manifest_sha256: string; allowance_micro_usd: number; selected_max_calls: number;
  selected_max_reserved_micro_usd: number; run_keys: string[];
}
export function validateLivePlan(value: unknown, manifestHash: string, eligibleKeys: readonly string[]): LivePlan {
  const plan = value as LivePlan | null;
  if (!plan || plan.version !== 1 || plan.manifest_sha256 !== manifestHash || !Number.isSafeInteger(plan.allowance_micro_usd) || plan.allowance_micro_usd <= 0 || plan.allowance_micro_usd > 5_000_000 ||
      !Number.isSafeInteger(plan.selected_max_calls) || plan.selected_max_calls <= 0 || plan.selected_max_calls > 1000 ||
      !Number.isSafeInteger(plan.selected_max_reserved_micro_usd) || plan.selected_max_reserved_micro_usd <= 0 || plan.selected_max_reserved_micro_usd > plan.allowance_micro_usd ||
      !Array.isArray(plan.run_keys) || !plan.run_keys.length || plan.run_keys.length % 3 !== 0 ||
      plan.selected_max_reserved_micro_usd !== plan.run_keys.length * 150_000 || plan.selected_max_calls !== plan.run_keys.length / 3 * 19 ||
      new Set(plan.run_keys).size !== plan.run_keys.length || plan.run_keys.some((key, i) => key !== eligibleKeys[i])) throw new Error('invalid/stale bounded live reservation plan');
  return plan;
}
/** Reservation plan only. This never authorises spend, creates allowance rows or calls a provider. */
export async function planLive(allowanceMicroUsd: number): Promise<LivePlan & Record<string, unknown>> {
  if (!Number.isSafeInteger(allowanceMicroUsd) || allowanceMicroUsd <= 0 || allowanceMicroUsd > 5_000_000) throw new Error('declare owner allowance in integer micro-USD, at most proposed USD5; declaration alone is not approval');
  const { manifest, manifestHash } = await loadCorpus();
  const runs = manifest.pairs.filter((p) => p.split === 'heldout').flatMap((p) => (['B2', 'B3', 'B4'] as const).map((system) => ({ ...p, system,
    run_key: `${p.source_id}|${p.voice_id}|${system}`,
    phases: { draft: system === 'B4' ? 3 : 1, self_check: system === 'B3' ? 1 : 0, revision: system === 'B3' ? 1 : 0, judge: 4 },
    max_output_tokens_per_call: 4096, per_call_reservation_cap_micro_usd: 50_000, per_run_cap_micro_usd: 150_000,
    uncapped_phase_reservation_micro_usd: (system === 'B4' ? 7 : system === 'B3' ? 7 : 5) * 50_000,
    worst_case_charged_reservation_micro_usd: 150_000 })));
  // Select complete pair groups (B2/B3/B4), leaving the remainder explicitly unmeasured.
  const groupCost = 3 * 150_000, pairCount = Math.min(40, Math.floor(allowanceMicroUsd / groupCost));
  const selected = runs.slice(0, pairCount * 3);
  if (!selected.length) throw new Error('allowance too small for one complete B2/B3/B4 pair group');
  const plan = { version: 1, status: 'proposal, not owner authorisation', manifest_sha256: manifestHash,
    allowance_micro_usd: allowanceMicroUsd, proposed_ceiling_micro_usd: 5_000_000,
    selected_max_calls: selected.reduce((n, r) => n + Object.values(r.phases).reduce((a, b) => a + b, 0), 0),
    selected_max_reserved_micro_usd: selected.length * 150_000, full_heldout_max_reserved_micro_usd: runs.length * 150_000,
    run_keys: selected.map((r) => r.run_key), runs: selected, unplanned_runs: runs.length - selected.length,
    caveats: ['Per-call input reservation uses actual prompt UTF8-byte upper estimate and configured price; above the server per-call cap is refused before dispatch.', 'Draft includes up to three B4 drafts. B3 has draft/self-check/revision. Judge has <=4 batches of <=30 pairs.', 'The sum of phase maxima exceeds the run cap: worst-case calls may terminate incomplete; no plan promises complete evidence under the cap.', 'Owner must separately approve and provision an expiring eval_allowances row for the authenticated user, with max_calls and max_micro_usd no larger than this plan. Exact SQL setup and verified prices/model IDs remain deferred.', 'Server SQL, not this proposal or environment flag, enforces actual run/user/global/allowance limits.'] };
  return plan;
}
if (invoked(import.meta.url)) {
  const argument = process.argv.find((s) => s.startsWith('--allowance-micro-usd='));
  if (!argument) throw new Error('supply --allowance-micro-usd=<owner-declared amount>; USD5 is a proposal, not approval');
  const plan = await planLive(Number(argument.split('=')[1]));
  await mkdir(projectPath('results'), { recursive: true });
  await writeFile(projectPath('results/live-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}
