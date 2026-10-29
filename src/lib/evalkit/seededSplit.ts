import { seededRandom, shuffle } from './seed.ts';
export type Split = 'dev' | 'heldout';
function unique(ids: readonly string[]): string[] {
  if (new Set(ids).size !== ids.length) throw new Error('duplicate ids');
  return [...ids].sort();
}
export function assignSplits(ids: readonly string[], seed = 370037, devCount = 10): Record<string, Split> {
  if (!Number.isInteger(devCount) || devCount < 0 || devCount > ids.length) throw new Error('invalid dev count');
  const dev = new Set(shuffle(unique(ids), seededRandom(seed)).slice(0, devCount));
  return Object.fromEntries(ids.map((id) => [id, dev.has(id) ? 'dev' : 'heldout']));
}
export function assignVoicePairs(sourceIds: readonly string[], voiceIds: readonly string[], seed = 370038): { source_id: string; voice_id: string }[] {
  const voices = unique(voiceIds);
  if (voices.length < 2) throw new Error('at least two voices required');
  const random = seededRandom(seed);
  return unique(sourceIds).flatMap((source_id) => shuffle(voices, random).slice(0, 2).map((voice_id) => ({ source_id, voice_id })));
}
export function assertSplitIsolation(rows: readonly { source_id: string; split: Split }[]): void {
  const seen = new Map<string, Split>();
  for (const row of rows) {
    if (seen.has(row.source_id) && seen.get(row.source_id) !== row.split) throw new Error(`source split leakage: ${row.source_id}`);
    seen.set(row.source_id, row.split);
  }
}
