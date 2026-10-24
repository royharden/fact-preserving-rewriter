import { useMemo } from 'react';
import type { Attempt } from '../contracts/run.ts';
import { profile } from '../lib/style/profile.ts';
export function StylePanel({ samples, attempt }: { samples: string[]; attempt?: Attempt }) {
  const p = useMemo(() => profile(samples), [samples]);
  return <section className="style-panel" aria-labelledby="style-heading"><div><span className="eyebrow">VOICE SIGNAL</span><h3 id="style-heading">Descriptive style distance</h3><p className="muted">Descriptive, not a validated metric. Lower means closer on measured text features; it does not establish quality or factuality.</p></div>
    <div className="style-value">{attempt?.styleDistance != null ? attempt.styleDistance.toFixed(2) : '—'}<small>{attempt?.styleReason ?? p.disabledReason ?? (attempt?.styleDistance != null ? 'Mean absolute z-score; zero-variance features skipped.' : 'Available after a completed attempt.')}</small></div>
    <details><summary>Sample profile · {p.wordCount} words</summary><p className="muted">Style scoring needs at least 600 sample words. Zero-variance features are skipped. Rewriting remains available.</p><ul className="profile-features">{Object.entries(p.features).map(([name, stat]) => <li key={name}>{name.replaceAll('_', ' ')}: mean {stat.mean.toFixed(2)}, SD {stat.sd.toFixed(2)}{stat.sd === 0 ? ' · skipped' : ''}</li>)}</ul></details>
  </section>;
}
