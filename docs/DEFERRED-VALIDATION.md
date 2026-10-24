# Deferred validation

This repository was written under a construction rule that allowed static checks only: nothing has been installed,
built, type-checked, linted, tested or run. The only check performed is the syntax gate
(`node --experimental-vm-modules --no-warnings scripts/syntax-check.mjs <files>`), which strips TypeScript types with
Node's built-in `stripTypeScriptTypes` and parses each file as an ES module without executing it. It cannot check
`.tsx` files, types, imports or behaviour.

Every row below is a check that still has to be run. Started in milestone M1; later milestones append rows.

| # | What | Why deferred | Exact later command / steps |
|---|---|---|---|
| 1 | Install dependencies and generate `package-lock.json` | Installs were not allowed; a lock file cannot be produced without an install | `npm install` then commit `package-lock.json` |
| 2 | Pinned versions resolve and are mutually compatible (react 18.3.1, vite 5.4.8, vitest 2.1.2, typescript 5.6.2, typescript-eslint 8.8.1, chrono-node 2.7.7, ...) | Versions were chosen from memory, never resolved against the registry | `npm install` (fails loudly on a bad pin); `npm ls --depth=0` |
| 3 | Type check (`tsconfig.json`, strict, `verbatimModuleSyntax`, `allowImportingTsExtensions`) | No `tsc` available | `npm run typecheck` |
| 4 | Type check of root config files (`vite.config.ts`, `vitest.config.ts`) | `typecheck` covers only `src scripts tests` | `npx tsc --noEmit -p tsconfig.node.json` |
| 5 | Lint (flat config; erasable-TypeScript rules) | No eslint available | `npm run lint` |
| 6 | Unit tests for `src/lib/text`, `src/lib/factledger`, `src/lib/mask` (`tests/lib/**`) | Running tests was not allowed; tests are source only and have never executed | `npm test` (or `npx vitest run tests/lib`) |
| 7 | chrono-node API usage: `chrono.parse(text, { instant, timezone: 'UTC' }, { forwardDate: false })`, `ParsedResult.index/.text/.start/.end`, `ParsedComponents.get()/.isCertain()` | Written from memory of the chrono-node 2.x API; not compiled or run against 2.7.7 | `npm run typecheck`; `npx vitest run tests/lib/factledger/dates.test.ts` |
| 8 | chrono-node recognition assumptions in `dates.ts`: the result text includes a trailing zone abbreviation ("14:00 UTC") and marks `timezoneOffset` certain; "next Friday" has `weekday` certain and `day` uncertain; "3/4" and "03/04" are recognised; year-less dates take the year closest to the reference; leading "on/at" may be part of the match (trimmed); bare durations are not dates | Behaviour of the library, unobservable without running it | `npx vitest run tests/lib/factledger/dates.test.ts`; adjust filters in `acceptable()` if a case fails |
| 9 | Date filters do not drop real dates or admit numbers: lower-case single words ("may") rejected, sub-day durations rejected, `1.2` / `5-7` rejected, time-only matches need a time marker | Heuristic filters over chrono output, unverified | Same as 7; later `npm run eval:checks` (extractor precision/recall per kind on gold fixtures, M4) |
| 10 | `Intl.Segmenter` sentence behaviour: ICU breaks after "Dr. " (merged back by `segment.ts`), breaks after a line feed (headings, list items) | Engine behaviour, unobservable without running | `npx vitest run tests/lib/text/text.test.ts tests/lib/factledger/entities.test.ts` |
| 11 | Extractor heuristics (numbers, entities, quotes, verbatim) match the tests' expectations | Hand-traced only | `npm test`; then `npm run eval:checks` for precision/recall against gold markup (M4) |
| 12 | WebCrypto availability for `sha256Hex` in vitest's Node environment (`globalThis.crypto.subtle`, Node >= 20) | Not run | `npx vitest run tests/lib/text/text.test.ts tests/lib/mask/mask.test.ts` |
| 13 | `npm run build` (Vite) — `index.html` points at `src/main.tsx`, which M5 creates | UI does not exist until M5; building was not allowed | After M5: `npm run build` |
| 14 | npm scripts `eval*`, `sync:functions`, `fixtures`, `recordings` point at files created in M3/M4 | Scripts declared up front by plan; target files not yet written | After M3/M4: run each script once (`npm run fixtures`, `npm run sync:functions`, `npm run recordings`, `npm run eval -- --mock`) |
| 15 | Syntax gate itself on a Node without `module.stripTypeScriptTypes` (needs Node >= 22.13 / 23.2) | Only Node 24.18 available here | `node --version`; `npm run syntax` |
| 16 | M2 hard/soft checks and byte limits, including copied-sample source exemption, placeholder failures and uncertain merge/split correspondence | Source inspection and syntax parsing only; assertions have never executed | `npx vitest run tests/lib/checks/checks.test.ts` |
| 17 | M2 style features, 600-word boundary, code-picked excerpts and zero-variance skipping | Source only; numerical and segmentation behaviour unverified | `npx vitest run tests/lib/style/style.test.ts` |
| 18 | M2 bidirectional alignment, number/date blanking, overlap findings, third-judge interface and strict judge-reply parsing | Test source exists; no tests or model calls permitted | `npx vitest run tests/lib/claims/claims.test.ts`; calibrate overlap on dev in M4 before reporting detection rates |
| 19 | M2 pure step, 3-attempt cap, repair provenance, selection, fail-closed operational errors and merge/split operator-movement regressions | Tests written but not run | `npx vitest run tests/lib/loop/loop.test.ts` |
| 20 | M2 provider schema parsing, scripted/recorded lookup, recording staleness and injected-fetch adapter contracts | No HTTP, tests or registry lookups executed; live provider compatibility remains unverified | `npx vitest run tests/lib/providers/providers.test.ts`; later owner-configured edge-function live canary (M3+) |
| 21 | M2 prompts keep user data out of system messages, delimit adversarial text and separate B3 phases | Source inspection only | `npx vitest run tests/lib/prompts/prompts.test.ts` |
| 22 | M2 exact-hash/evidence approval, flag acknowledgement, reject revocation, typed override and browser-storage replay | Source only, including test cases for stale evidence and frozen attempts | `npx vitest run tests/lib/rulings/gate.test.ts tests/lib/store/localStore.test.ts` |
| 23 | M2 Offline Demo journey legs 4–10: actual scripted attempts through local store, repair, approve, reload, injected claim rejection and three-failure override; zero fetches | Full journey test SOURCE exists; no browser or test run performed | `npx vitest run tests/lib/demo/journey.test.ts`; after M5, manually repeat PLAN 1.1 in browser Offline Demo, both with and without configured backend variables |
| 24 | M2 integer cost helpers and UTF-16 cited pointers | Test source only | `npx vitest run tests/lib/callledger/cost.test.ts tests/lib/cited/pointer.test.ts` |
| 25 | Recording identity and LLM coverage integration | Scripted mode remains active; M4 generator is not built yet; live judging is not validated | M4 generator must use `recordingKey(model, messages, maxTokens)` with current prompt/mask versions; run `npm run recordings`, switch `MOCK_SOURCE` to `recordings`, then `npm test` and `npm run eval -- --mock`. M3/M4 must append coverage flags from `llmCoverageDrafts` on the selected attempt before freezing evidence |

