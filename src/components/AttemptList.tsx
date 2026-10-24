import type { Attempt } from '../contracts/run.ts';
import { readable } from '../lib/ui/review.ts';
export function AttemptList({ attempts, viewedId, selectedId, busy, onView }: { attempts: Attempt[]; viewedId: string | null; selectedId: string | null; busy: boolean; onView: (id: string) => void }) {
  return <nav className="attempt-list" aria-label="Inspect rewrite attempts">{attempts.map((a) => <button type="button" key={a.id} className={`attempt-tab ${a.id === viewedId ? 'active' : ''}`} aria-pressed={a.id === viewedId} disabled={busy} onClick={() => onView(a.id)}>
    <span>Attempt {a.ordinal}<span className={`status ${a.verdict ?? 'pending'}`}>{readable(a.verdict ?? a.state)}</span></span>
    <small>{a.id === selectedId ? 'Selected by checks' : 'Inspection only'} · {a.flags.filter((f) => f.class === 'hard').length} hard flags</small></button>)}</nav>;
}
