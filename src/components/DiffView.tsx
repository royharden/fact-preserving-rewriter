import { useMemo } from 'react';
import { diffWordsWithSpace } from 'diff';
import type { Attempt, Run } from '../contracts/run.ts';
import { factMarks, textPieces } from '../lib/ui/review.ts';
import type { Mark } from '../lib/ui/review.ts';
function MarkedText({ text, marks }: { text: string; marks: Mark[] }) {
  return <div className="document-text">{textPieces(text, marks).map((p, i) => <span key={i} className={p.tone ? `fact-${p.tone}` : undefined} title={p.label || undefined}>{p.text}</span>)}</div>;
}
export function DiffView({ run, attempt }: { run: Run; attempt: Attempt }) {
  const view = useMemo(() => {
    try { return { marks: factMarks(run, attempt), error: null }; }
    catch { return { marks: { source: [], rewrite: [] }, error: 'Fact colouring could not be calculated. Stored flags below remain the review evidence.' }; }
  }, [run, attempt]);
  const words = useMemo(() => diffWordsWithSpace(run.sourceText, attempt.outputText ?? ''), [run.sourceText, attempt.outputText]);
  return <section aria-label="Source and rewrite comparison"><div className="legend"><span className="fact-kept">Kept fact</span><span className="fact-missing">Missing fact</span><span className="fact-added">Added fact</span></div>
    {view.error && <p className="error" role="alert">{view.error}</p>}
    <div className="comparison"><article className="document"><header><span className="eyebrow">SOURCE</span><span>Frozen original</span></header><MarkedText text={run.sourceText} marks={view.marks.source} /></article>
      <article className="document"><header><span className="eyebrow">REWRITE / ATTEMPT {attempt.ordinal}</span><span>Immutable checked text</span></header>{attempt.outputText === null ? <p className="empty">This attempt has no completed output.</p> : <MarkedText text={attempt.outputText} marks={view.marks.rewrite} />}</article></div>
    <details className="word-diff"><summary>Inspect wording changes</summary><p className="muted">Red deletions and amber additions show wording changes; fact colours above show lexical preservation checks.</p><div className="document-text">{words.map((p, i) => <span key={i} className={p.removed ? 'word-removed' : p.added ? 'word-added' : undefined}>{p.value}</span>)}</div></details>
  </section>;
}
