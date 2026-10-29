import type { Fact, Toggle } from '../lib/factledger/types.ts';
interface Props { facts: Fact[]; evidenceFrozen: boolean; frozen: boolean; busy: boolean; terms: string; aliases: string; error: string | null;
  suggestion?: string; onTerms: (s: string) => void; onAliases: (s: string) => void; onToggle: (id: string, toggle: Toggle) => void; }
export function LedgerPanel(p: Props) {
  return <section className="panel" aria-labelledby="ledger-heading"><div className="section-heading"><div><span className="eyebrow">02 / PRESERVATION RULES</span><h2 id="ledger-heading">The fact ledger</h2></div><span className="chip">{p.evidenceFrozen ? 'Frozen evidence' : 'Preview · browser clock'}</span></div>
    <p className="muted">Numbers, dates, entities, quotes and identifiers. Ignoring a fact exempts its presence only; added facts are still checked. This checks preservation of the source, not real-world truth or relationships between facts.</p>
    <div className="input-grid compact"><label htmlFor="protected-terms">Protected terms <span className="muted">one per line</span><textarea id="protected-terms" rows={2} value={p.terms} readOnly={p.frozen} disabled={p.busy} onChange={(e) => p.onTerms(e.target.value)} placeholder="A product or a name to preserve" /></label>
      <label htmlFor="aliases">Explicit aliases <span className="muted">term = alias | alias</span><textarea id="aliases" rows={2} value={p.aliases} readOnly={p.frozen} disabled={p.busy} onChange={(e) => p.onAliases(e.target.value)} placeholder="Northwind Payments = Northwind" /></label></div>
    {p.error && <p className="error" role="alert">{p.error}</p>}
    {p.suggestion && !p.frozen && <p className="demo-note">Demo step: find “{p.suggestion}” and switch Required off to reach the scripted second-attempt review.</p>}
    <div className="ledger-scroll"><table><caption className="sr-only">Extracted facts and required toggles</caption><thead><tr><th>Fact</th><th>Original</th><th>Normalised value</th><th>Required</th></tr></thead><tbody>{p.facts.map((f) => <tr key={f.id}><td><span className="fact-id">{f.id}</span><span className="kind">{f.kind}</span></td><td>{f.raw}</td><td className="normalised">{f.normalised}</td><td><input type="checkbox" aria-label={`Require ${f.id}: ${f.raw}`} checked={f.required} disabled={p.frozen || p.busy} onChange={(e) => p.onToggle(f.id, e.target.checked ? 'required' : 'ignored')} /></td></tr>)}</tbody></table></div>
    {p.facts.length === 0 && <p className="empty">No facts extracted yet. Add source text to preview the ledger.</p>}
  </section>;
}
