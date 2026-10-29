import { readFile } from 'node:fs/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SYSTEMS } from '../../src/contracts/run.ts';
import type { System } from '../../src/contracts/run.ts';
import { extract } from '../../src/lib/factledger/extract.ts';
import { match } from '../../src/lib/factledger/match.ts';
import { createOverlapJudge } from '../../src/lib/claims/overlap.ts';
import { profile } from '../../src/lib/style/profile.ts';
import { styleDistance } from '../../src/lib/style/distance.ts';
import { createMockRewriter, MOCK_MODEL, MockRecordingMissing } from '../../src/lib/providers/mock.ts';
import type { ScriptsTable, RecordingsFile } from '../../src/lib/providers/mock.ts';
import type { Rewriter } from '../../src/lib/providers/types.ts';
import { deriveNamespace, fixtureSeedId } from '../../src/lib/mask/namespace.ts';
import { sha256Hex } from '../../src/lib/text/hash.ts';
import { runSystem } from '../../src/lib/baselines/systems.ts';
import type { PipelineRun } from '../../src/lib/loop/runPipeline.ts';
import { evidenceLabel, summarizeRows, validateRow } from '../../src/lib/evalkit/resultsMd.ts';
import type { EvalRow } from '../../src/lib/evalkit/resultsMd.ts';
import { wilson } from '../../src/lib/evalkit/wilson.ts';
import { frozenThreshold } from './claims.ts';
import { invoked, loadCorpus, projectPath, provenance, writeArtifact } from './common.ts';
import type { Source } from './common.ts';
import type { SupabaseStore } from '../../src/lib/store/supabaseStore.ts';
import { EvalRequirementSchema } from '../../src/contracts/api.ts';
import { restoreEvalSession } from './session.ts';
import { validateLivePlan } from './plan-live.ts';

