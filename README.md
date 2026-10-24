# Fact-preserving rewriter

Rewrite English plain text or Markdown in a supplied voice, inspect preservation evidence, and record a human ruling before copying or downloading the selected output. This checks preservation against the source: lexical facts do not establish external truth or relationships between facts.

**Source complete, provisioning pending, runtime unverified.** Nothing has been installed, built, typechecked, linted, tested, evaluated or app-run. Only focused source inspection, standalone file consistency/counting, and TypeScript syntax parsing occurred during construction. The syntax parser does not validate JSX, imports, types or behavior. There are no measured efficacy, cost or latency results. See [deferred validation](docs/DEFERRED-VALIDATION.md).

The source contains a React 18 / TypeScript / Vite review workspace, shared checking and repair code, local demo persistence, Supabase-compatible persistence, SQL security/accounting definitions, two Deno function handlers, synthetic fixtures and an evaluation harness. Backend resources have not been provisioned. [BOLT-HANDOFF.md](BOLT-HANDOFF.md) is the single provisioning inventory and currently supplies an inspection/preparation prompt only.

## Intended workflow

1. Start in **Offline Demo**. Bundled authored scripts cover specific source/voice pairings; they cannot answer arbitrary input. No backend request is intended on this path, including when public connection variables exist. Local records are labelled demo records.
2. Choose `incident-note-03` with `terse-engineer`. Review the extracted ledger, optionally ignore the suggested entity, and freeze the run. The authored first attempt drops a quantity and leaks a sample name; a code-written repair request precedes the next attempt. The later modal warning requires review. These are scripted examples, not demonstrated model efficacy.
3. Inspect attempts, green kept/red missing/amber added facts, wording differences, flags and sentence-pair evidence. Style distance is descriptive and disabled below 600 sample words; the small demo samples fall below that boundary.
4. Approve a selected `pass` attempt, or acknowledge every soft/claim/coverage flag to approve `needs_review`. A `failed` attempt requires an override with a trimmed reason of at least 10 characters. A later rejection revokes export permission. The ruling binds the selected content hash and evidence version; viewing another attempt does not unlock it.
5. Try `injected-ceo` and reject the added claim, then `allfail-replication` with `warm-newsletter` for the three-attempt failure/override path. Reload to inspect local history. All these journeys still need execution.

**Live workspace** becomes selectable only after both public connection variables exist and an explicit **Check live setup** succeeds. Checking creates an anonymous Auth session and probes readiness without a model call. Arbitrary live source input is limited to 30,720 UTF-8 bytes; supply 1–5 samples totaling at most 20,480 bytes or choose a built-in voice. Protected terms, aliases and required/ignored ledger toggles freeze with the run. Live sends source and samples to the configured provider and stores them under that anonymous identity. Losing the browser session can make history inaccessible. Backend errors remain visible; they do not silently switch to Demo. Demo history and live erasure are separate actions.

## Repository map

The product/import root is this directory. Paths below describe existing source; generated outputs are explicitly marked.

| Path | Contents |
|---|---|
| `src/App.tsx`, `src/main.tsx`, `src/components/`, `src/styles.css` | Review workspace and eleven focused components |
| `src/contracts/` | Strict API schemas and run/attempt/flag/ruling types |
| `src/lib/text/`, `factledger/`, `mask/`, `checks/`, `claims/`, `style/` | Segmentation, extraction, masking, deterministic checks, overlap/optional judge, descriptive style |
| `src/lib/loop/`, `prompts/`, `providers/`, `server/` | B0–B4 orchestration, structured repair, provider adapters and durable live calls |
| `src/lib/store/`, `rulings/`, `callledger/`, `cited/`, `ui/`, `demo/` | Local/live stores, export gate, accounting, pointers, presentation helpers, bundled scripts |
| `src/lib/baselines/`, `mutators/`, `evalkit/` | Computed baselines, ten corruption types, seeded pairing and Wilson summaries |
| `src/lib/supabase.ts` | Lazy client accessor; no auth/client creation at import |
| `supabase/migrations/`, `supabase/config.toml` | Five ordered SQL files and anonymous auth/function JWT settings |
| `supabase/functions/{rewrite,judge}/index.ts` and each `_lib/` | Two handlers with mechanical function-local copies and hash manifests; generator/parity execution pending |
| `fixtures/` | Authored corpus, gold markup/manifest, known-good paraphrases, voices and `mock/scripts.json`; details in [fixtures/README.md](fixtures/README.md) |
| `scripts/` | Fixture/recording generators, sync tool, syntax parser, spot-check tool and `eval/` commands including identity bootstrap |
| `tests/lib/`, `tests/contracts/`, `tests/sql/` | Unexecuted test source and SQL definitions |
| `results/README.md` | Placeholder only; no result artifacts generated |
| `docs/`, `BOLT-HANDOFF.md` | Design, limitations, pending validation and infrastructure inventory |
| `package.json`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `index.html`, `.env.example` | Pinned package/configuration source; no `package-lock.json` yet |

