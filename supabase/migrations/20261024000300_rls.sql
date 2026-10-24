alter table public.style_profiles enable row level security;
alter table public.rewrite_runs enable row level security;
alter table public.attempts enable row level security;
alter table public.rulings enable row level security;
alter table public.call_ledger enable row level security;
alter table public.budget_counters enable row level security;
alter table public.budget_limits enable row level security;
alter table public.eval_allowances enable row level security;

revoke all on public.style_profiles,public.rewrite_runs,public.attempts,public.rulings,
  public.call_ledger,public.budget_counters,public.budget_limits,public.eval_allowances from anon,authenticated;
grant select,insert on public.style_profiles,public.rewrite_runs to authenticated;
grant select on public.attempts,public.rulings,public.call_ledger to authenticated;
grant all on public.style_profiles,public.rewrite_runs,public.attempts,public.rulings,
  public.call_ledger,public.budget_counters,public.budget_limits,public.eval_allowances to service_role;
grant usage,select on sequence public.rulings_sequence_seq to service_role;

create policy profiles_read_own on public.style_profiles for select to authenticated using(user_id=(select auth.uid()));
create policy profiles_insert_own on public.style_profiles for insert to authenticated with check(user_id=(select auth.uid()));
create policy runs_read_own on public.rewrite_runs for select to authenticated using(user_id=(select auth.uid()));
create policy runs_insert_raw on public.rewrite_runs for insert to authenticated with check(
  user_id=(select auth.uid()) and status='open' and evidence_version=0 and selected_attempt_id is null
  and verdict is null and error is null and not local_demo
  and source_hash is null and ledger is null and mask_namespace is null and reference_time is null
  and checker_version is null and prompt_version is null and mask_version is null
  and (profile_id is null or exists(select 1 from public.style_profiles p where p.id=profile_id and p.user_id=(select auth.uid())))
);
create policy attempts_read_own on public.attempts for select to authenticated using(
  exists(select 1 from public.rewrite_runs r where r.id=run_id and r.user_id=(select auth.uid())));
create policy rulings_read_own on public.rulings for select to authenticated using(
  exists(select 1 from public.rewrite_runs r where r.id=run_id and r.user_id=(select auth.uid())));
create policy calls_read_own on public.call_ledger for select to authenticated using(
  user_id=(select auth.uid()) and exists(select 1 from public.rewrite_runs r where r.id=run_id and r.user_id=(select auth.uid())));
-- No UPDATE/DELETE client policies, and no client policies on budget tables or eval_allowances.
