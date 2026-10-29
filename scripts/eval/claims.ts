import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { extract } from '../../src/lib/factledger/extract.ts';
import { buildClaimPairs } from '../../src/lib/claims/align.ts';
import { judgeOverlap } from '../../src/lib/claims/overlap.ts';
import { wilson } from '../../src/lib/evalkit/wilson.ts';
import { mutate, MUTATION_TYPES } from '../../src/lib/mutators/index.ts';
import { invoked, loadCorpus, projectPath, provenance, writeArtifact } from './common.ts';
import type { Manifest, Source } from './common.ts';
import type { MutationType } from '../../src/lib/mutators/types.ts';
export interface FrozenThreshold { version: 1; status: 'frozen'; manifest_sha256: string; checker_version: string; support_min: number; min_content_words: number; dev_source_ids: string[]; false_alarms: number; total: number; target_met: boolean }
export interface ClaimRow { source_id: string; split: string; type: 'known_good' | MutationType; applicable: boolean; flagged: boolean }
function claimsSummary(rows: ClaimRow[]) {
  return ['dev', 'heldout'].flatMap((split) => ['known_good', ...MUTATION_TYPES].map((type) => {
    const selected = rows.filter((r) => r.split === split && r.type === type && r.applicable);
    return { split, type, metric: type === 'known_good' ? 'false alarm' : 'recall', interval: wilson(selected.filter((r) => r.flagged).length, selected.length), rejected: rows.filter((r) => r.split === split && r.type === type && !r.applicable).length };
  }));
}
/** Reuse never examines heldout text or reruns mutators/judges. A stale or incomplete edition fails closed. */
export function validateClaimsEdition(value: unknown, manifest: Manifest, manifestHash: string, frozen: FrozenThreshold): void {
  if (!value || typeof value !== 'object') throw new Error('invalid existing claims edition; preserve evidence');
  const artifact = value as { edition_version?: unknown; provenance?: unknown; threshold?: unknown; label?: unknown; rows?: unknown; summary?: unknown };
  if (artifact.edition_version !== 1 || artifact.label !== 'computed overlap, no model call' ||
      !isDeepStrictEqual(artifact.provenance, provenance(manifest, manifestHash)) || !isDeepStrictEqual(artifact.threshold, frozen) || !Array.isArray(artifact.rows)) throw new Error('stale claims edition/provenance; preserve it and review a new edition explicitly');
  const rows = artifact.rows as ClaimRow[];
  const expected = new Map(manifest.sources.flatMap((s) => ['known_good', ...MUTATION_TYPES].map((type) => [`${s.id}|${type}`, s.split] as const)));
  if (rows.length !== expected.size) throw new Error('incomplete claims edition; preserve evidence');
  for (const row of rows) {
    const key = `${row?.source_id}|${row?.type}`;
    if (expected.get(key) !== row?.split || !expected.delete(key) || typeof row.applicable !== 'boolean' || typeof row.flagged !== 'boolean' ||
        (row.type === 'known_good' && !row.applicable) || (!row.applicable && row.flagged)) throw new Error('invalid claims edition rows; preserve evidence');
  }
  if (expected.size || !isDeepStrictEqual(artifact.summary, claimsSummary(rows))) throw new Error('invalid claims edition summary; preserve evidence');
}
function pairs(source: Source, rewrite: string, referenceTime: string) {
  const opts = { referenceTime: new Date(referenceTime), contextText: source.text };
  return buildClaimPairs(source.text, extract(source.text, opts), rewrite, extract(rewrite, opts));
}
/** Dev data only enters selection. Freeze with exclusive create before any held-out mutation is inspected. */
export async function frozenThreshold(manifest: Manifest, manifestHash: string, calibrateOnly = false): Promise<FrozenThreshold> {
  const path = projectPath('results/claim-thresholds.json');
  const existing = await readFile(path, 'utf8').catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e; });
  if (existing !== null) {
    const frozen = JSON.parse(existing) as FrozenThreshold;
    if (frozen.version !== 1 || frozen.status !== 'frozen' || frozen.manifest_sha256 !== manifestHash || frozen.checker_version !== 'checks-v1' ||
        ![0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1].includes(frozen.support_min) || frozen.min_content_words !== 2 ||
        !isDeepStrictEqual(frozen.dev_source_ids, manifest.sources.filter((s) => s.split === 'dev').map((s) => s.id).sort()) ||
        frozen.total !== frozen.dev_source_ids.length || !Number.isSafeInteger(frozen.false_alarms) || frozen.false_alarms < 0 || frozen.false_alarms > frozen.total ||
        frozen.target_met !== (frozen.false_alarms / frozen.total <= 0.05)) throw new Error('stale frozen thresholds; review a new calibration version explicitly');
    return frozen;
  }
  if (!calibrateOnly) throw new Error('calibrate on dev first: npm run eval:claims -- --calibrate-only; review and commit results/claim-thresholds.json before heldout evaluation');
  const dev = manifest.sources.filter((s) => s.split === 'dev');
  const goodPairs = await Promise.all(dev.map(async (s) => pairs(s, await readFile(projectPath(s.good_path), 'utf8'), manifest.reference_time)));
  const candidates = [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
  const measurements = candidates.map((support_min) => ({ support_min, false_alarms: goodPairs.filter((p) => judgeOverlap(p, { supportMin: support_min, minContentWords: 2 }).length > 0).length }));
  const selected = measurements.find((m) => m.false_alarms / dev.length <= 0.05) ?? measurements[measurements.length - 1];
  const frozen: FrozenThreshold = { version: 1, status: 'frozen', manifest_sha256: manifestHash, checker_version: 'checks-v1', support_min: selected.support_min, min_content_words: 2, dev_source_ids: dev.map((s) => s.id).sort(), false_alarms: selected.false_alarms, total: dev.length, target_met: selected.false_alarms / dev.length <= 0.05 };
  await mkdir(projectPath('results'), { recursive: true });
  await writeFile(path, `${JSON.stringify({ ...frozen, candidates: measurements }, null, 2)}\n`, { flag: 'wx' });
  return frozen;
}
export async function runClaims(options: { existing?: 'refuse' | 'reuse' } = {}): Promise<void> {
  const { manifest, manifestHash } = await loadCorpus();
  const calibrationOnly = process.argv.includes('--calibrate-only');
  const frozen = await frozenThreshold(manifest, manifestHash, calibrationOnly);
  if (calibrationOnly) { process.stdout.write('Dev threshold artifact frozen. Review and commit before heldout; no heldout examples evaluated.\n'); return; }
  const existing = await readFile(projectPath('results/claims.json'), 'utf8').catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e; });
  if (existing !== null) {
    if (options.existing !== 'reuse') throw new Error('heldout claims already evaluated; preserve artifact, do not retune/re-evaluate this heldout edition');
    validateClaimsEdition(JSON.parse(existing), manifest, manifestHash, frozen);
    process.stdout.write('Reusing validated heldout claims edition; no heldout reevaluation or artifact write.\n');
    return;
  }
  const rows: ClaimRow[] = [];
  for (const source of manifest.sources) {
    const good = await readFile(projectPath(source.good_path), 'utf8');
    const opts = { supportMin: frozen.support_min, minContentWords: frozen.min_content_words };
    rows.push({ source_id: source.id, split: source.split, type: 'known_good', applicable: true, flagged: judgeOverlap(pairs(source, good, manifest.reference_time), opts).length > 0 });
    for (const [index, type] of MUTATION_TYPES.entries()) {
      const result = mutate(type, source.text, source.gold, manifest.seeds.mutator + manifest.sources.indexOf(source) * 10 + index);
      rows.push({ source_id: source.id, split: source.split, type, applicable: result.mutation !== null, flagged: result.mutation ? judgeOverlap(pairs(source, result.mutation.text, manifest.reference_time), opts).length > 0 : false });
    }
  }
  const summary = claimsSummary(rows);
  await writeArtifact('claims', { edition_version: 1, provenance: provenance(manifest, manifestHash), label: 'computed overlap, no model call', threshold: frozen, calibration: frozen.target_met ? 'dev target <=5% met; frozen before heldout' : 'dev target <=5% unattainable in declared grid', llm: 'not yet measured; optional ClaimJudge client exists, no fabricated judgements', Jev: 'not evaluated', rows, summary }, { exclusive: true });
}
if (invoked(import.meta.url)) await runClaims();
