import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { buildManifest, fixturePath, fixtureText, parseGoldMarkup, readManifest, ROOT, sharedEightWordRuns } from '../../../scripts/build-fixtures.ts';
import { assignSplits, assignVoicePairs } from '../../../src/lib/evalkit/seededSplit.ts';
import { normalisedWords, wordTokens } from '../../../src/lib/text/tokens.ts';
import { MockRecordingMissing, ScriptedRewriter, scriptKeyString } from '../../../src/lib/providers/mock.ts';
import type { ScriptsTable } from '../../../src/lib/providers/mock.ts';

describe('frozen authored corpus', () => {
  it('rebuilds annotation truth byte-for-byte without asking the extractor to define gold', async () => {
    const stored = await readManifest();
    expect(await buildManifest()).toEqual(stored);
    expect(stored.freeze_date).toBe('2026-10-24');
    expect(stored.sources).toHaveLength(30);
    expect(new Set(stored.sources.map((s) => s.text)).size).toBe(30);
    for (const genre of ['status-update', 'incident-note', 'press-release']) expect(stored.sources.filter((s) => s.genre === genre)).toHaveLength(10);
    for (const source of [...stored.sources, ...stored.injected]) {
      expect(parseGoldMarkup(await fixtureText(ROOT, source.path))).toEqual({ text: source.text, gold: source.gold });
      expect(wordTokens(source.text).length).toBe(source.word_count);
      expect(source.word_count).toBeGreaterThanOrEqual(80);
      expect(source.word_count).toBeLessThanOrEqual(250);
      expect(new Set(source.gold.map((f) => f.kind)).size).toBe(5);
      let previousEnd = 0;
      for (const fact of source.gold) {
        expect(fact.start).toBeGreaterThanOrEqual(previousEnd);
        expect(source.text.slice(fact.start, fact.end)).toBe(fact.raw);
        previousEnd = fact.end;
      }
      const good = await fixtureText(ROOT, source.good_path);
      expect(source.good_authorship).toBe('agent-authored substantive paraphrase');
      expect(good).not.toBe(source.text);
      expect(wordTokens(good).length).toBe(source.good_word_count);
      expect(normalisedWords(good).join(' ')).not.toBe(normalisedWords(source.text).join(' '));
      for (const fact of source.gold.filter((f) => ['quote', 'verbatim'].includes(f.kind))) expect(good).toContain(fact.raw);
    }
  });

  it('pins source isolation and seeded voice pairing independently of file enumeration order', async () => {
    const m = await readManifest(), ids = m.sources.map((s) => s.id);
    const split = assignSplits(ids, m.seeds.split), reverseSplit = assignSplits([...ids].reverse(), m.seeds.split);
    expect(split).toEqual(reverseSplit);
    expect(m.sources.filter((s) => s.split === 'dev')).toHaveLength(10);
    expect(m.sources.filter((s) => s.split === 'heldout')).toHaveLength(20);
    expect(m.pairs.filter((p) => p.split === 'dev')).toHaveLength(20);
    expect(m.pairs.filter((p) => p.split === 'heldout')).toHaveLength(40);
    expect(m.pairs.map(({ source_id, voice_id }) => ({ source_id, voice_id }))).toEqual(assignVoicePairs([...ids].reverse(), m.voices.map((v) => v.id).reverse(), m.seeds.pair));
    for (const source of m.sources) {
      expect(source.split).toBe(split[source.id]);
      expect(new Set(m.pairs.filter((p) => p.source_id === source.id).map((p) => p.voice_id)).size).toBe(2);
    }
    for (const source of m.injected) expect(ids).not.toContain(source.id);
  });

  it('keeps sufficiently long voice prose disjoint from every source and labels the placeholder honestly', async () => {
    const m = await readManifest();
    for (const voice of m.voices) {
      const text = await fixtureText(ROOT, voice.path);
      expect(wordTokens(text).length).toBe(voice.word_count);
      expect(voice.word_count).toBeGreaterThanOrEqual(600);
      for (const source of [...m.sources, ...m.injected]) expect(sharedEightWordRuns(text, source.text)).toEqual([]);
    }
    const placeholder = m.voices.filter((v) => v.placeholder);
    expect(placeholder).toHaveLength(1);
    expect(placeholder[0].provenance).toContain('PLACEHOLDER — not Gutenberg');
    expect(await fixtureText(ROOT, placeholder[0].path)).toContain('PLACEHOLDER — not Gutenberg');
  });

  it('covers every promised trap with authored text, not a claimed extractor result', async () => {
    const m = await readManifest(), text = m.sources.map((s) => s.text).join('\n');
    for (const trap of ['$1.2M', '5 to 7', 'ABC-1234', 'v2.3.1', 'next Friday', '50 per cent', 'twelve', 'iPhone', 'Dr.', 'API', 'half a million', 'half of the invoices', 'a half remaining', '03/04', 'UTC', '🧭']) expect(text).toContain(trap);
    expect(m.sources.find((s) => s.id === 'incident-note-09')!.gold.filter((f) => f.raw === '4')).toHaveLength(2);
  });
});

