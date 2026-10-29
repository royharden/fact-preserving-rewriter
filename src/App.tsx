import { useEffect, useMemo, useRef, useState } from 'react';
import type { Attempt, Decision, Run } from './contracts/run.ts';
import { validateInputs } from './lib/checks/limits.ts';
import { DEMO_IGNORE_SUGGESTION, DEMO_PAIRINGS, DEMO_REFERENCE_TIME, DEMO_SOURCES, DEMO_VOICES, demoSource, demoVoice } from './lib/demo/demoData.ts';
import { demoDeps, demoRunSpec, runOnStore } from './lib/demo/runLocal.ts';
import { extract } from './lib/factledger/index.ts';
import type { Toggle } from './lib/factledger/types.ts';
import type { RecordingsFile } from './lib/providers/mock.ts';
import { createLocalStore } from './lib/store/localStore.ts';
import type { RunBundle, Store } from './lib/store/types.ts';
import type { SupabaseStore } from './lib/store/supabaseStore.ts';
import { sha256Hex } from './lib/text/hash.ts';
import { evidenceKey, parseAliases, readable } from './lib/ui/review.ts';
import { SetupBanner } from './components/SetupBanner.tsx';
import { ProviderWarning } from './components/ProviderWarning.tsx';
import { InputPanel } from './components/InputPanel.tsx';
import { LedgerPanel } from './components/LedgerPanel.tsx';
import { AttemptList } from './components/AttemptList.tsx';
import { DiffView } from './components/DiffView.tsx';
import { ClaimFlags } from './components/ClaimFlags.tsx';
import { StylePanel } from './components/StylePanel.tsx';
import { RulingBar } from './components/RulingBar.tsx';
import { ExportBar } from './components/ExportBar.tsx';
import { DeleteMyData } from './components/DeleteMyData.tsx';

// An absent generated recordings file is a valid build input. The global MOCK_SOURCE still owns selection;
// demoDeps throws loudly if recordings are selected later without a matching bundled file. No fallback.
const recordingFiles = import.meta.glob<RecordingsFile>('../fixtures/mock/recordings.json', { eager: true, import: 'default' });
const recordings = recordingFiles['../fixtures/mock/recordings.json'];
const HAS_PUBLIC_CONFIG = !!import.meta.env.VITE_SUPABASE_URL?.trim() && !!import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const messageOf = (error: unknown): string => error instanceof Error ? error.message : 'An unexpected operation failed.';
const runLabel = (run: Run): string => `${run.sourceId ?? run.sourceText.split(/\r?\n/)[0].slice(0, 64)} · ${new Date(run.createdAt).toLocaleString()}`;
const aliasTextOf = (run: Run): string => Object.entries(run.aliases).map(([term, aliases]) => `${term} = ${aliases.join(' | ')}`).join('\n');

