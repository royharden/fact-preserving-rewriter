import { readFile } from 'node:fs/promises';
import { extract } from '../../src/lib/factledger/extract.ts';
import { checkAttempt } from '../../src/lib/checks/index.ts';
import { factKey } from '../../src/lib/factledger/normalise.ts';
import { buildClaimPairs } from '../../src/lib/claims/align.ts';
import { judgeOverlap } from '../../src/lib/claims/overlap.ts';
import { wilson } from '../../src/lib/evalkit/wilson.ts';
import { mutate, MUTATION_TYPES } from '../../src/lib/mutators/index.ts';
import type { FactKind } from '../../src/lib/factledger/types.ts';
import { frozenThreshold } from './claims.ts';
import { invoked, loadCorpus, projectPath, provenance, writeArtifact } from './common.ts';
export async function runChecks(): Promise<void> {
  const { manifest, manifestHash } = await loadCorpus();
  const threshold = await frozenThreshold(manifest, manifestHash);
  const extraction = [], mutations = [], good = [];
  for (const [sourceIndex, source] of manifest.sources.entries()) {
    const referenceTime = new Date(manifest.reference_time);
    const ledger = extract(source.text, { referenceTime });
    for (const kind of ['number', 'date', 'entity', 'quote', 'verbatim'] as FactKind[]) {
      const predicted = ledger.filter((f) => f.kind === kind), gold = source.gold.filter((f) => f.kind === kind);
      const tp = predicted.filter((f) => gold.some((g) => g.start === f.start && g.end === f.end && g.raw === f.raw)).length;
      extraction.push({ source_id: source.id, split: source.split, kind, tp, predicted: predicted.length, gold: gold.length });
    }
    const ctx = { sourceText: source.text, ledger, samples: [], referenceTime, maskNamespace: null };
    const checkedGood = checkAttempt(ctx, await readFile(projectPath(source.good_path), 'utf8'));
    good.push({ source_id: source.id, split: source.split, hard_fail: checkedGood.flags.some((f) => f.class === 'hard'), flags: checkedGood.flags });
    for (const [typeIndex, type] of MUTATION_TYPES.entries()) {
      const generated = mutate(type, source.text, source.gold, manifest.seeds.mutator + sourceIndex * 10 + typeIndex);
      if (!generated.mutation) { mutations.push({ source_id: source.id, split: source.split, type, applicable: false, rejection: generated.rejected, hard: false, code: false, code_overlap: false, code_overlap_llm: null }); continue; }
      const check = checkAttempt(ctx, generated.mutation.text);
      const hard = check.flags.some((f) => f.class === 'hard');
      const code = check.flags.some((f) => f.class === 'hard' || f.class === 'soft');
      const sourceKeys = new Set(ledger.map(factKey));
      const strictAdded = check.rewriteLedger.filter((f) => ['number', 'date', 'entity'].includes(f.kind) && !sourceKeys.has(factKey(f)));
      const reportedAdded = new Set(check.flags.filter((f) => f.code === 'added_fact').map((f) => `${f.rewriteSpan?.start}:${f.rewriteSpan?.end}`));
      const suppressedAdded = strictAdded.filter((f) => !reportedAdded.has(`${f.start}:${f.end}`));
      const claimPairs = buildClaimPairs(source.text, ledger, check.text, check.rewriteLedger);
      const overlap = judgeOverlap(claimPairs, { supportMin: threshold.support_min, minContentWords: threshold.min_content_words }).length > 0;
      mutations.push({ source_id: source.id, split: source.split, type, applicable: true, mutation: generated.mutation, flags: check.flags, hard, code, code_overlap: code || overlap, overlap_increment: !code && overlap, code_overlap_llm: null, whole_token_exemption_suppressed_facts: suppressedAdded, code_recall_lost_to_exemption: !code && suppressedAdded.length > 0 });
    }
  }
  const extractor = ['dev', 'heldout'].flatMap((split) => ['number', 'date', 'entity', 'quote', 'verbatim'].map((kind) => {
    const selected = extraction.filter((r) => r.split === split && r.kind === kind);
    const tp = selected.reduce((n, r) => n + r.tp, 0), predicted = selected.reduce((n, r) => n + r.predicted, 0), gold = selected.reduce((n, r) => n + r.gold, 0);
    return { split, kind, tp, predicted, gold, precision: wilson(tp, predicted), recall: wilson(tp, gold), matching: 'exact kind + UTF16 span + raw; gold is annotation, not extractor output' };
  }));
  const recall = ['dev', 'heldout'].flatMap((split) => MUTATION_TYPES.map((type) => {
    const selected = mutations.filter((r) => r.split === split && r.type === type && r.applicable);
    return { split, type, generated: selected.length, rejected: mutations.filter((r) => r.split === split && r.type === type && !r.applicable).length,
      hard_only: wilson(selected.filter((r) => r.hard).length, selected.length), hard_soft: wilson(selected.filter((r) => r.code).length, selected.length),
      soft_additional_detections: selected.filter((r) => !r.hard && r.code).length,
      code_only: wilson(selected.filter((r) => r.code).length, selected.length), code_overlap: wilson(selected.filter((r) => r.code_overlap).length, selected.length), overlap_additional_detections: selected.filter((r) => !r.code && r.code_overlap).length, code_overlap_llm: null, llm_status: 'not yet measured' };
  }));
  const dev = good.filter((r) => r.split === 'dev');
  const falseHard = wilson(dev.filter((r) => r.hard_fail).length, dev.length);
  const falseHardBySplit = ['dev', 'heldout'].map((split) => { const selected = good.filter((r) => r.split === split); return { split, interval: wilson(selected.filter((r) => r.hard_fail).length, selected.length) }; });
  const devGate = { false_hard_fail: falseHard, limit: 0.1, passed: falseHard.rate !== null && falseHard.rate <= 0.1, superiority_claim_allowed: falseHard.rate !== null && falseHard.rate <= 0.1, caveat: 'passing gate alone proves no superiority; extractor/checker circularity and agent-authored gold remain' };
  await writeArtifact('checks', { provenance: provenance(manifest, manifestHash), label: 'computed, no model call', dev_gate: devGate, extractor, recall, false_hard_fail: falseHardBySplit, known_good: good, mutations, unmeasured_llm: true, whole_token_exemption_recall_cost: { lost_detections: mutations.filter((r) => 'code_recall_lost_to_exemption' in r && r.code_recall_lost_to_exemption).length, denominator: mutations.filter((r) => r.applicable).length, definition: 'strict normalised added-fact candidate suppressed by whole-token exemption, with no other code flag' }, named_misses: mutations.filter((r) => r.applicable && !r.code_overlap).map((r) => ({ source_id: r.source_id, type: r.type })) });
}
if (invoked(import.meta.url)) await runChecks();