## Known M1 extractor limitations (by design or not yet handled)

- Numbers: negative signs are dropped (`-5` reads as 5); European separators (`1.200.000`) and spelled fractions other
  than `half` ("a third") are not recognised; "two million three hundred thousand" stops at the first magnitude; a
  bare attached `s` is a seconds unit only on numbers of up to three digits ("30s"), so decades ("1990s") are not
  numbers; "$5-7M" applies the right-hand magnitude to both ends.
- Only `50% of the <noun>` normalises to `fraction 0.5 <noun>`, matching `half the <noun>` with that same head.
  Other percentages retain their percentage normalisation; the fraction form does not match a bare `50%` in a rewrite.
- Dates: year-less dates take chrono's implied year from the frozen reference time (so the browser's display ledger
  can differ from the server's frozen ledger, as PLAN section 6.2 states); zones are compared as written (offset when
  chrono is certain, otherwise the abbreviation, otherwise `local`), never converted.
- Entities: capitalised words after a colon or inside parentheses count as mid-sentence; Markdown heading words need a
  licence (mid-sentence capitalisation elsewhere, acronym, mixed case or protected term); multi-word runs are compared
  as a whole, so a rewrite that splits "Acme Cloud" into "Acme" fails unless an alias is declared.
- Quotes: a verbatim span fully inside a quote is absorbed into the quote (the whole quote is masked and compared
  byte-for-byte); a quote that only partly overlaps a verbatim span loses to it. Single straight quotes are recognised
  only when they open at a word start and close before a non-letter.
