/** Strip authored gold markup and reproduce the frozen manifest. Execution is deferred in Dirty Mode. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wordTokens, normalisedWords } from '../src/lib/text/tokens.ts';
import { assignSplits, assignVoicePairs } from '../src/lib/evalkit/seededSplit.ts';
import type { FactKind } from '../src/lib/factledger/types.ts';

export interface GoldFact { id: string; kind: FactKind; raw: string; start: number; end: number; required: boolean }
export interface SourceDescriptor { id: string; genre: string; path: string; good_path: string; traps: string[] }
export interface VoiceDescriptor { id: string; path: string; provenance: string; placeholder: boolean }
export interface CorpusSource extends SourceDescriptor {
  split: 'dev' | 'heldout' | 'excluded'; word_count: number; text: string; gold: GoldFact[];
  good_authorship: string; good_word_count: number;
}
export interface CorpusVoice extends VoiceDescriptor { word_count: number }
export interface Catalog {
  version: 1; freeze_date: string; reference_time: string;
  seeds: { split: number; pair: number; mutator: number };
  sources: SourceDescriptor[]; voices: VoiceDescriptor[]; injected: SourceDescriptor[];
  authorship: Record<string, string>; validation: Record<string, unknown>;
}
export interface CorpusManifest extends Omit<Catalog, 'sources' | 'voices' | 'injected'> {
  sources: CorpusSource[]; voices: CorpusVoice[]; injected: CorpusSource[];
  pairs: { source_id: string; voice_id: string; split: 'dev' | 'heldout' }[];
}
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const KINDS: Record<string, FactKind> = { n: 'number', d: 'date', e: 'entity', q: 'quote', v: 'verbatim' };

/** Offsets are accumulated while stripping, so repeated raw strings and emoji remain unambiguous. */
export function parseGoldMarkup(markup: string): { text: string; gold: GoldFact[] } {
  let text = '', cursor = 0;
  const gold: GoldFact[] = [], counters: Record<string, number> = {};
  for (const m of markup.matchAll(/\[\[([ndeqv]):([^\[\]]+)\]\]/g)) {
    text += markup.slice(cursor, m.index);
    const start = text.length, tag = m[1], raw = m[2];
    text += raw;
    const prefix = tag.toUpperCase();
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    gold.push({ id: `${prefix}${counters[prefix]}`, kind: KINDS[tag], raw, start, end: text.length, required: true });
    cursor = m.index + m[0].length;
  }
  text += markup.slice(cursor);
  if (text.includes('[[') || text.includes(']]')) throw new Error('malformed or nested gold markup');
  return { text, gold };
}

export function fixturePath(root: string, path: string): string {
  const full = resolve(root, path), rel = relative(root, full);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('fixture path outside project');
  return full;
}
export async function fixtureText(root: string, path: string): Promise<string> {
  return (await readFile(fixturePath(root, path), 'utf8')).trimEnd();
}
export function eightWordRuns(text: string): Set<string> {
  const words = normalisedWords(text), out = new Set<string>();
  for (let i = 0; i + 8 <= words.length; i++) out.add(words.slice(i, i + 8).join(' '));
  return out;
}
export function sharedEightWordRuns(a: string, b: string): string[] {
  const right = eightWordRuns(b);
  return [...eightWordRuns(a)].filter((run) => right.has(run));
}

export async function buildManifest(root = ROOT): Promise<CorpusManifest> {
  const catalog = JSON.parse(await readFile(fixturePath(root, 'fixtures/catalog.json'), 'utf8')) as Catalog;
  if (catalog.version !== 1 || catalog.freeze_date !== '2026-10-24' || catalog.sources.length !== 30 || catalog.voices.length !== 3) throw new Error('invalid frozen catalog');
  if (new Set(catalog.sources.map((s) => s.id)).size !== 30) throw new Error('duplicate source id');
  if (new Set([...catalog.sources, ...catalog.injected].map((s) => s.id)).size !== 30 + catalog.injected.length) throw new Error('injected id overlaps corpus');
  const splits = assignSplits(catalog.sources.map((s) => s.id), catalog.seeds.split);
  async function source(s: SourceDescriptor, excluded = false): Promise<CorpusSource> {
    const parsed = parseGoldMarkup(await fixtureText(root, s.path));
    const split = excluded ? 'excluded' : splits[s.id];
    const word_count = wordTokens(parsed.text).length;
    if (!excluded && (word_count < 80 || word_count > 250)) throw new Error(`source outside 80..250 words: ${s.id}`);
    if (!excluded && s.path !== `fixtures/sources/${split}/${s.id}.src.md`) throw new Error(`source path contradicts seeded split: ${s.id}`);
    if (new Set(parsed.gold.map((g) => g.kind)).size !== 5) throw new Error(`all five gold kinds required: ${s.id}`);
    for (const f of parsed.gold) if (parsed.text.slice(f.start, f.end) !== f.raw) throw new Error(`gold span mismatch: ${s.id}/${f.id}`);
    const good = await fixtureText(root, s.good_path);
    if (good === parsed.text || wordTokens(good).length < 50) throw new Error(`substantive authored paraphrase required: ${s.id}`);
    for (const f of parsed.gold.filter((f) => f.kind === 'quote' || f.kind === 'verbatim')) if (!good.includes(f.raw)) throw new Error(`good text loses protected fact: ${s.id}/${f.id}`);
    return { ...s, split, word_count, ...parsed, good_authorship: 'agent-authored substantive paraphrase', good_word_count: wordTokens(good).length };
  }
  const sources = await Promise.all(catalog.sources.map((s) => source(s)));
  const injected = await Promise.all(catalog.injected.map((s) => source(s, true)));
  const genre_counts = Object.fromEntries(['status-update', 'incident-note', 'press-release'].map((g) => [g, sources.filter((s) => s.genre === g).length]));
  if (Object.values(genre_counts).some((n) => n !== 10)) throw new Error('ten sources per genre required');
  const voices = await Promise.all(catalog.voices.map(async (v): Promise<CorpusVoice> => {
    const sample = await fixtureText(root, v.path), word_count = wordTokens(sample).length;
    if (word_count < 600) throw new Error(`voice below 600 words: ${v.id}`);
    if (v.placeholder && (!v.provenance.includes('PLACEHOLDER') || !sample.includes('not Gutenberg'))) throw new Error('placeholder provenance missing');
    for (const s of [...sources, ...injected]) if (sharedEightWordRuns(sample, s.text).length) throw new Error(`voice overlaps source: ${v.id}/${s.id}`);
    return { ...v, word_count };
  }));
  const pairs = assignVoicePairs(sources.map((s) => s.id), voices.map((v) => v.id), catalog.seeds.pair).map((p) => ({ ...p, split: splits[p.source_id] }));
  return { ...catalog, sources, voices, pairs, injected, validation: {
    ...catalog.validation, source_count: 30, genre_counts,
    source_word_range: [Math.min(...sources.map((s) => s.word_count)), Math.max(...sources.map((s) => s.word_count))],
    voice_source_8word_overlap_count: 0, utf16_span_roundtrip: true,
    dev_sources: 10, heldout_sources: 20, dev_pairs: 20, heldout_pairs: 40,
  } };
}
export async function readManifest(root = ROOT): Promise<CorpusManifest> {
  return JSON.parse(await readFile(fixturePath(root, 'fixtures/manifest.json'), 'utf8')) as CorpusManifest;
}
export async function buildFixtures(root = ROOT): Promise<void> {
  const manifest = await buildManifest(root);
  await writeFile(fixturePath(root, 'fixtures/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildFixtures();
