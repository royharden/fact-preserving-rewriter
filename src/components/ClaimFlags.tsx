import type { Attempt, Run } from '../contracts/run.ts';
import { renderRepairRequest } from '../lib/loop/repairRequest.ts';
import { readable } from '../lib/ui/review.ts';
export function ClaimFlags({ run, attempt }: { run: Run; attempt: Attempt }) {
  return <section className="panel" aria-labelledby="flags-heading"><div className="section-heading"><div><span className="eyebrow">EVIDENCE / ATTEMPT {attempt.ordinal}</span><h2 id="flags-heading">What needs your attention</h2></div><span className="chip">{attempt.flags.length} flags</span></div>
    <p className="muted">{attempt.judgeCoverage ? `Judged ${attempt.judgeCoverage.judged} of ${attempt.judgeCoverage.total} sentence pairs. ` : 'LLM sentence-pair coverage is not recorded. '}{readable(attempt.claimStatus ?? 'not judged')}. Overlap checks are lexical signals with uncalibrated thresholds; they do not prove entailment.</p>
    {attempt.flags.length === 0 && <p className="empty">No flags were emitted. Review the text before recording a ruling.</p>}
    <div className="flag-list">{attempt.flags.map((f) => <article key={f.id} className={`flag flag-${f.class}`}><div className="flag-title"><span className="fact-id">{f.id}</span><strong>{readable(f.code)}</strong><span className="chip">{f.class}{f.factId ? ` · ${f.factId}` : ''}{f.pairId ? ` · ${f.pairId}` : ''}</span></div><p>{f.found}</p>
      {f.evidence && <blockquote>{f.evidence}</blockquote>}
      {f.sourceSpan && <p className="evidence-slice"><strong>Source [{f.sourceSpan.start}–{f.sourceSpan.end}]</strong> “{run.sourceText.slice(f.sourceSpan.start, f.sourceSpan.end)}”</p>}
      {f.rewriteSpan && <p className="evidence-slice"><strong>Rewrite [{f.rewriteSpan.start}–{f.rewriteSpan.end}]</strong> “{attempt.outputText?.slice(f.rewriteSpan.start, f.rewriteSpan.end)}”</p>}</article>)}</div>
    {attempt.repairRequest && <details><summary>Code-written repair request sent for this attempt</summary><pre className="repair-request">{renderRepairRequest(attempt.repairRequest)}</pre></details>}
    {attempt.error && <p className="error" role="alert">{attempt.error}</p>}
  </section>;
}
