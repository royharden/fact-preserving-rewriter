import { DEMO_SOURCES, DEMO_VOICES, DEMO_PAIRINGS } from '../lib/demo/demoData.ts';
import { utf8Bytes } from '../lib/checks/limits.ts';
interface Props {
  mode: 'demo' | 'live'; sourceId: string; voiceId: string; source: string; samples: string[];
  locked: boolean; busy: boolean; errors: string[]; note: string;
  onDemo: (id: string) => void; onVoice: (id: string) => void; onSource: (text: string) => void; onSamples: (samples: string[]) => void;
}
export function InputPanel(p: Props) {
  return <section className="panel input-panel" aria-labelledby="input-heading">
    <div className="section-heading"><div><span className="eyebrow">01 / ORIGINAL & VOICE</span><h2 id="input-heading">Give your words a new voice.</h2></div><span className="chip">Plain text · Markdown</span></div>
    <div className="input-grid"><div>
      {p.mode === 'demo' && <label htmlFor="demo-source">Scripted journey<select id="demo-source" disabled={p.locked || p.busy} value={p.sourceId} onChange={(e) => p.onDemo(e.target.value)}>{DEMO_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}
      <label htmlFor="source">Source text <span className="field-meta">{utf8Bytes(p.source).toLocaleString()} / 30,720 bytes</span></label>
      <textarea id="source" className="source-input" value={p.source} readOnly={p.locked || p.mode === 'demo'} disabled={p.busy} onChange={(e) => p.onSource(e.target.value)} spellCheck={false} aria-describedby="source-help input-errors" />
      <p id="source-help" className="muted">English plain text or Markdown. Up to 30 KB. URLs are treated as text.</p>
    </div><div>
      <label htmlFor="voice">Voice<select id="voice" disabled={p.locked || p.busy} value={p.voiceId} onChange={(e) => p.onVoice(e.target.value)}>
        {DEMO_VOICES.filter((v) => p.mode === 'live' || DEMO_PAIRINGS.some((x) => x.sourceId === p.sourceId && x.voiceId === v.id)).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        {p.mode === 'live' && <option value="custom">My own style samples</option>}
      </select></label>
      <p className="muted">{p.mode === 'demo' ? 'Only supported script pairings are available.' : 'Choose a built-in voice or provide 1–5 samples, up to 20 KB total.'}</p>
      {p.samples.map((sample, i) => <div key={i} className="sample-field"><label htmlFor={`sample-${i}`}>Style sample {i + 1}</label><textarea id={`sample-${i}`} value={sample} readOnly={p.locked || p.voiceId !== 'custom' || p.mode === 'demo'} disabled={p.busy} onChange={(e) => p.onSamples(p.samples.map((s, j) => j === i ? e.target.value : s))} />
        {p.voiceId === 'custom' && !p.locked && <button type="button" className="text-button" disabled={p.busy || p.samples.length <= 1} onClick={() => p.onSamples(p.samples.filter((_, j) => i !== j))}>Remove sample {i + 1}</button>}</div>)}
      {p.voiceId === 'custom' && !p.locked && <button type="button" className="button secondary small" disabled={p.busy || p.samples.length >= 5} onClick={() => p.onSamples([...p.samples, ''])}>Add sample</button>}
      <p className="muted">{p.samples.reduce((n, s) => n + utf8Bytes(s), 0).toLocaleString()} / 20,480 sample bytes</p>
    </div></div>
    {p.note && <p className="demo-note">{p.note}</p>}
    {p.locked && <p className="frozen-note">These inputs belong to a stored run and are frozen. Start a new draft to change them.</p>}
    <div id="input-errors" aria-live="polite">{p.errors.length > 0 && <ul className="field-errors">{p.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}</div>
  </section>;
}
