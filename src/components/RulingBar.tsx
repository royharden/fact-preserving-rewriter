import { useState } from 'react';
import type { Attempt, Decision, Ruling, Run } from '../contracts/run.ts';
import { acknowledgeableFlagIds } from '../lib/rulings/gate.ts';
import { readable } from '../lib/ui/review.ts';
interface Props { run: Run; attempt: Attempt; rulings: Ruling[]; busy: boolean; onRule: (decision: Decision, reason: string, acks: string[]) => void }
/** Parent keys this form by exact run/attempt/hash/evidence edition, so acknowledgements never cross content. */
export function RulingBar({ run, attempt, rulings, busy, onRule }: Props) {
  const [acks, setAcks] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const required = acknowledgeableFlagIds(attempt.flags);
  const eligible = run.status === 'review_ready' && run.selectedAttemptId === attempt.id && attempt.state === 'complete' && !!attempt.contentHash && !!attempt.verdict;
  const latest = rulings.filter((r) => r.attemptId === attempt.id && r.contentHash === attempt.contentHash && r.evidenceVersion === run.evidenceVersion).at(-1);
  return <section className="panel ruling-panel" aria-labelledby="ruling-heading"><div className="section-heading"><div><span className="eyebrow">03 / HUMAN DECISION</span><h2 id="ruling-heading">Record your ruling</h2></div>{latest && <span className={`status ${latest.decision === 'reject' ? 'failed' : 'pass'}`}>{latest.decision} · {latest.localDemo ? 'local demo record' : 'server record'}</span>}</div>
    {!eligible && <p className="frozen-note">Rulings are available only for the selected completed attempt, after evidence is review ready.</p>}
    {attempt.verdict === 'failed' ? <p className="error">Hard preservation checks failed. Approval is disabled. An override requires a typed explanation of at least 10 characters.</p> : <div className="ack-list">{required.map((id) => { const f = attempt.flags.find((x) => x.id === id)!; return <label key={id}><input type="checkbox" disabled={busy || !eligible} checked={acks.includes(id)} onChange={(e) => setAcks(e.target.checked ? [...acks, id] : acks.filter((a) => a !== id))} /><span>I reviewed {id}: {readable(f.code)} — {f.found}</span></label>; })}</div>}
    <label htmlFor="ruling-reason">{attempt.verdict === 'failed' ? 'Override explanation (required)' : 'Review note (optional)'}<textarea id="ruling-reason" rows={2} disabled={busy || !eligible} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    <div className="actions"><button type="button" className="button primary" disabled={busy || !eligible || attempt.verdict === 'failed' || required.some((id) => !acks.includes(id))} onClick={() => onRule('approve', reason, acks)}>Approve exact text</button>
      {attempt.verdict === 'failed' && <button type="button" className="button warning" disabled={busy || !eligible || reason.trim().length < 10} onClick={() => onRule('override', reason, [])}>Override with reason</button>}
      <button type="button" className="button secondary" disabled={busy || !eligible} onClick={() => onRule('reject', reason, [])}>Reject / revoke export</button></div>
    {latest?.reason && <p className="muted">Last recorded reason: {latest.reason}</p>}
    <p className="muted">This decision is bound to the exact content hash and evidence version. A later rejection revokes export.</p>
  </section>;
}
