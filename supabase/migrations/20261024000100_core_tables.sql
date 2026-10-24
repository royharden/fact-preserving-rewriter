-- S37: SQL source only; migration execution and all security behavior remain unverified.
create function public.valid_samples(p_value jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(p_value) <> 'array' then false else
    jsonb_array_length(p_value) between 1 and 5
    and not exists (select 1 from jsonb_array_elements(p_value) x
      where jsonb_typeof(x) <> 'string' or length(btrim(x #>> '{}')) = 0)
    and coalesce((select sum(octet_length(x #>> '{}')) from jsonb_array_elements(p_value) x),0) <= 20480 end
$$;

create function public.flags_valid(p_flags jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(p_flags) <> 'array' then false else
    not exists (select 1 from jsonb_array_elements(p_flags) f
      where jsonb_typeof(f) <> 'object' or not (f ?& array['id','class','code','found'])
        or jsonb_typeof(f->'id') <> 'string' or jsonb_typeof(f->'code') <> 'string'
        or jsonb_typeof(f->'found') <> 'string' or jsonb_typeof(f->'class') <> 'string'
        or (f->>'class') not in ('hard','soft','claim','coverage')
        or (f->>'id') !~ ('^' || case f->>'class' when 'hard' then 'H' when 'soft' then 'S' when 'claim' then 'C' else 'G' end || '[1-9][0-9]*$'))
    and (select count(*) = count(distinct f->>'id') from jsonb_array_elements(p_flags) f)
    and not exists(select 1 from (
      select f, row_number() over(partition by f->>'class' order by ord) n
      from jsonb_array_elements(p_flags) with ordinality t(f,ord)
    ) numbered where substring(f->>'id' from 2)::numeric<>n) end
$$;

create function public.flags_verdict(p_flags jsonb) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when exists(select 1 from jsonb_array_elements(p_flags) f where f->>'class'='hard') then 'failed'
    when jsonb_array_length(p_flags)>0 then 'needs_review' else 'pass' end
$$;

create table public.style_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  samples jsonb not null check (public.valid_samples(samples)),
  profile jsonb check (profile is null or jsonb_typeof(profile)='object'),
  created_at timestamptz not null default clock_timestamp()
);

create table public.rewrite_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  system text not null default 'B4' check (system in ('B0','B1','B2','B3','B4')),
  mode text not null default 'live' check (mode in ('mock','live')),
  source_id text,
  voice_id text,
  profile_id uuid references public.style_profiles(id) on delete set null,
  source_text text not null check (length(btrim(source_text))>0 and octet_length(source_text)<=30720),
  samples jsonb not null check (public.valid_samples(samples)),
  toggles jsonb not null default '{}' check (jsonb_typeof(toggles)='object'),
  aliases jsonb not null default '{}' check (jsonb_typeof(aliases)='object'),
  protected_terms jsonb not null default '[]' check (jsonb_typeof(protected_terms)='array'),
  source_hash text check (source_hash is null or source_hash ~ '^[a-f0-9]{64}$'),
  ledger jsonb check (ledger is null or jsonb_typeof(ledger)='array'),
  mask_namespace text check (mask_namespace is null or mask_namespace ~ '^[a-z0-9]{6}$'),
  reference_time timestamptz, -- no default: the service freeze RPC sets the server clock once
  checker_version text,
  prompt_version text,
  mask_version text,
  status text not null default 'open' check (status in ('open','attempting','judging','review_ready')),
  evidence_version integer not null default 0 check (evidence_version>=0),
  selected_attempt_id uuid,
  verdict text check (verdict in ('pass','needs_review','failed')),
  error text,
  local_demo boolean not null default false check (not local_demo),
  created_at timestamptz not null default clock_timestamp()
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.rewrite_runs(id) on delete cascade,
  ordinal integer not null check (ordinal between 1 and 3),
  request_key text not null unique check (length(request_key) between 1 and 200),
  state text not null default 'in_flight' check (state in ('in_flight','complete','call_failed','unknown')),
  output_text text check (output_text is null or octet_length(output_text)<=65536),
  content_hash text check (content_hash is null or content_hash ~ '^[a-f0-9]{64}$'),
  flags jsonb not null default '[]' check (public.flags_valid(flags)),
  repair_request jsonb check (repair_request is null or jsonb_typeof(repair_request)='object'),
  verdict text check (verdict in ('pass','needs_review','failed')),
  claim_status text check (claim_status in ('overlap_only','llm_done','llm_unavailable','truncated')),
  judge_coverage jsonb,
  style_distance double precision,
  style_reason text,
  error text,
  created_at timestamptz not null default clock_timestamp(),
  unique(run_id,ordinal),
  unique(run_id,id),
  check ((state='complete' and output_text is not null and content_hash is not null and verdict is not null)
      or (state<>'complete' and output_text is null and content_hash is null and verdict is null)),
  check (judge_coverage is null or (jsonb_typeof(judge_coverage)='object' and judge_coverage ?& array['judged','total']
    and jsonb_typeof(judge_coverage->'judged')='number' and jsonb_typeof(judge_coverage->'total')='number'
    and (judge_coverage->>'judged')::integer>=0
    and (judge_coverage->>'total')::integer >= (judge_coverage->>'judged')::integer))
);
alter table public.rewrite_runs add constraint selected_attempt_belongs_to_run
  foreign key (id,selected_attempt_id) references public.attempts(run_id,id) deferrable initially deferred;
create index rewrite_runs_owner on public.rewrite_runs(user_id,created_at desc);

-- A last-line guard protects frozen evidence even from accidental direct service writes.
create function public.guard_run_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status='review_ready' then raise exception 'evidence_immutable'; end if;
  if row(new.user_id,new.source_text,new.samples,new.system,new.mode,new.source_id,new.voice_id,
      new.toggles,new.aliases,new.protected_terms,new.local_demo,new.created_at)
    is distinct from row(old.user_id,old.source_text,old.samples,old.system,old.mode,old.source_id,old.voice_id,
      old.toggles,old.aliases,old.protected_terms,old.local_demo,old.created_at) then
    raise exception 'raw_inputs_immutable';
  end if;
  if old.source_hash is not null and row(new.source_hash,new.ledger,new.mask_namespace,new.reference_time,
      new.checker_version,new.prompt_version,new.mask_version)
    is distinct from row(old.source_hash,old.ledger,old.mask_namespace,old.reference_time,
      old.checker_version,old.prompt_version,old.mask_version) then raise exception 'frozen_inputs_immutable'; end if;
  if old.reference_time is not null and new.reference_time is distinct from old.reference_time then
    raise exception 'reference_time_immutable'; end if;
  return new;
end $$;
create trigger guard_run_update before update on public.rewrite_runs for each row execute function public.guard_run_update();

create function public.guard_attempt_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if exists(select 1 from public.rewrite_runs where id=old.run_id and status='review_ready') then
    raise exception 'evidence_immutable'; end if;
  if row(new.run_id,new.ordinal,new.request_key,new.created_at) is distinct from
     row(old.run_id,old.ordinal,old.request_key,old.created_at) then raise exception 'attempt_identity_immutable'; end if;
  return new;
end $$;
create trigger guard_attempt_update before update on public.attempts for each row execute function public.guard_attempt_update();