- Mask namespace: the hash input is `${seedId}|${MASK_VERSION}|${counter}` (the plan's "seed id + MASK_VERSION +
  counter" with `|` separators to avoid ambiguous concatenation).

## M2 construction limits

- All M2 tests are source only. A successful syntax gate says nothing about imports, types, assertions or the scripted
  journey's runtime outcome. The exact two-hard-failure and hard-clean repair assertions must be checked against
  chrono-node and entity segmentation after installation.
- Demo samples are deliberately short; style distance is disabled with a reason. Full 600-word voices and fixture
  JSON tables arrive in M4. The bundled demo table already uses the `ScriptsTable` JSON shape and fails on unknown keys.
- Overlap thresholds remain uncalibrated. Lexical overlap is not entailment, and the scripted injection test covers
  its specific added sentence; it does not prove resistance to arbitrary prompt injection or relationship changes.
- Soft checks compare paragraphs by position when their counts agree. When counts differ, whole-text drift checks
  remain active and `paragraph_alignment_uncertain` always requires review: global balance cannot establish that
  negation or modal strength stayed with the same claim. This conservative advisory also flags benign paragraph reflow;
  merge/split regressions through `step()` are test source only and remain unexecuted.
- The inherited optional LLM caller seam is retained with a 30-pair / 4-batch hard cap. Its strict parser has test
  source, but server reservation, persistence and UI coverage wiring belong to later milestones.
- Cost estimation uses UTF-8 bytes plus message overhead as a conservative estimate for byte-based tokenizers, not an
  invoice guarantee. Provider-specific token accounting, prices, budgets and live reservation enforcement await M3/M4.

## M3 server-seam deferred validation

M3 added source for the live store, two authenticated Edge Functions, durable provider-call orchestration,
configuration probing, generated local libraries and tests. No application module, generator, test, backend or
provider was run. Each function's 56-module `_lib` closure was mechanically produced by file processing using the
same transform declared in `sync-function-libs.ts`: static import closure, CRLF-to-LF, pinned `npm:` specifiers,
generated comment, and SHA-256 over raw-source/transformed UTF-8 bytes. Runtime parity remains unverified.

| What | Exact later command / steps |
|---|---|
| Browser/store and orchestration types/imports | `npm run typecheck`; `npm run lint` |
| Strict API, ownership source contract and generated-copy/hash parity | `npx vitest run tests/contracts/functions.test.ts`; `npm run sync:functions`, inspect diff, rerun parity |
| Durable dispatch/replay, stale reserved provider/model identity and increased price/token-limit refusal before claim with zero-cost failure, matching reserved resume, configuration-independent settled cache replay, unknown outcomes, B3 three-phase/single-attempt flow, stored repair provenance, source-hash/toggle refusal and unavailable judge recovery | `npx vitest run tests/lib/server/server.test.ts` |
| Lazy anonymous session, raw-only insert, wire mapping and refusal of browser evidence writes | `npx vitest run tests/lib/store/supabaseStore.test.ts`; manually verify zero backend requests in Offline Demo even with public env vars set |
| Deno imports, function main entrypoints and platform config | `deno check supabase/functions/rewrite/index.ts supabase/functions/judge/index.ts`; deploy only these two functions with JWT verification and anonymous auth enabled |
| Real JWT/ownership/CORS/body boundary | Send missing/invalid JWT, other user's run ID, wrong origin, OPTIONS, wrong method/content-type, invalid JSON and >4096-byte body; verify refused run requests make zero service RPC/provider calls |
| Configuration probe without a paid call | Authenticated POST `{ "probe": true }` to either function. Verify configured=false until actual model IDs, provider key/base URL, prices, LIVE_CALLS_ENABLED, APP_ORIGIN and DB budget_limits.live_enabled are configured. Response exposes booleans only |
| SQL/function signature and transaction compatibility | Apply all five migrations; execute tests/sql definitions; exercise freeze clock -> freeze inputs -> begin -> reserve -> claim -> settle with response -> complete -> finish; prove B3 exactly three ledger phases and B4 at most three attempts |
| Concurrency and crash windows | Concurrent/repeated/changed-request-key calls must never double dispatch a phase. Interrupt after reserve, claim, provider reply, response settlement and attempt completion. Reserved phases resume only with matching run/attempt/function/purpose/provider/model and enough held money for the current conservative cost; stale configuration terminates at zero cost before claim. Race that termination against a claim and verify SQL refuses a failed/zero settlement after dispatching. Settled cached replies replay independently of current configuration; dispatching never auto-redispatches |
| Rewrite crash recovery with no durable reply | Owner settles stuck dispatching as unknown, calls fail_attempt with state unknown, then finish_attempts with an error. HTTP retry does not infer failure from elapsed time. Unknown retains full reservation and has no fabricated content |
| Judge lifetime bounds/recovery | Repeat judge requests with new keys: deterministic batch keys 0..3, <=30 pairs each, <=4 dispatches/run. finalize_unavailable=true makes zero paid calls and conservatively terminates pending residue before sealing coverage. Missing config ->503; budget ->429 after partial evidence is safely sealed |
| Provider models/prices/usage and actual live availability | Verify exact model IDs, pinned dependencies and price units against current official docs, then owner-authorised live canary. Post-dispatch failures and actual usage above reservation remain unknown outcomes retaining reservation |

`runOnStore` remains local-only. Live callers use `createSupabaseStore(client)` and its `requestRewrite`,
`requestJudge`, `probeConfiguration`; live `appendAttempt`/`finishRun` refuse browser evidence. Instantiate/probe
only after explicit live exploration, never on Offline Demo mount. B0 supports a server check without a paid call;
B1 is computed by the eval harness and the live endpoint returns `computed_baseline_local_only`. DB mock rows never
reach a live provider. Nested Fact/Flag JSON remains camelCase; ruling replay uses monotonic SQL sequence. A judge
provider/budget refusal can seal partial evidence and return an error; callers reload persisted state after errors.
No backend error silently chooses Demo. Syntax parsing is the only executed code check; it proves no runtime behavior.