## Future local validation and run sequence

These steps are for after the static construction restriction closes; none ran during construction. Use Node with WebCrypto and `module.stripTypeScriptTypes` support (the syntax tool requires Node 22.13+/23.2+; Node 24 was used for source parsing). Dependency resolution against the exact pins remains unverified. From this root:

```sh
npm install
npm ls --depth=0
npm run typecheck
npx tsc --noEmit -p tsconfig.node.json
npm run lint
npm test
npm run build
deno check supabase/functions/rewrite/index.ts supabase/functions/judge/index.ts
```

The first authorized install creates `package-lock.json`; review and commit it with any necessary compatibility fixes. Subsequent clean installs use `npm ci`. Build output is `dist/`. Validate SQL on an isolated Supabase-compatible database and complete the auth/RLS/concurrency checks in [deferred validation](docs/DEFERRED-VALIDATION.md) before relying on live enforcement.

Then run `npm run fixtures`, inspect the generated manifest/annotations, run `npm run sync:functions` and its parity test, and run `npm run recordings`. Inspect recording identities and change `MOCK_SOURCE` in `src/lib/providers/mock.ts` from `scripted` to `recordings` only when ready to verify that mode. A missing/stale key must throw `MockRecordingMissing`, with no fallback. Re-run relevant tests and build after this source change. Recordings generated from scripts remain mock data.

Before any held-out evaluation, run `npm run eval:claims -- --calibrate-only`, review and commit the frozen `results/claim-thresholds.json` (including a missed target). Run `npm run eval:claims` once, then `npm run eval -- --mock`; the aggregate command reuses a validated claims edition. Preserve calibration/claims/E2E editions; existing editions refuse reevaluation or overwrite as documented. Generate independent review sheets only from actual outputs. See [results/README.md](results/README.md) for artifact meanings.

For an eventual browser session, first reserve the project's authorized host port under the local port policy, then use `npm run dev -- --host 127.0.0.1 --port <reserved-port> --strictPort`. Leave public variables blank for Demo. Live needs separately authorized infrastructure setup from the handoff and the pending manual checks. No server was started here.

Live evaluation requires a separate authorized identity bootstrap, `EVAL_EXPECTED_USER_ID`, an owner-approved bounded `live-plan.json`, an expiring SQL `eval_allowances` grant for that exact user, and matching `EVAL_OWNER_APPROVAL_REFERENCE`. The plan ceiling is at most 5,000,000 micro-USD; a proposal or readiness probe grants no spending permission. Only deployed functions may call providers; the evaluator receives public backend configuration and saved user tokens, never provider or service keys. The exact future sequence is in [deferred validation](docs/DEFERRED-VALIDATION.md#live-evaluation-owner-workflow).

## Evidence boundaries

B0 is unchanged text; B1 is a computed rule restyler; B2 is one plain rewrite prompt; B3 is draft/self-check/revision; B4 is the masked deterministic-check repair pipeline. B4 uses the same checker in construction and scoring, so its self-score is circular. The seeded authored corpus is diagnostic, and pair-level intervals are descriptive because two voice pairs share each source.

The optional **LLM comparative corpus calibration/ablation is cut**. Code/overlap evaluation and overlap calibration remain, as does the optional live server judge for a selected B4 attempt. Selected-attempt evidence is not a corpus comparison or calibrated LLM false-alarm result. The third voice is builder-authored **PLACEHOLDER — not Gutenberg**; Gutenberg provenance is unverified. **Jev: not evaluated.** See [design](docs/DESIGN.md) and [limitations](docs/LIMITATIONS.md).

MIT license; see [LICENSE](LICENSE).
