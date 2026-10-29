SQL definitions are source-only. They have never been applied or run.

After Dirty Mode closes, use a disposable Supabase-compatible database with `auth.users`, `auth.uid()`, and the `anon`, `authenticated`, `service_role` roles. Apply the five migrations in lexical order as the SQL owner. Run each script separately with `psql "$env:S37_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/001_security.sql` (then `002_workflow_accounting.sql`, `003_allowance_unknown.sql`, and `004_judging.sql`). Every script rolls its fixtures back. No provider calls are involved.

Required additional runtime checks before release:

- Use two simultaneous database sessions against different runs of the same user with one remaining daily call and insufficient money for both. Race `reserve_model_call`; exactly one succeeds and every failed reservation leaves all counters unchanged. Repeat for two users against the global cap, for a shared allowance, and for two same-key requests. Inspect all three counter scopes and allowance counters.
- Race two `claim_dispatch` calls; one returns true. Simulate a crash after dispatch, settle `unknown`, and confirm no reservation is refunded and no repeated dispatch occurs. Confirm a reserved call can settle `failed` with zero cost while a dispatched call cannot.
- Exercise B4 hard-fail retries through ordinal 3, attempt ordinal conflicts and repair payloads, B0/B1 refusal to reserve any model call, and B2/B3 ordinal >1 refusal before finalization. For B3 require draft/check/revision settlements in order.
- Exercise judge resume with deterministic batch keys and cached response payloads, ≤4 batches, combined contiguous claim/coverage IDs, partial coverage, unavailable finalization, wrong selection, wrong run status, and all evidence mutation RPCs after `review_ready`.
- Exercise failed-attempt override reason length, stale hash/version rulings, unselected/foreign attempts, unknown acknowledgements, approve/reject ordering, and erasure while provider settlement is pending. After erasure, verify no content/cache links remain, pending settlements cannot restore response bodies, and the retained user-day cap still applies to new runs under the same auth user.

Runtime SQL parsing, role behavior, isolation, deadlock behavior, and PostgREST RPC serialization remain unverified. Static inspection alone does not establish any of those properties.
