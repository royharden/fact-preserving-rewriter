import { readFile, writeFile } from 'node:fs/promises';
import { seededRandom, shuffle } from '../src/lib/evalkit/seed.ts';
import type { EvalRow } from '../src/lib/evalkit/resultsMd.ts';
import { loadCorpus, projectPath } from './eval/common.ts';
const { manifest, manifestHash } = await loadCorpus();
if (process.argv.includes('--mock') && process.argv.includes('--live')) throw new Error('choose one spotcheck evidence mode');
const mode = process.argv.includes('--live') ? 'live' : 'mock';
const evalFile = JSON.parse(await readFile(projectPath(`results/e2e-${mode}.json`), 'utf8')) as { rows: EvalRow[]; provenance: { fixture_manifest_sha256: string } };
if (evalFile.provenance.fixture_manifest_sha256 !== manifestHash) throw new Error('eval corpus mismatch');
const selected = shuffle(evalFile.rows.filter((r) => r.split === 'heldout' && r.system === 'B4' && r.final_text !== null), seededRandom(370040)).slice(0, 20);
if (selected.length !== 20) throw new Error('need20 actual heldout B4 rewrites; no fabricated review rows');
const sheet = { version: 1, seed: 370040, manifest_sha256: manifestHash, status: 'unlabelled; human review pending',
  rows: selected.map((r, index) => ({ review_id: index + 1, source_id: r.source_id, voice_id: r.voice_id, evidence: r.label, voice_placeholder: r.voice_placeholder,
    source: manifest.sources.find((s) => s.id === r.source_id)?.text, rewrite: r.final_text,
    fact_preserved: null, claims_preserved: null, style_appropriate: null, reviewer: null, notes: null })) };
await writeFile(projectPath(`results/spotcheck-${mode}.json`), `${JSON.stringify(sheet, null, 2)}\n`, { flag: 'wx' });
