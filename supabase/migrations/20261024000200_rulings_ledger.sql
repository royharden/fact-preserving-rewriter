create table public.rulings (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'rewrite' check(kind='rewrite'),
  run_id uuid not null references public.rewrite_runs(id) on delete cascade,
  attempt_id uuid not null,
  content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
  evidence_version integer not null,
  decision text not null check(decision in ('approve','reject','override')),
  reason text,
  acknowledged_flags jsonb not null default '[]' check(jsonb_typeof(acknowledged_flags)='array'),
  local_demo boolean not null default false check(not local_demo),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(run_id,attempt_id) references public.attempts(run_id,id) on delete cascade
);
create index rulings_latest on public.rulings(attempt_id,sequence desc);

create table public.budget_limits (
  singleton boolean primary key default true check(singleton),
  live_enabled boolean not null default false,
  per_run_rewrite_calls integer not null default 3 check(per_run_rewrite_calls between 0 and 3),
  per_run_b3_check_calls integer not null default 1 check(per_run_b3_check_calls between 0 and 1),
  per_run_b3_revise_calls integer not null default 1 check(per_run_b3_revise_calls between 0 and 1),
  per_run_judge_calls integer not null default 4 check(per_run_judge_calls between 0 and 4),
  per_run_micro_usd bigint not null default 150000 check(per_run_micro_usd>=0),
  per_user_day_calls integer not null default 40 check(per_user_day_calls>=0),
  per_user_day_micro_usd bigint not null default 500000 check(per_user_day_micro_usd>=0),
  global_day_calls integer not null default 600 check(global_day_calls>=0),
  global_day_micro_usd bigint not null default 2000000 check(global_day_micro_usd>=0),
  per_call_micro_usd bigint not null default 50000 check(per_call_micro_usd>=0)
);
insert into public.budget_limits(singleton) values(true);

create table public.budget_counters (
  scope text not null check(scope in ('run','user','global')),
  scope_key text not null, -- user key = SHA-256 of UUID, retained after erasure; no source/sample bodies
  day date not null,
  calls bigint not null default 0 check(calls>=0),
  micro_usd bigint not null default 0 check(micro_usd>=0),
  primary key(scope,scope_key,day)
);

create table public.eval_allowances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  max_calls bigint not null check(max_calls>=0),
  max_micro_usd bigint not null check(max_micro_usd>=0),
  used_calls bigint not null default 0 check(used_calls>=0 and used_calls<=max_calls),
  used_micro_usd bigint not null default 0 check(used_micro_usd>=0 and used_micro_usd<=max_micro_usd),
  approved_by text not null check(length(btrim(approved_by))>0),
  note text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index eval_allowances_owner on public.eval_allowances(user_id,expires_at);

create table public.call_ledger (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check(length(idempotency_key) between 1 and 300),
  user_id uuid references auth.users(id) on delete set null,
  run_id uuid references public.rewrite_runs(id) on delete set null,
  attempt_id uuid references public.attempts(id) on delete set null,
  function text not null check(function in ('rewrite','judge')),
  purpose text not null check(purpose in ('rewrite','b3_check','b3_revise','judge')),
  provider text not null check(provider in ('mock','anthropic','openai_compatible')),
  model text not null check(length(btrim(model))>0),
  reserved_micro_usd bigint not null check(reserved_micro_usd>=0),
  actual_micro_usd bigint check(actual_micro_usd>=0 and actual_micro_usd<=reserved_micro_usd),
  input_tokens bigint check(input_tokens>=0),
  output_tokens bigint check(output_tokens>=0),
  status text not null default 'reserved' check(status in ('reserved','dispatching','settled','failed','unknown')),
  -- Response cache supports crash-safe deterministic judge batches; erased with user content.
  response_payload jsonb,
  budget_day date not null,
  user_budget_key text not null,
  run_budget_key text not null,
  allowance_id uuid references public.eval_allowances(id),
  created_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz
);
create index call_ledger_run on public.call_ledger(run_id,purpose);
