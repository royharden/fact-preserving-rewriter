import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GoldSpan } from '../../src/lib/mutators/types.ts';
import type { Split } from '../../src/lib/evalkit/seededSplit.ts';
import { assertSplitIsolation, assignSplits, assignVoicePairs } from '../../src/lib/evalkit/seededSplit.ts';
import { CHECKER_VERSION } from '../../src/lib/checks/index.ts';
import { MASK_VERSION } from '../../src/lib/mask/namespace.ts';
import { PROMPT_VERSION } from '../../src/lib/prompts/version.ts';
import { sha256Hex } from '../../src/lib/text/hash.ts';
import { resultsMd } from '../../src/lib/evalkit/resultsMd.ts';
export interface Source { id: string; genre: string; path: string; good_path: string; split: Split; word_count: number; text: string; gold: GoldSpan[]; traps: string[] }
export interface Voice { id: string; path: string; word_count: number; provenance: unknown; placeholder: boolean }
export interface Manifest { version: number; freeze_date: string; reference_time: string; seeds: { split: number; pair: number; mutator: number }; sources: Source[]; voices: Voice[]; pairs: { source_id: string; voice_id: string; split: Split }[] }
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export function projectPath(path: string): string {
  const full = resolve(ROOT, path), rel = relative(ROOT, full);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('path outside project');
  return full;
}
export async function loadCorpus(): Promise<{ manifest: Manifest; manifestHash: string; voices: Map<string, string> }> {
  const raw = await readFile(projectPath('fixtures/manifest.json'), 'utf8');
  const manifest = JSON.parse(raw) as Manifest;
  if (manifest.sources.length !== 30 || manifest.voices.length !== 3) throw new Error('expected frozen 30-source/3-voice corpus');
  assertSplitIsolation(manifest.pairs);
  const expectedSplit = assignSplits(manifest.sources.map((s) => s.id), manifest.seeds.split);
  if (manifest.sources.some((s) => s.split !== expectedSplit[s.id])) throw new Error('split seed mismatch');
  const expected = assignVoicePairs(manifest.sources.map((s) => s.id), manifest.voices.map((v) => v.id), manifest.seeds.pair);
  if (expected.length !== manifest.pairs.length || expected.some((p, i) => p.source_id !== manifest.pairs[i].source_id || p.voice_id !== manifest.pairs[i].voice_id || manifest.pairs[i].split !== expectedSplit[p.source_id])) throw new Error('pair seed mismatch');
  const voices = new Map(await Promise.all(manifest.voices.map(async (v) => [v.id, await readFile(projectPath(v.path), 'utf8')] as const)));
  return { manifest, manifestHash: await sha256Hex(raw), voices };
}
export function provenance(manifest: Manifest, manifestHash: string): unknown {
  return { checker_version: CHECKER_VERSION, prompt_version: PROMPT_VERSION, mask_version: MASK_VERSION, fixture_manifest_sha256: manifestHash, fixture_version: manifest.version, seeds: manifest.seeds, freeze_date: manifest.freeze_date, thresholds: 'see frozen claim-thresholds.json', known_good: 'agent-authored' };
}
export async function writeArtifact(name: string, value: unknown, options: { exclusive?: boolean } = {}): Promise<void> {
  await mkdir(projectPath('results'), { recursive: true });
  await writeFile(projectPath(`results/${name}.json`), `${JSON.stringify(value, null, 2)}\n`, { flag: options.exclusive ? 'wx' : 'w' });
  const artifacts: Record<string, unknown> = {};
  for (const path of (await readdir(projectPath('results'))).filter((p) => /^(checks|e2e(?:-(?:mock|live))?|claims)\.json$/.test(p)).sort()) artifacts[path] = JSON.parse(await readFile(projectPath(`results/${path}`), 'utf8'));
  await writeFile(projectPath('results/results.md'), resultsMd(artifacts));
}
export function invoked(url: string): boolean { return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(url); }