interface LedgerRow { id: string; reserved_micro_usd: number; actual_micro_usd: number | null; status: string; provider: string; model: string }
/** A broken corpus is a command failure; actual provider/operational failures remain measurements. */
export function measurementError(error: unknown): string {
  if (error instanceof MockRecordingMissing) throw error;
  return error instanceof Error ? error.message : 'run error';
}
/** All paid work is delegated to authenticated deployed functions through SupabaseStore. */
async function liveResult(store: SupabaseStore, client: SupabaseClient, run: PipelineRun): Promise<{ text: string | null; attempts: number; complete: boolean; error: string | null; ledger: LedgerRow[] }> {
  const created = await store.createRun({ system: run.system, mode: 'live', sourceId: run.sourceId, voiceId: run.voiceId, sourceText: run.sourceText, samples: run.samples, toggles: {}, aliases: {}, protectedTerms: [] });
  let error: string | null = null;
  try {
    let ordinal: number | null = 1;
    while (ordinal !== null) {
      const reply = await store.requestRewrite({ run_id: created.id, expected_ordinal: ordinal, request_key: `eval:${created.id}:${ordinal}`, source_hash: await sha256Hex(run.sourceText) });
      ordinal = reply.next_ordinal;
    }
    const before = await store.loadRun(created.id);
    if (before?.run.status === 'judging' && before.run.selectedAttemptId) await store.requestJudge({ run_id: created.id, attempt_id: before.run.selectedAttemptId, request_key: `eval:${created.id}:judge` });
  } catch (e) { error = e instanceof Error ? e.message : 'live function error'; }
  const bundle = await store.loadRun(created.id);
  const response = await client.from('call_ledger').select('id,reserved_micro_usd,actual_micro_usd,status,provider,model').eq('run_id', created.id);
  if (response.error) throw new Error('cannot read authenticated call ledger');
  const ledger = (response.data ?? []) as LedgerRow[];
  if (ledger.some((r) => r.provider === 'mock')) throw new Error('live row contains mock call');
  const selected = bundle?.attempts.find((a) => a.id === bundle.run.selectedAttemptId);
  return { text: selected?.outputText ?? null, attempts: bundle?.attempts.length ?? 0, complete: error === null && bundle?.run.status === 'review_ready' && selected?.state === 'complete', error: error ?? bundle?.run.error ?? null, ledger };
}
export async function runE2E(mode: 'mock' | 'live' = 'mock'): Promise<void> {
  const artifactName = `e2e-${mode}`;
  await readFile(projectPath(`results/${artifactName}.json`), 'utf8').then(() => { throw new Error('E2E edition already exists; preserve it and review a new edition explicitly'); }, (e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
  const { manifest, manifestHash, voices } = await loadCorpus();
  const threshold = await frozenThreshold(manifest, manifestHash);
  const judge = createOverlapJudge({ supportMin: threshold.support_min, minContentWords: threshold.min_content_words });
  let rewriter: Rewriter = { name: 'computed-only', call: async () => { throw new Error('computed system made model call'); } };
  let client: SupabaseClient | null = null, store: SupabaseStore | null = null;
  let allowedRuns: Set<string> | null = null;
  let livePreflight: unknown = null;
  if (mode === 'mock') {
    const scripts = JSON.parse(await readFile(projectPath('fixtures/mock/scripts.json'), 'utf8')) as ScriptsTable;
    const recordings = await readFile(projectPath('fixtures/mock/recordings.json'), 'utf8').then((s) => JSON.parse(s) as RecordingsFile).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return undefined; throw e; });
    rewriter = createMockRewriter({ scripts, recordings });
  } else {
    const eligibleKeys = manifest.pairs.filter((p) => p.split === 'heldout').flatMap((p) => ['B2', 'B3', 'B4'].map((system) => `${p.source_id}|${p.voice_id}|${system}`));
    const plan = validateLivePlan(JSON.parse(await readFile(projectPath('results/live-plan.json'), 'utf8')), manifestHash, eligibleKeys);
    allowedRuns = new Set(plan.run_keys);
    // Public endpoint + public anonymous key only. Provider keys never enter this script.
    const url = process.env.VITE_SUPABASE_URL, anon = process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anon) throw new Error('live requires public VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
    const requirement = EvalRequirementSchema.parse({ max_calls: plan.selected_max_calls, max_micro_usd: plan.allowance_micro_usd,
      required_micro_usd: plan.selected_max_reserved_micro_usd, approval_reference: process.env.EVAL_OWNER_APPROVAL_REFERENCE });
    const { createClient } = await import('@supabase/supabase-js');
    const { createSupabaseStore } = await import('../../src/lib/store/supabaseStore.ts');
    client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const userId = await restoreEvalSession(client, url);
    store = createSupabaseStore(client, { expectedUserId: userId });
    const probe = await store.probeConfiguration(requirement);
    if (!probe.configured) throw new Error('live backend is not configured');
    if (probe.eval_allowance_ready !== true) throw new Error('approved user has no matching active bounded eval allowance ready for this plan');
    livePreflight = { user_id: userId, owner_approval_reference: requirement.approval_reference, allowance_ready: true,
      checked_at: new Date().toISOString(), scope: 'verified caller newest active allowance; readiness only, SQL rechecks actual caps atomically' };
  }
  const rows: EvalRow[] = [], unmeasured: unknown[] = [];
  for (const pair of manifest.pairs) {
    const source = manifest.sources.find((s) => s.id === pair.source_id) as Source;
    const voice = manifest.voices.find((v) => v.id === pair.voice_id);
    const samples = [voices.get(pair.voice_id) as string], prof = profile(samples);
    const ledger = extract(source.text, { referenceTime: new Date(manifest.reference_time) });
    for (const system of SYSTEMS) {
      if (mode === 'live' && system !== 'B0' && system !== 'B1' && !allowedRuns?.has(`${source.id}|${pair.voice_id}|${system}`)) {
        unmeasured.push({ ...pair, system, status: 'not yet measured', incomplete: true, error: 'outside bounded owner proposal' });
        continue;
      }
      const run: PipelineRun = { system, sourceId: source.id, voiceId: pair.voice_id, sourceText: source.text, samples, ledger, referenceTime: manifest.reference_time, aliases: {}, protectedTerms: [], maskNamespace: system === 'B4' ? (await deriveNamespace(fixtureSeedId(source.id, pair.voice_id, system), [source.text, ...samples])).namespace : null };
      const started = performance.now();
      let text: string | null = null, complete = false, error: string | null = null, attempts = 0;
      let ids: string[] = [], reserved: number | null = system === 'B0' || system === 'B1' ? 0 : null, actual = reserved;
      let models: string[] = [];
      try {
        if (mode === 'live' && system !== 'B0' && system !== 'B1') {
          const live = await liveResult(store as SupabaseStore, client as SupabaseClient, run);
          ({ text, complete, error, attempts } = live);
          ids = live.ledger.map((r) => r.id);
          models = [...new Set(live.ledger.map((r) => r.model))];
          reserved = live.ledger.reduce((n, r) => n + Number(r.reserved_micro_usd), 0);
          actual = live.ledger.some((r) => r.actual_micro_usd === null) ? null : live.ledger.reduce((n, r) => n + Number(r.actual_micro_usd), 0);
          if (!ids.length) { unmeasured.push({ ...pair, system, status: 'not yet measured', incomplete: true, error: error ?? 'no paid ledger calls; cannot publish live model row' }); continue; }
        } else {
          const result = await runSystem(run, { rewriter, model: MOCK_MODEL, claimJudge: judge });
          const selected = result.attempts.find((a) => a.ordinal === result.selectedOrdinal);
          text = selected?.result?.text ?? null;
          models = [...new Set(result.attempts.flatMap((a) => a.calls.map((c) => c.model)))];
          error = result.error; attempts = result.attempts.length; complete = text !== null && error === null;
        }
      } catch (e) { error = measurementError(e); }
      if (mode === 'live' && system !== 'B0' && system !== 'B1' && !ids.length) { unmeasured.push({ ...pair, system, status: 'not yet measured', incomplete: true, error }); continue; }
      const comparison = text === null ? null : match(ledger, extract(text, { referenceTime: new Date(manifest.reference_time), contextText: source.text }), text, source.text);
      const beforeStyle = styleDistance(source.text, prof).value, afterStyle = text === null ? null : styleDistance(text, prof).value;
      const row: EvalRow = { ...pair, system: system as System, mode: system === 'B0' || system === 'B1' ? 'computed' : mode,
        label: evidenceLabel(system, mode), voice_placeholder: voice?.placeholder ?? true, complete, error, final_text: text,
        preserved: complete && comparison !== null && comparison.missing.length === 0 && comparison.added.length === 0,
        missing_facts: comparison?.missing.length ?? ledger.filter((f) => f.required).length, added_facts: comparison?.added.length ?? 0,
        style_delta: beforeStyle === null || afterStyle === null ? null : beforeStyle - afterStyle, attempts, latency_ms: performance.now() - started,
        source_words: source.word_count, ledger_ids: ids, model_ids: models, reserved_micro_usd: reserved, actual_micro_usd: actual };
      validateRow(row); rows.push(row);
    }
    // Persist partial rows after each pair, including failures. No extrapolation after a cap.
    const denominatorSummary = ['dev', 'heldout'].flatMap((split) => SYSTEMS.map((system) => {
      const expected = manifest.pairs.filter((p) => p.split === split).length;
      const present = rows.filter((r) => r.split === split && r.system === system);
      const missing = unmeasured.filter((r) => (r as { split: string; system: string }).split === split && (r as { system: string }).system === system).length;
      const clusters = manifest.sources.filter((s) => s.split === split).map((s) => {
        const denominator = manifest.pairs.filter((p) => p.source_id === s.id).length;
        return { source_id: s.id, denominator, successes: present.filter((r) => r.source_id === s.id && r.preserved).length,
          measured_pairs: present.filter((r) => r.source_id === s.id).length };
      });
      return { split, system, expected_pairs: expected, measured_rows: present.length, unmeasured_or_refused: missing, not_processed: expected - present.length - missing,
        preservation_including_failures_and_unmeasured: wilson(present.filter((r) => r.preserved).length, expected),
        source_clusters: clusters, source_cluster_count: clusters.length,
        source_cluster_mean_including_unmeasured: clusters.reduce((n, c) => n + c.successes / c.denominator, 0) / clusters.length,
        status: present.length === expected ? 'complete' : 'incomplete; unmeasured outcomes are zero successes in this conservative denominator, never extrapolated' };
    }));
    await writeArtifact(artifactName, { provenance: provenance(manifest, manifestHash), mode, local_overlap_threshold: threshold, live_preflight: livePreflight,
      live_overlap_threshold: mode === 'live' ? 'deployed checker constants; local calibration does not reconfigure the server' : null,
      rows, unmeasured, denominator_summary: denominatorSummary, measured_subset_summary: summarizeRows(rows),
      llm_claim_evaluation: 'comparative corpus ablation/calibration omitted under optional cut; live server-selected-attempt judge remains available',
      live_model_rows: mode === 'mock' ? 'not yet measured' : 'ledger-backed only' }, { exclusive: pair === manifest.pairs[0] });
  }
}
if (invoked(import.meta.url)) await runE2E(process.argv.includes('--live') ? 'live' : 'mock');
