# Bolt infrastructure handoff: Fact-preserving rewriter

## Target and readiness

- Repository: `fact-preserving-rewriter`, local product repository; app/import root is this directory. No remote, imported branch or published revision is established. A future owner must identify the exact reviewed branch/revision before import.
- Database path: **Bolt Database**, intended fresh empty Supabase-compatible target. No separate Supabase project has been provisioned. If a connection already exists, preserve it and reconcile before applying anything.
- Existing target / applied migration baseline: **Unknown; not inspected.** Local files are not proof of applied migrations or cloud resources.
- Hosting: intended Bolt hosting; not configured. Publication: **prepare only**.
- Bolt action: **inspect and prepare only**. No provisioning, migration execution, deployment, secret entry, remote push or publication is authorized by this document.
- Status: **source complete, provisioning pending, runtime unverified**. Nothing installed, built, typechecked, linted, tested, evaluated or app-run. Only focused source inspection, standalone file processing/counting and syntax parsing occurred. JSX/types/imports/security/runtime are unverified.
- Owner prerequisites: source validation and a reviewed lockfile; future import access/branch selection; explicit infrastructure authorization; database compatibility/baseline inspection; provider account/model/price choices and server-secret entry through settings; authorized live budget/identity and acceptance receipts.

This is the single provisioning inventory. [DEFERRED-VALIDATION.md](docs/DEFERRED-VALIDATION.md) supplies the detailed future verification sequence; it does not establish deployment readiness.

## Build and connection

| Item | Exact source or future command |
|---|---|
| Stack | React 18.3.1, TypeScript 5.6.2, Vite 5.4.8, supabase-js 2.45.4; exact package pins in `package.json`, resolution unverified |
| Runtime | Node with WebCrypto; source syntax parser needs `module.stripTypeScriptTypes` (22.13+/23.2+; construction parser used Node 24). Deno is separately required for function checks |
| Initial install | `npm install`, inspect compatibility with `npm ls --depth=0`, review/commit the newly created `package-lock.json`. No lockfile exists yet |
| Later frozen install | `npm ci` only after the reviewed lockfile exists |
| Frontend checks / build | `npm run typecheck`; `npx tsc --noEmit -p tsconfig.node.json`; `npm run lint`; `npm test`; `npm run build` → `dist/`; all pending |
| Function checks | `npm run sync:functions`, inspect diff; `npx vitest run tests/contracts/functions.test.ts`; `deno check supabase/functions/rewrite/index.ts supabase/functions/judge/index.ts`; all pending |
| Dev | After host-port reservation: `npm run dev -- --host 127.0.0.1 --port <reserved-port> --strictPort`; not run |
| Public client config | `src/lib/supabase.ts`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; placeholders in `.env.example`, no real values |
| Missing config | Offline Demo remains available. Live requires both public names and an explicit authenticated readiness probe; no client/auth/probe at import or Offline Demo mount is intended |

## Database

Apply only after separate authorization and baseline reconciliation, in this exact order:

| Order | Exact migration file under `supabase/migrations/` | Implemented SQL resources | Applied status |
|---|---|---|---|
| 1 | `20261024000100_core_tables.sql` | `style_profiles`, `rewrite_runs`, `attempts`; sample/flag/verdict validators; frozen-evidence guard triggers and constraints | Unknown / pending |
| 2 | `20261024000200_rulings_ledger.sql` | `rulings` and monotonic sequence; `budget_limits`, `budget_counters`, `eval_allowances`, `call_ledger`; constraints/indexes | Unknown / pending |
| 3 | `20261024000300_rls.sql` | RLS on all eight tables; own-row access and raw-run/profile inserts; grants | Unknown / pending |
| 4 | `20261024000400_server_rpcs.sql` | Nine service-only workflow/accounting RPCs listed below | Unknown / pending |
| 5 | `20261024000500_user_rpcs.sql` | Three identity-derived user RPCs and narrow helper grants | Unknown / pending |

Dependencies: PostgreSQL with `auth.users`, `auth.uid()`, `anon`, `authenticated`, `service_role`, and `gen_random_uuid()` support. No extension-creation migration is supplied; verify target compatibility instead of assuming it. No database seeds are required; synthetic fixtures remain local files.

Access model: no anonymous table access. An anonymous **Auth session** receives an authenticated user JWT and may SELECT its own profiles/runs, plus attempts/rulings/calls through the owned parent run. Only own profiles and raw open runs may be inserted. Run insert requires null derived fields/verdict/selection, evidence version zero, no local-demo row and an owned optional profile. No client UPDATE/DELETE or direct attempt/ruling/call/budget/allowance INSERT is granted. Budget/allowance tables are invisible to clients. `service_role` has table access and bypasses RLS, so handler authorization must precede privileged run operations.

All workflow RPCs are SECURITY DEFINER with `search_path = public, pg_temp`:

