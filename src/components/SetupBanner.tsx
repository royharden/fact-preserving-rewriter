interface Props {
  mode: 'demo' | 'live'; hasConfig: boolean; ready: boolean; busy: boolean; setupMessage: string;
  onCheck: () => void; onMode: (mode: 'demo' | 'live') => void;
}
export function SetupBanner({ mode, hasConfig, ready, busy, setupMessage, onCheck, onMode }: Props) {
  return <section className="setup-banner" aria-label="Connection and mode">
    <div><span className="eyebrow">WORKSPACE MODE</span><div className="mode-buttons" role="group" aria-label="Choose workspace mode">
      <button type="button" className={mode === 'demo' ? 'mode active' : 'mode'} aria-pressed={mode === 'demo'} disabled={busy} onClick={() => onMode('demo')}>Offline Demo</button>
      <button type="button" className={mode === 'live' ? 'mode active' : 'mode'} aria-pressed={mode === 'live'} disabled={busy || !ready || !hasConfig} onClick={() => onMode('live')}>Live workspace</button>
    </div></div>
    <div className="setup-copy"><strong>{mode === 'demo' ? 'Demo mode: scripted model outputs, nothing leaves this browser.' : 'Live mode: server-checked evidence and stored rulings.'}</strong>
      <p>{setupMessage || (hasConfig ? 'Live setup has not been checked. Checking creates an anonymous session; it makes no model call.' : 'Live setup requires the two public backend connection variables.')}</p></div>
    <button type="button" className="button secondary" disabled={!hasConfig || busy} onClick={onCheck}>Check live setup</button>
  </section>;
}
