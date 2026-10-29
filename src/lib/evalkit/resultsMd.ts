import type { System } from '../../contracts/run.ts';
import type { Split } from './seededSplit.ts';
import { wilson } from './wilson.ts';
export type EvidenceMode = 'computed' | 'mock' | 'live';
export interface EvalRow {
  source_id: string; voice_id: string; split: Split; system: System; mode: EvidenceMode;
  label: string; voice_placeholder: boolean; complete: boolean; error: string | null;
  final_text: string | null; preserved: boolean; missing_facts: number; added_facts: number;
  style_delta: number | null; attempts: number; latency_ms: number; source_words: number;
  ledger_ids: string[]; reserved_micro_usd: number | null; actual_micro_usd: number | null;
  model_ids?: string[];
}
export function evidenceLabel(system: System, mode: EvidenceMode): string {
  return system === 'B0' || system === 'B1' ? 'computed, no model call' : mode === 'mock' ? 'mock (scripted outputs)' : mode === 'live' ? 'live (authenticated deployed functions)' : 'not yet measured';
}
export function validateRow(row: EvalRow): void {
  if (row.label !== evidenceLabel(row.system, row.mode)) throw new Error('evidence label mismatch');
  if (row.mode === 'computed' && row.system !== 'B0' && row.system !== 'B1') throw new Error('model systems cannot be labelled computed');
  if (row.mode === 'live' && row.system !== 'B0' && row.system !== 'B1') {
    if (row.ledger_ids.length === 0 || row.ledger_ids.some((id) => !id.trim())) throw new Error('live model row requires call_ledger ids');
    if (!row.model_ids?.length || row.model_ids.some((id) => !id.trim())) throw new Error('live model row requires ledger model ids');
  }
  if (!row.complete && row.preserved) throw new Error('incomplete run cannot count as preserved');
  if (row.actual_micro_usd !== null && row.actual_micro_usd < 0) throw new Error('negative cost');
}
const mean = (xs: readonly number[]): number | null => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
export function summarizeRows(rows: readonly EvalRow[]): unknown[] {
  rows.forEach(validateRow);
  const keys = [...new Set(rows.map((r) => `${r.system}|${r.mode}|${r.split}`))];
  return keys.map((key) => {
    const group = rows.filter((r) => `${r.system}|${r.mode}|${r.split}` === key);
    const sourceIds = [...new Set(group.map((r) => r.source_id))];
    const clusters = sourceIds.map((source_id) => {
      const cluster = group.filter((r) => r.source_id === source_id);
      return { source_id, pairs: cluster.length, preservation_rate: cluster.filter((r) => r.preserved).length / cluster.length };
    });
    const totalWords = group.reduce((n, r) => n + r.source_words, 0);
    const sumCost = (field: 'reserved_micro_usd' | 'actual_micro_usd'): number | null => group.some((r) => r[field] === null) ? null : group.reduce((n, r) => n + (r[field] ?? 0), 0);
    const normalized = (value: number | null): number | null => value === null || totalWords === 0 ? null : value / 1_000_000 * 1000 / totalWords;
    return { key, label: group[0].label, pairs: group.length, incomplete: group.filter((r) => !r.complete).length,
      fact_preservation: wilson(group.filter((r) => r.preserved).length, group.length),
      source_clusters: clusters, source_cluster_count: clusters.length, source_cluster_mean: mean(clusters.map((r) => r.preservation_rate)),
      mean_facts_lost: mean(group.map((r) => r.missing_facts)), mean_added_facts: mean(group.map((r) => r.added_facts)),
      mean_style_delta: mean(group.flatMap((r) => r.style_delta === null ? [] : [r.style_delta])), style_measured: group.filter((r) => r.style_delta !== null).length,
      mean_attempts: mean(group.map((r) => r.attempts)), mean_latency_ms: mean(group.map((r) => r.latency_ms)),
      reserved_usd_per_1000_source_words: normalized(sumCost('reserved_micro_usd')), actual_usd_per_1000_source_words: normalized(sumCost('actual_micro_usd')),
      mean_reserved_usd_per_run: sumCost('reserved_micro_usd') === null ? null : (sumCost('reserved_micro_usd') as number) / 1_000_000 / group.length,
      mean_actual_usd_per_run: sumCost('actual_micro_usd') === null ? null : (sumCost('actual_micro_usd') as number) / 1_000_000 / group.length,
      voice_placeholder_pairs: group.filter((r) => r.voice_placeholder).length };
  });
}
export function resultsMd(artifacts: Record<string, unknown>): string {
  return '# Computed evaluation artifacts\n\n' +
    'Live model results: not yet measured unless live ledger-backed rows are present below. Mock rows are mock (scripted outputs). B0/B1 are computed, no model call. Placeholder voices are labelled per row.\n\n' +
    'Pair-level Wilson intervals are descriptive: two voices share each source. Compare source-cluster summaries beside them; separated intervals do not prove superiority. Failures remain in denominators; incomplete live runs are never extrapolated. Style distance is descriptive. Known-good references are agent-authored, not human-validated. Jev: not evaluated.\n\n' +
    Object.entries(artifacts).map(([name, value]) => `## ${name}\n\n\x60\x60\x60json\n${JSON.stringify(value, null, 2)}\n\x60\x60\x60\n`).join('\n');
}