export default function App() {
  const [localStore] = useState(() => createLocalStore({
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
  }));
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [liveStore, setLiveStore] = useState<SupabaseStore | null>(null);
  const [ready, setReady] = useState(false);
  const [setupMessage, setSetupMessage] = useState('');
  // switchMode admits Live only with a successfully probed store; there is no live-to-local fallback.
  const store: Store = mode === 'demo' ? localStore : liveStore!;
  const [history, setHistory] = useState<Run[]>([]);
  const [bundle, setBundle] = useState<RunBundle | null>(null);
  const [viewedId, setViewedId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState(DEMO_SOURCES[0].id);
  const [voiceId, setVoiceId] = useState(DEMO_VOICES[0].id);
  const [source, setSource] = useState(DEMO_SOURCES[0].text);
  const [samples, setSamples] = useState<string[]>([...DEMO_VOICES[0].samples]);
  const [termsText, setTermsText] = useState('');
  const [aliasesText, setAliasesText] = useState('');
  const [toggles, setToggles] = useState<Record<string, Toggle>>({});
  const [previewTime, setPreviewTime] = useState(DEMO_REFERENCE_TIME);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [gate, setGate] = useState<{ key: string; allowed: boolean } | null>(null);
  const operation = useRef(false);
  const uiBusy = busy || loading;

  function adopt(next: RunBundle) {
    setBundle(next); setViewedId(next.run.selectedAttemptId ?? next.attempts.at(-1)?.id ?? null); setGate(null);
    setSourceId(next.run.sourceId ?? ''); setVoiceId(next.run.voiceId ?? 'custom');
    setSource(next.run.sourceText); setSamples([...next.run.samples]); setToggles({ ...next.run.toggles });
    setTermsText(next.run.protectedTerms.join('\n')); setAliasesText(aliasTextOf(next.run));
    setPreviewTime(next.run.referenceTime ?? new Date().toISOString());
  }
  function draft(nextMode = mode) {
    setBundle(null); setViewedId(null); setGate(null); setError(''); setNotice('');
    setSourceId(DEMO_SOURCES[0].id); setVoiceId(DEMO_VOICES[0].id);
    setSource(DEMO_SOURCES[0].text); setSamples([...DEMO_VOICES[0].samples]);
    setTermsText(''); setAliasesText(''); setToggles({});
    setPreviewTime(nextMode === 'demo' ? DEMO_REFERENCE_TIME : new Date().toISOString());
  }
  // Store reads on mount are browser-only. A live store can exist only after explicit setup exploration.
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setGate(null);
    void (async () => {
      try {
        const runs = await store.listRuns();
        const latest = runs[0] ? await store.loadRun(runs[0].id) : null;
        if (cancelled) return;
        setHistory(runs);
        if (latest) adopt(latest);
      } catch (e) { if (!cancelled) setError(`History could not be loaded: ${messageOf(e)}`); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [store]);

  const viewed: Attempt | undefined = bundle?.attempts.find((a) => a.id === viewedId);
  const permissionKey = bundle && viewed ? `${evidenceKey(bundle.run, viewed)}:${bundle.rulings.at(-1)?.id ?? 'none'}` : '';
  useEffect(() => {
    let cancelled = false;
    setGate(null);
    if (uiBusy || !bundle || !viewed || viewed.id !== bundle.run.selectedAttemptId || bundle.run.status !== 'review_ready') return;
    void store.canExport(bundle.run.id, viewed.id).then((allowed) => {
      if (!cancelled) setGate({ key: permissionKey, allowed });
    }).catch((e: unknown) => { if (!cancelled) setError(`Export permission could not be checked: ${messageOf(e)}`); });
    return () => { cancelled = true; };
  }, [store, bundle, viewed, permissionKey, uiBusy]);
  const exportAllowed = !!permissionKey && gate?.key === permissionKey && gate.allowed && !uiBusy;
  const parsedAliases = useMemo(() => parseAliases(aliasesText), [aliasesText]);
  const terms = useMemo(() => termsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), [termsText]);
  const inputErrors = useMemo(() => validateInputs(source, samples).map((p) => p.message), [source, samples]);
  const preview = useMemo(() => {
    if (bundle?.run.ledger) return { facts: bundle.run.ledger, error: null };
    if (validateInputs(source, null).length || parsedAliases.error) return { facts: [], error: null };
    try { return { facts: extract(source, { referenceTime: new Date(previewTime), toggles, protectedTerms: terms, aliases: parsedAliases.aliases }), error: null }; }
    catch (e) { return { facts: [], error: `Ledger preview failed: ${messageOf(e)}` }; }
  }, [bundle, source, previewTime, toggles, terms, parsedAliases]);

  async function act(work: () => Promise<void>) {
    if (operation.current || loading) return;
    operation.current = true; setBusy(true); setError(''); setNotice(''); setGate(null);
    try { await work(); }
    catch (e) { setError(messageOf(e)); }
    finally { operation.current = false; setBusy(false); }
  }
  async function reloadRun(target: Store, runId: string): Promise<RunBundle> {
    const next = await target.loadRun(runId);
    if (!next) throw new Error('This run is no longer present. Refresh history before continuing.');
    adopt(next); setHistory(await target.listRuns());
    return next;
  }
  function checkLiveSetup() {
    void act(async () => {
      setReady(false); setSetupMessage('Checking the backend configuration…');
      try {
        // No import, client construction, anonymous auth or backend probe occurs before this explicit click.
        const [{ getSupabaseClient }, { createSupabaseStore }] = await Promise.all([
          import('./lib/supabase.ts'), import('./lib/store/supabaseStore.ts'),
        ]);
        const client = getSupabaseClient();
        if (!client) throw new Error('Both public backend connection variables are required.');
        const candidate = createSupabaseStore(client);
        const result = await candidate.probeConfiguration();
        if (!result.configured || !result.rewrite_configured) throw new Error('The backend reports live rewriting is not configured. Complete backend provisioning first.');
        setLiveStore(candidate); setReady(true);
        setSetupMessage(`Live setup is ready. ${result.judge_configured ? 'The claim judge is configured.' : 'The optional LLM claim judge is not configured; unavailable evidence must be finalised explicitly if needed.'} Choose Live workspace to send text.`);
      } catch (e) { setSetupMessage(`Live setup unavailable: ${messageOf(e)}`); throw e; }
    });
  }
  function switchMode(next: 'demo' | 'live') {
    if (uiBusy || operation.current || next === mode || (next === 'live' && (!ready || !liveStore))) return;
    setLoading(true); setHistory([]); draft(next); setMode(next);
  }
  function chooseDemo(id: string) {
    const pairing = DEMO_PAIRINGS.find((p) => p.sourceId === id);
    if (!pairing) return;
    setSourceId(id); setSource(demoSource(id).text); setVoiceId(pairing.voiceId); setSamples([...demoVoice(pairing.voiceId).samples]); setToggles({});
  }
  function chooseVoice(id: string) { setVoiceId(id); setSamples(id === 'custom' ? [''] : [...demoVoice(id).samples]); }

  /** Resume only through server functions, reusing persisted idempotency keys. Never write browser attempts/verdicts. */
  async function driveLive(target: SupabaseStore, runId: string) {
    try {
      for (let call = 0; call < 4; call++) {
        const current = await reloadRun(target, runId);
        if (current.run.status === 'review_ready') return;
        if (current.run.status === 'judging') {
          if (!current.run.selectedAttemptId) throw new Error('The server has no selected attempt to judge. Reload before continuing.');
          await target.requestJudge({ run_id: runId, attempt_id: current.run.selectedAttemptId, request_key: `ui:${runId}:judge` });
          await reloadRun(target, runId); return;
        }
        const latest = current.attempts.at(-1);
        if (latest && (latest.state === 'unknown' || latest.state === 'call_failed')) throw new Error('The last provider call is unavailable. Reload stored evidence; an unknown dispatch requires backend owner recovery before another call.');
        // A complete final attempt may need finish_attempts replay after an interrupted response. Reuse its key.
        const replayFinal = latest?.state === 'complete' && (!latest.flags.some((f) => f.class === 'hard') || latest.ordinal === 3);
        const ordinal = latest && (latest.state === 'in_flight' || replayFinal) ? latest.ordinal : (latest?.ordinal ?? 0) + 1;
        if (ordinal > 3) throw new Error('The maximum of three attempts has been reached. Reload the server state.');
        await target.requestRewrite({ run_id: runId, expected_ordinal: ordinal,
          request_key: latest && (latest.state === 'in_flight' || replayFinal) && latest.requestKey ? latest.requestKey : `ui:${runId}:rewrite:${ordinal}`,
          source_hash: current.run.sourceHash ?? await sha256Hex(current.run.sourceText) });
      }
      const final = await reloadRun(target, runId);
      if (final.run.status !== 'review_ready') throw new Error('The run is still pending. Reload or resume the stored request.');
    } catch (e) {
      // A server error can still seal partial evidence; always reload, without silently choosing Demo.
      try { await reloadRun(target, runId); }
      catch (reloadError) { throw new Error(`${messageOf(e)} Stored state could not be reloaded: ${messageOf(reloadError)}`); }
      throw e;
    }
  }
  function rewrite() {
    void act(async () => {
      if (bundle) throw new Error('Start a new draft before creating another run.');
      const problems = validateInputs(source, samples);
      if (problems.length || parsedAliases.error || preview.error) throw new Error([...problems.map((p) => p.message), parsedAliases.error, preview.error].filter(Boolean).join(' '));
      if (mode === 'demo') {
        if (source !== demoSource(sourceId).text || !DEMO_PAIRINGS.some((p) => p.sourceId === sourceId && p.voiceId === voiceId) || JSON.stringify(samples) !== JSON.stringify(demoVoice(voiceId).samples)) throw new Error('Offline Demo supports only the displayed bundled script pairings.');
        try {
          const next = await runOnStore(localStore, { ...demoRunSpec(sourceId, voiceId, toggles), protectedTerms: terms, aliases: parsedAliases.aliases }, demoDeps(recordings));
          adopt(next); setHistory(await localStore.listRuns());
        } catch (e) { setHistory(await localStore.listRuns()); throw e; }
      } else {
        if (!ready || !liveStore) throw new Error('Check live setup before sending text.');
        const run = await liveStore.createRun({ system: 'B4', mode: 'live', sourceId: null,
          voiceId: voiceId === 'custom' ? null : voiceId, sourceText: source, samples: [...samples],
          toggles: { ...toggles }, aliases: parsedAliases.aliases, protectedTerms: [...terms] });
        await driveLive(liveStore, run.id);
      }
    });
  }
  function rule(decision: Decision, reason: string, acks: string[]) {
    const snapshot = bundle; const attempt = viewed;
    if (!snapshot || !attempt?.contentHash) return;
    void act(async () => {
      const fresh = await store.loadRun(snapshot.run.id);
      const current = fresh?.attempts.find((a) => a.id === attempt.id);
      if (!fresh || !current || evidenceKey(fresh.run, current) !== evidenceKey(snapshot.run, attempt)) throw new Error('The content or evidence changed. Reload and review it again.');
      await store.recordRuling({ runId: snapshot.run.id, attemptId: attempt.id, expectedHash: attempt.contentHash!,
        evidenceVersion: snapshot.run.evidenceVersion, decision, reason, acknowledgedFlags: acks });
      await reloadRun(store, snapshot.run.id);
      setNotice(`${readable(decision)} recorded${snapshot.run.localDemo ? ' · local demo record' : ' on the server'}.`);
    });
  }
  function exportText(kind: 'copy' | 'download') {
    const snapshot = bundle; const attempt = viewed;
    if (!exportAllowed || !snapshot || !attempt) return;
    void act(async () => {
      const fresh = await store.loadRun(snapshot.run.id);
      const current = fresh?.attempts.find((a) => a.id === attempt.id);
      if (!fresh || !current || fresh.run.selectedAttemptId !== current.id || current.outputText === null ||
        evidenceKey(fresh.run, current) !== evidenceKey(snapshot.run, attempt) ||
        await sha256Hex(current.outputText) !== current.contentHash || !await store.canExport(fresh.run.id, current.id)) {
        if (fresh) adopt(fresh);
        throw new Error('Export is locked: the current stored ruling, selection, content hash or evidence no longer matches.');
      }
      // Exact immutable stored output; no formatting, trimming, HTML or added newline.
      if (kind === 'copy') await navigator.clipboard.writeText(current.outputText);
      else {
        const url = URL.createObjectURL(new Blob([current.outputText], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = `rewrite-${fresh.run.id}-attempt-${current.ordinal}.txt`;
        document.body.append(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setNotice(kind === 'copy' ? 'Exact approved text copied.' : 'Exact approved text downloaded.');
    });
  }
  function finalizeUnavailable() {
    const snapshot = bundle;
    if (!snapshot || !liveStore) return;
    void act(async () => {
      try {
        const fresh = await liveStore.loadRun(snapshot.run.id);
        if (!fresh || fresh.run.status !== 'judging' || !fresh.run.selectedAttemptId) throw new Error('Reload the run before finalising its judge evidence.');
        await liveStore.requestJudge({ run_id: fresh.run.id, attempt_id: fresh.run.selectedAttemptId,
          request_key: `ui:${fresh.run.id}:judge-unavailable`, finalize_unavailable: true });
      } finally { await reloadRun(liveStore, snapshot.run.id); }
    });
  }
  const locked = bundle !== null;
  const demoNote = mode === 'demo' ? DEMO_SOURCES.find((s) => s.id === sourceId)?.note ?? '' : '';
  return <div className="app-shell"><header className="masthead"><a href="#main" className="brand"><span className="brand-mark" aria-hidden="true">f.</span><span>Fact-preserving<span className="brand-subtitle">THE REWRITE WORKSPACE</span></span></a><span className="masthead-note">A new voice.<br /><strong>The same facts.</strong></span></header>
    <main id="main"><div className="intro"><span className="eyebrow">WRITE WITH RANGE. REVIEW WITH EVIDENCE.</span><h1>Change the voice.<br /><em>Keep what matters.</em></h1><p>Rewrite with a fact ledger beside you. Inspect each attempt, review the evidence, and decide what leaves the workspace.</p></div>
      <SetupBanner mode={mode} hasConfig={HAS_PUBLIC_CONFIG} ready={ready} busy={uiBusy} setupMessage={setupMessage} onCheck={checkLiveSetup} onMode={switchMode} />
      <ProviderWarning live={mode === 'live'} />
      <div className="workspace-toolbar"><label htmlFor="history">Stored history<select id="history" disabled={uiBusy} value={bundle?.run.id ?? ''} onChange={(e) => { const id = e.target.value; if (id) void act(async () => { await reloadRun(store, id); }); }}><option value="">{loading ? 'Loading stored records…' : 'Choose a stored run'}</option>{history.map((run) => <option key={run.id} value={run.id}>{runLabel(run)} · {readable(run.status)}{run.localDemo ? ' · local demo record' : ' · live record'}</option>)}</select></label><button type="button" className="button secondary" disabled={uiBusy} onClick={() => draft()}>New draft</button>
        <button type="button" className="text-button" disabled={uiBusy} onClick={() => void act(async () => { const runs = await store.listRuns(); setHistory(runs); if (bundle) await reloadRun(store, bundle.run.id); })}>Refresh stored state</button></div>
      <div className="messages" aria-live="polite" aria-atomic="true">{uiBusy && <p className="working" role="status">{loading ? 'Loading stored history…' : 'Working — keep this workspace open. Server requests reuse stored keys on resume.'}</p>}{error && <p className="error" role="alert">{error}</p>}{notice && <p className="success" role="status">{notice}</p>}</div>
      <InputPanel mode={mode} sourceId={sourceId} voiceId={voiceId} source={source} samples={samples} locked={locked} busy={uiBusy} errors={inputErrors} note={demoNote} onDemo={chooseDemo} onVoice={chooseVoice} onSource={(text) => { setSource(text); setSourceId(''); setToggles({}); }} onSamples={setSamples} />
      <LedgerPanel facts={preview.facts} evidenceFrozen={bundle?.run.ledger != null} frozen={locked} busy={uiBusy} terms={termsText} aliases={aliasesText} error={parsedAliases.error ?? preview.error} suggestion={DEMO_IGNORE_SUGGESTION[sourceId]?.raw} onTerms={(text) => { setTermsText(text); setToggles({}); }} onAliases={(text) => { setAliasesText(text); setToggles({}); }} onToggle={(id, value) => setToggles({ ...toggles, [id]: value })} />
      {!bundle && <div className="run-action"><p>Inputs, aliases and required toggles freeze when this run starts.<br /><span className="muted">One initial attempt + up to two repairs. No in-place output editing.</span></p><button type="button" className="button primary" disabled={uiBusy || inputErrors.length > 0 || !!parsedAliases.error || !!preview.error || (mode === 'live' && !ready)} onClick={rewrite}>Freeze inputs & rewrite <span aria-hidden="true">→</span></button></div>}
      {bundle && <section className="review-workspace" aria-label="Review stored rewrite"><div className="review-heading"><div><span className="eyebrow">THE REVIEW DESK</span><h2>Read the rewrite. Inspect the evidence.</h2></div><span className={`status ${bundle.run.verdict ?? 'pending'}`}>{readable(bundle.run.verdict ?? bundle.run.status)}</span></div>
        <p className="muted run-meta">{bundle.run.localDemo ? 'Local demo record' : 'Live server record'} · {readable(bundle.run.status)} · evidence version {bundle.run.evidenceVersion}<br /><span className="hash">Source SHA-256: {bundle.run.sourceHash ?? 'Pending server freeze — preview is not frozen evidence yet'}</span></p>
        {bundle.run.error && <p className="error" role="alert">Stored run error: {bundle.run.error}</p>}
        {mode === 'live' && bundle.run.status !== 'review_ready' && <div className="pending-controls"><p>The run is pending. Reload or resume uses the stored request key; an uncertain provider dispatch is never retried automatically. Export remains locked.</p><div className="actions"><button type="button" className="button secondary" disabled={uiBusy || !ready || !liveStore} onClick={() => { if (liveStore) void act(() => driveLive(liveStore, bundle.run.id)); }}>{bundle.run.status === 'judging' ? 'Resume claim judging' : 'Resume stored run'}</button>{bundle.run.status === 'judging' && <button type="button" className="button secondary" disabled={uiBusy || !liveStore} onClick={finalizeUnavailable}>Finish with LLM judge unavailable</button>}</div></div>}
        {mode === 'demo' && bundle.run.status !== 'review_ready' && <p className="frozen-note">This local run did not finish. No output is exportable. Start a new draft to run the bundled script again.</p>}
        <AttemptList attempts={bundle.attempts} viewedId={viewedId} selectedId={bundle.run.selectedAttemptId} busy={uiBusy} onView={(id) => { setGate(null); setViewedId(id); }} />
        {viewed ? <><DiffView run={bundle.run} attempt={viewed} /><ClaimFlags run={bundle.run} attempt={viewed} /><StylePanel samples={bundle.run.samples} attempt={viewed} /><RulingBar key={evidenceKey(bundle.run, viewed)} run={bundle.run} attempt={viewed} rulings={bundle.rulings} busy={uiBusy} onRule={rule} /><ExportBar allowed={exportAllowed} busy={uiBusy} hash={viewed.contentHash} onExport={exportText} /></> : <p className="empty">No completed attempt is stored yet. Pending or failed calls do not create exportable content.</p>}
      </section>}
      {!bundle && <StylePanel samples={samples} />}
      <DeleteMyData key={mode} live={mode === 'live'} busy={uiBusy} onDelete={() => void act(async () => { await store.deleteMyData(); setHistory([]); draft(); setNotice(mode === 'live' ? 'Your live text and review data were deleted.' : 'Local demo history cleared.'); })} />
    </main><footer><strong>Preservation is a review process.</strong><span>Lexical checks do not verify relationships or truth against the world. Jev: not evaluated.</span></footer>
  </div>;
}