describe('annotation parser boundary cases', () => {
  it('counts offsets in UTF16 and distinguishes repeated facts', () => {
    const parsed = parseGoldMarkup('🧭 [[n:12]] then [[n:12]], [[q:“Leave it.”]]');
    expect(parsed.gold[0]).toMatchObject({ id: 'N1', start: 3, end: 5, raw: '12' });
    expect(parsed.gold[1]).toMatchObject({ id: 'N2', start: 11, end: 13 });
    for (const fact of parsed.gold) expect(parsed.text.slice(fact.start, fact.end)).toBe(fact.raw);
  });
  it.each(['[[n:]]', '[[z:12]]', '[[n:12', '[[q:outer [[n:12]]]]'])('refuses malformed markup %s', (text) => {
    expect(() => parseGoldMarkup(text)).toThrow('malformed');
  });
  it('uses the same case/punctuation normalization as the copy check', () => {
    expect(sharedEightWordRuns('A, small table can make a room feel warmer.', 'a small table can make a room feel warmer')).toContain('a small table can make a room feel');
  });
});

describe('explicit scripted coverage', () => {
  it('contains all model phases and retry slots for every pair and rejects misses', async () => {
    const m = await readManifest();
    const table = JSON.parse(await readFile(fixturePath(ROOT, 'fixtures/mock/scripts.json'), 'utf8')) as ScriptsTable;
    const provider = new ScriptedRewriter(table), keys = new Set<string>();
    for (const row of table.entries) {
      const key = scriptKeyString({ system: row.system, sourceId: row.source_id, voiceId: row.voice_id, attempt: row.attempt, phase: row.phase });
      expect(keys.has(key)).toBe(false); keys.add(key);
      expect([row.output !== undefined, row.raw !== undefined, row.error !== undefined].filter(Boolean)).toHaveLength(1);
      if (row.phase === 'b3_check') expect(row.output).toEqual({ issues: [] });
      else expect(row.output).toHaveProperty('rewrite');
    }
    for (const pair of m.pairs) {
      for (const [system, attempt, phase] of [['B2', 1, 'rewrite'], ['B3', 1, 'rewrite'], ['B3', 1, 'b3_check'], ['B3', 1, 'b3_revise'], ['B4', 1, 'rewrite'], ['B4', 2, 'rewrite'], ['B4', 3, 'rewrite']] as const) {
        expect(provider.has({ system, sourceId: pair.source_id, voiceId: pair.voice_id, attempt, phase })).toBe(true);
      }
    }
    await expect(provider.call({ key: { system: 'B4', sourceId: 'absent', voiceId: 'absent', attempt: 1, phase: 'rewrite' }, namespace: 'abc123', messages: { system: '', user: '' }, model: 'mock-scripted' })).rejects.toBeInstanceOf(MockRecordingMissing);
  });
});