| Caller grant | Exact RPC names |
|---|---|
| `service_role` only; revoked from `public`, `anon`, `authenticated` | `freeze_run_inputs`, `begin_attempt`, `reserve_model_call`, `claim_dispatch`, `settle_model_call`, `complete_attempt`, `fail_attempt`, `finish_attempts`, `finish_judging` |
| `authenticated` only; derive user from `auth.uid()` | `record_ruling(p_attempt,p_decision,p_reason,p_acknowledged_flags,p_expected_hash,p_evidence_version)`, `can_export(p_attempt)`, `delete_my_data()` |

Helper grants: `valid_samples(jsonb)` to `authenticated,service_role`; `flags_valid(jsonb)` and `flags_verdict(jsonb)` to `service_role`; trigger functions `guard_run_update()`/`guard_attempt_update()` revoked from public/client roles. Sequence usage/select is granted to `service_role`. The SQL files are authoritative for full signatures and constraints.

Rulings require owned selected completed `review_ready` evidence with matching hash/version. Approve requires no hard failures and all advisory IDs when needed; failed overrides require a trimmed ≥10-character reason. Latest monotonic rejection revokes export. Erasure deletes content/profile/run/attempt/ruling rows and clears call response bodies/identity links, detaches allowance user identity and retains pseudonymous counters/accounting without a refund or cap reset.

Retry rule: inspect authorized read-only migration history/schema first. Compare tables, constraints, triggers, policies, RPC signatures/grants with all five files; document manual drift and a reconciliation plan. Apply only verified pending migrations after authorization. Do not blindly replay, repair the ledger automatically, replace a populated connection, drop/recreate resources or infer success after a timeout.

## Functions

| Name / exact source | Caller and contract | Resources / deployment |
|---|---|---|
| `rewrite`; `supabase/functions/rewrite/index.ts` | User JWT, gateway `verify_jwt=true` plus `auth.getUser` and owned-run query. `{run_id,expected_ordinal,request_key,source_hash}` → stored attempt/output/hash/flags/verdict/status/next ordinal/call IDs. `source_hash` is an expected-input check, not trusted derived evidence | Owned run/attempts/calls; service RPCs; server provider configuration. B4 at most three attempts; B2 one call; B3 draft/check/revision in one attempt. B0 no paid call; B1 returns `computed_baseline_local_only` |
| `judge`; `supabase/functions/judge/index.ts` | Same user/ownership checks. `{run_id,attempt_id,request_key,finalize_unavailable?}` → flags/coverage/verdict/status/call IDs. Only selected B4 attempt in `judging` | Same durable accounting; deterministic batch keys 0..3, at most 30 pairs each. `finalize_unavailable=true` makes no paid call and seals conservative coverage |

Both also accept authenticated `{ "probe": true }` with optional bounded `eval` requirement. The probe returns readiness booleans, not secrets, grants or private counters; it performs no model call or run/evidence RPC. Eval readiness examines only the verified caller's newest active owner allowance and cannot authorize spending.

CORS: exact `APP_ORIGIN`; `POST, OPTIONS`; allowed headers `authorization, apikey, content-type, x-client-info`. Missing origin configuration →503; wrong supplied origin →403; OPTIONS →204. Requests require JSON, strict schemas and at most 4,096 UTF-8 body bytes. Run text/sample limits are checked from stored inputs; model output limit is 65,536 UTF-8 bytes and configured 4,096 maximum output tokens. Missing/invalid user JWT is refused; an anon project key is not user identity.

Each entrypoint imports only its own `_lib/` closure and pinned `npm:@supabase/supabase-js@2.45.4`. Copies and `hashes.json` exist through mechanical file processing; `scripts/sync-function-libs.ts` itself and the parity test have **not run**. Sync roots include step/server rewrite/server judge/config plus all contracts/prompts/providers and their relative imports. `chrono-node` and `zod` imports become pinned `npm:` specifiers. Deployment inclusion/resolution and function parity remain pending.

## Configuration and secrets

Only the two public `VITE_` names belong in browser configuration. Enter server secrets/configuration through platform settings when separately authorized; never expose values in chat, source or client env.

| Name | Consumer / requirement |
|---|---|
| `ANTHROPIC_API_KEY` | Both functions; selects Anthropic when present |
| `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL` | Alternative for both functions; HTTPS operator-selected base required. Anthropic takes precedence if both provider keys exist |
| `REWRITE_MODEL_ID` | Both functions' shared configuration; required for live rewriting/probe readiness |
| `JUDGE_MODEL_ID` | Required when `LLM_JUDGE_ENABLED=true` |
| `MODEL_PRICE_IN_MICRO_USD_PER_MTOK`, `MODEL_PRICE_OUT_MICRO_USD_PER_MTOK` | Nonnegative safe-integer micro-USD prices per million tokens; one shared price pair is used for rewrite/judge, so owner must verify that it safely covers chosen models |
| `LIVE_CALLS_ENABLED` | Exactly `true` permits model configuration; SQL live switch is also required |
| `LLM_JUDGE_ENABLED` | Exactly `true` enables selected-attempt judge |
| `APP_ORIGIN` | Exact browser origin; required for handler/probe access |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Platform-injected function credentials; verify availability, never copy from another project or send to browser |

Owner supplies provider account/keys, currently verified model IDs/prices and intended app origin. Missing provider/model/price/live configuration yields false readiness or 503 `provider_not_configured`, never a fabricated rewrite. With LLM judging enabled but incomplete config, configured readiness is false. A disabled judge is optional. Missing platform credentials or APP_ORIGIN yields503 before a usable probe response. Budget refusal yields429 `budget_exceeded` with scope. After dispatch, provider failures/over-reservation usage remain unknown with full reservation held.

## Caps, auth and outside steps

`budget_limits` starts with `live_enabled=false`. Owner review is required before enabling it. Defaults are configuration proposals, not measured costs:

| Scope | Call bound | Money bound (micro-USD) |
|---|---|---|
| Per call | One claimed phase | 50,000 |
| Per run | Rewrite≤3, B3 check≤1, B3 revision≤1, judge≤4 | 150,000 |
| User UTC day | 40 | 500,000 |
| Global UTC day | 600 | 2,000,000 |

Reservations lock run → user → global, then the newest active allowance if any. An owner-inserted expiring `eval_allowances` row replaces user/global daily enforcement for that user while per-run/call caps remain; counters still record reporting usage. Exhausted newest active grants do not fall back to daily caps. Unknown outcomes retain full reservation. No auto-raise or retry dispatch is permitted. A bounded ≤5,000,000-micro-USD live proposal needs exact-user SQL approval; see the separate owner workflow in deferred validation.

- Auth: enable anonymous sign-in as in `supabase/config.toml`. No email/password/OAuth/recovery UI is implemented; email confirmation and callback/recovery routes are not required. Configure the final Site URL to the chosen app origin/root `/` when hosting is authorized; no app redirect callback route exists. Verify the target gateway accepts actual anonymous-session JWTs with the listed `verify_jwt=true` behavior.
- Storage buckets/uploads, Realtime publications/channels, cron, webhooks and durable external workers: **Not required; none implemented.** No scheduling extensions or project-bound cron secrets are needed.
- Real external integration: selected Anthropic or OpenAI-compatible API, server only. Explicit mock: authored offline scripts and future script-derived recordings. No local privileged provider bypass in the evaluator. No additional service, Jev or provider account has been configured.
- Future owner decisions: close static restriction; review package/runtime compatibility; select exact revision and target; authorize any infrastructure action; choose origin/provider/models/prices and caps; provide protected server settings; reconcile baseline; choose/fund an evaluation allowance and independent review scope. Gutenberg replacement requires a new reviewed corpus edition.

## Acceptance checks and receipts

All outcomes are **pending / unexecuted**. Use synthetic data and authorized identities; capture actual revision, target, command, outcome and non-secret receipt after later execution.

| Check | Required evidence |
|---|---|
| Install/types/lint/tests/build | Newly reviewed lockfile, resolved versions and actual command output; JSX/imports included |
| Function copies/Deno | Regenerated diff, passing parity and separate Deno check; correct deployed self-contained copies |
| Schema/grants | Known migration baseline; five ordered files/resources/signatures/policies; isolated SQL suite |
| Auth/RLS | Missing/invalid JWT refused; two anonymous-auth users isolated; raw-only insert and forbidden writes/service-RPC access refused |
| Probe/configuration | Authenticated no-paid-call probe; missing secret/live-switch/origin cases; false readiness or explicit error without values |
| Durable accounting | Atomic races, same-key retries, single dispatch, stale reserved config, settled replay, unknown/crash recovery, B3 phases and erasure races |
| UI round trip | Offline no-backend traffic; live freeze/attempt/judge/resume/ruling/exact-output export; reject revocation, storage errors, responsive/accessibility checks |
| Evaluation | Frozen dev artifact before heldout; protected claims/mock/live editions; authorized exact-user allowance, ledger IDs and independent actual-output review |
| Upload/webhook/worker | Not required |
| Publication | Not requested; no receipt |

## One prompt for a future authorized source inspection

> Read BOLT-HANDOFF.md and inspect the exact owner-selected source branch/revision. This is a source-complete but runtime-unverified React/Vite app intended for a fresh Bolt Database; no target or applied migration baseline has been verified. Compare the implemented five SQL files, two handlers, function-local copies, RPC grants, configuration names and auth/cap settings with this inventory. Reconcile any existing target baseline through authorized read-only history/schema inspection when available, preserving its connection and data. Report concrete compatibility/deployment gaps and owner/external blockers, including the missing reviewed lockfile and all pending checks. Prepare a reviewable setup plan using actual resource names. Do not create or change cloud resources, apply migrations, deploy functions, enter secrets, enable schedules, push a remote or publish. Do not describe source files or unexecuted checks as infrastructure, runtime or release completion.
