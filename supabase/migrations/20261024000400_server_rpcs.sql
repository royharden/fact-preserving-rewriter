-- All writes below are a server seam. Never expose the service role key to the browser.
create function public.freeze_run_inputs(
  p_run uuid,p_source_hash text default null,p_ledger jsonb default null,p_mask_namespace text default null,
  p_checker_version text default null,p_prompt_version text default null,p_mask_version text default null,
  p_reference_time timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rewrite_runs; k text;
begin
  select * into strict r from public.rewrite_runs where id=p_run for update;
  if r.status<>'open' then raise exception 'invalid_run_state'; end if;
  if p_source_hash is null then
    if p_ledger is not null or p_mask_namespace is not null or p_reference_time is not null
      or p_checker_version is not null or p_prompt_version is not null or p_mask_version is not null then
      raise exception 'incomplete_freeze'; end if;
    if r.reference_time is null then
      update public.rewrite_runs set reference_time=clock_timestamp() where id=r.id returning * into r;
    end if;
    return to_jsonb(r);
  end if;
  if r.reference_time is null or p_reference_time is distinct from r.reference_time then raise exception 'reference_time_mismatch'; end if;
  if p_source_hash is distinct from encode(sha256(convert_to(r.source_text,'UTF8')),'hex') then raise exception 'source_hash_mismatch'; end if;
  if p_ledger is null or jsonb_typeof(p_ledger)<>'array' or (r.system='B4' and p_mask_namespace is null)
    or p_checker_version is null or p_prompt_version is null or p_mask_version is null
    or length(p_checker_version)=0 or length(p_prompt_version)=0 or length(p_mask_version)=0 then raise exception 'incomplete_freeze'; end if;
  for k in select jsonb_object_keys(r.toggles) loop
    if coalesce(r.toggles->>k,'') not in ('required','ignored') or not exists(select 1 from jsonb_array_elements(p_ledger) f where f->>'id'=k) then
      raise exception 'unknown_toggle:%', k;
    end if;
  end loop;
  if r.source_hash is not null then
    if row(r.source_hash,r.ledger,r.mask_namespace,r.checker_version,r.prompt_version,r.mask_version)
      is distinct from row(p_source_hash,p_ledger,p_mask_namespace,p_checker_version,p_prompt_version,p_mask_version) then
      raise exception 'inputs_already_frozen'; end if;
    return to_jsonb(r);
  end if;
  update public.rewrite_runs set source_hash=p_source_hash,ledger=p_ledger,mask_namespace=p_mask_namespace,
    checker_version=p_checker_version,prompt_version=p_prompt_version,mask_version=p_mask_version
    where id=r.id returning * into r;
  return to_jsonb(r);
end $$;

create function public.begin_attempt(p_run uuid,p_expected_ordinal integer,p_request_key text,p_repair_request jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rewrite_runs; a public.attempts; prev public.attempts; n integer;
begin
  select * into strict r from public.rewrite_runs where id=p_run for update;
  if r.status='review_ready' then raise exception 'evidence_immutable'; end if;
  select * into a from public.attempts where request_key=p_request_key;
  if found then
    if a.run_id<>p_run or a.ordinal<>p_expected_ordinal or a.repair_request is distinct from p_repair_request then
      raise exception 'idempotency_conflict'; end if;
    return to_jsonb(a);
  end if;
  if r.status not in ('open','attempting') or r.source_hash is null or r.ledger is null then raise exception 'inputs_not_frozen'; end if;
  if exists(select 1 from public.attempts where run_id=r.id and state='in_flight') then raise exception 'attempt_in_flight'; end if;
  select count(*)::integer+1 into n from public.attempts where run_id=r.id;
  if p_expected_ordinal is null or p_expected_ordinal<>n or n>case when r.system='B4' then 3 else 1 end then
    raise exception 'invalid_ordinal'; end if;
  if n>1 then
    select * into strict prev from public.attempts where run_id=r.id and ordinal=n-1;
    if prev.state<>'complete' or not exists(select 1 from jsonb_array_elements(prev.flags) f where f->>'class'='hard') then
      raise exception 'retry_requires_hard_failure'; end if;
    if p_repair_request is null or (p_repair_request->>'fromOrdinal')::integer is distinct from prev.ordinal
      or p_repair_request->>'version' is distinct from 'repair-v1'
      or jsonb_typeof(p_repair_request->'items') is distinct from 'array'
      or jsonb_array_length(p_repair_request->'items')=0 then raise exception 'repair_required'; end if;
    if exists(select 1 from jsonb_array_elements(p_repair_request->'items') i where not exists(
      select 1 from jsonb_array_elements(prev.flags) f where f->>'class'='hard' and f->>'id'=i->>'flagId')) then
      raise exception 'repair_not_from_hard_flags'; end if;
  elsif p_repair_request is not null then raise exception 'first_attempt_has_no_repair'; end if;
  insert into public.attempts(run_id,ordinal,request_key,repair_request)
    values(r.id,n,p_request_key,p_repair_request) returning * into a;
  update public.rewrite_runs set status='attempting' where id=r.id;
  return to_jsonb(a);
end $$;

create unique index model_phase_once on public.call_ledger(attempt_id,purpose) where purpose<>'judge';

create function public.reserve_model_call(p_run uuid,p_attempt uuid,p_idempotency_key text,p_function text,
  p_purpose text,p_provider text,p_model text,p_reserved_micro_usd bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rewrite_runs; a public.attempts; c public.call_ledger; lim public.budget_limits;
  rc public.budget_counters; uc public.budget_counters; gc public.budget_counters; al public.eval_allowances;
  d date := (clock_timestamp() at time zone 'UTC')::date; uk text; rk text; cap integer; purpose_calls integer;
begin
  select * into strict r from public.rewrite_runs where id=p_run for update;
  if r.status='review_ready' then raise exception 'evidence_immutable'; end if;
  select * into c from public.call_ledger where idempotency_key=p_idempotency_key;
  if found then
    if row(c.run_id,c.attempt_id,c.function,c.purpose,c.provider,c.model,c.reserved_micro_usd)
      is distinct from row(p_run,p_attempt,p_function,p_purpose,p_provider,p_model,p_reserved_micro_usd) then
      raise exception 'idempotency_conflict'; end if;
    return to_jsonb(c);
  end if;
  select * into strict a from public.attempts where id=p_attempt and run_id=p_run;
  if r.system in ('B0','B1') then raise exception 'deterministic_system_no_model'; end if;
  if p_reserved_micro_usd is null or p_reserved_micro_usd<0 or p_purpose is null
    or p_purpose not in ('rewrite','b3_check','b3_revise','judge') then raise exception 'invalid_reservation'; end if;
  if p_purpose='judge' then
    if p_function is distinct from 'judge' or r.system<>'B4' or r.status<>'judging'
      or r.selected_attempt_id is distinct from a.id or a.state<>'complete' then raise exception 'invalid_judge_target'; end if;
  else
    if p_function is distinct from 'rewrite' or r.status<>'attempting' or a.state<>'in_flight' then raise exception 'invalid_attempt_state'; end if;
    if p_purpose in ('b3_check','b3_revise') and r.system<>'B3' then raise exception 'invalid_phase'; end if;
    if exists(select 1 from public.call_ledger where attempt_id=a.id and purpose=p_purpose) then raise exception 'phase_already_reserved'; end if;
    if p_purpose='b3_check' and not exists(select 1 from public.call_ledger where attempt_id=a.id and purpose='rewrite' and status='settled') then
      raise exception 'draft_not_settled'; end if;
    if p_purpose='b3_revise' and not exists(select 1 from public.call_ledger where attempt_id=a.id and purpose='b3_check' and status='settled') then
      raise exception 'check_not_settled'; end if;
  end if;
  select * into strict lim from public.budget_limits where singleton;
  if r.mode='live' and (not lim.live_enabled or p_provider='mock') then raise exception 'provider_not_configured'; end if;
  if r.mode='mock' and (p_provider is distinct from 'mock' or p_reserved_micro_usd<>0) then raise exception 'invalid_mock_reservation'; end if;
  if p_reserved_micro_usd>lim.per_call_micro_usd then raise exception 'budget_exceeded:call'; end if;
  cap := case p_purpose when 'rewrite' then least(lim.per_run_rewrite_calls,case when r.system='B4' then 3 else 1 end)
    when 'b3_check' then lim.per_run_b3_check_calls when 'b3_revise' then lim.per_run_b3_revise_calls else lim.per_run_judge_calls end;
  select count(*) into purpose_calls from public.call_ledger where run_id=r.id and purpose=p_purpose;
  if purpose_calls>=cap then raise exception 'budget_exceeded:run'; end if;
  uk := encode(sha256(convert_to(r.user_id::text,'UTF8')),'hex'); rk := r.id::text;
  -- Fixed lock order across reserve, settlement and erasure: run, run counter, user, global, allowance, ledger.
  insert into public.budget_counters(scope,scope_key,day) values('run',rk,date '1970-01-01') on conflict do nothing;
  select * into strict rc from public.budget_counters where scope='run' and scope_key=rk and day=date '1970-01-01' for update;
  insert into public.budget_counters(scope,scope_key,day) values('user',uk,d) on conflict do nothing;
  select * into strict uc from public.budget_counters where scope='user' and scope_key=uk and day=d for update;
  insert into public.budget_counters(scope,scope_key,day) values('global','global',d) on conflict do nothing;
  select * into strict gc from public.budget_counters where scope='global' and scope_key='global' and day=d for update;
  -- The newest active owner grant takes precedence, including when exhausted (never fall back to daily caps).
  select * into al from public.eval_allowances where user_id=r.user_id and expires_at>clock_timestamp()
    order by created_at desc,id desc limit 1 for update;
  if rc.micro_usd+p_reserved_micro_usd>lim.per_run_micro_usd then raise exception 'budget_exceeded:run'; end if;
  if al.id is not null then
    if al.used_calls+1>al.max_calls or al.used_micro_usd+p_reserved_micro_usd>al.max_micro_usd then raise exception 'budget_exceeded:allowance'; end if;
    update public.eval_allowances set used_calls=used_calls+1,used_micro_usd=used_micro_usd+p_reserved_micro_usd where id=al.id;
  else
    if uc.calls+1>lim.per_user_day_calls or uc.micro_usd+p_reserved_micro_usd>lim.per_user_day_micro_usd then raise exception 'budget_exceeded:user'; end if;
    if gc.calls+1>lim.global_day_calls or gc.micro_usd+p_reserved_micro_usd>lim.global_day_micro_usd then raise exception 'budget_exceeded:global'; end if;
  end if;
  update public.budget_counters set calls=calls+1,micro_usd=micro_usd+p_reserved_micro_usd
    where (scope='run' and scope_key=rk and day=date '1970-01-01')
      or (scope='user' and scope_key=uk and day=d) or (scope='global' and scope_key='global' and day=d);
  insert into public.call_ledger(idempotency_key,user_id,run_id,attempt_id,function,purpose,provider,model,
    reserved_micro_usd,budget_day,user_budget_key,run_budget_key,allowance_id)
    values(p_idempotency_key,r.user_id,r.id,a.id,p_function,p_purpose,p_provider,p_model,
      p_reserved_micro_usd,d,uk,rk,al.id) returning * into c;
  return to_jsonb(c);
end $$;

create function public.claim_dispatch(p_call uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.call_ledger; r public.rewrite_runs;
begin
  select * into strict c from public.call_ledger where id=p_call;
  select * into r from public.rewrite_runs where id=c.run_id for update;
  if r.id is null or r.status='review_ready' then return false; end if;
  update public.call_ledger set status='dispatching' where id=p_call and status='reserved';
  return found;
end $$;

create function public.settle_model_call(p_call uuid,p_status text,p_actual_micro_usd bigint default null,
  p_input_tokens bigint default null,p_output_tokens bigint default null,p_response_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.call_ledger; latest public.call_ledger; refund bigint; billed bigint;
begin
  select * into strict c from public.call_ledger where id=p_call;
  -- Accounting can finish after evidence sealing or erasure, but never modifies evidence.
  perform 1 from public.rewrite_runs where id=c.run_id for update;
  perform 1 from public.budget_counters where scope='run' and scope_key=c.run_budget_key and day=date '1970-01-01' for update;
  perform 1 from public.budget_counters where scope='user' and scope_key=c.user_budget_key and day=c.budget_day for update;
  perform 1 from public.budget_counters where scope='global' and scope_key='global' and day=c.budget_day for update;
  perform 1 from public.eval_allowances where id=c.allowance_id for update;
  select * into strict latest from public.call_ledger where id=p_call for update;
  if latest.status in ('settled','failed','unknown') then return to_jsonb(latest); end if;
  c := latest;
  if p_status is null or p_status not in ('settled','failed','unknown') then raise exception 'invalid_settlement'; end if;
  if p_status='settled' and (c.status<>'dispatching' or p_actual_micro_usd is null or p_actual_micro_usd<0 or p_actual_micro_usd>c.reserved_micro_usd) then
    raise exception 'invalid_actual_cost'; end if;
  -- A dispatching failure may have reached the provider: settle unknown unless an actual successful bill is known.
  if p_status='failed' and (c.status<>'reserved' or coalesce(p_actual_micro_usd,0)<>0) then raise exception 'dispatched_failure_must_be_unknown'; end if;
  if p_status='unknown' and c.status<>'dispatching' then raise exception 'unknown_requires_dispatch'; end if;
  if p_input_tokens<0 or p_output_tokens<0 then raise exception 'invalid_token_usage'; end if;
  billed := case p_status when 'unknown' then c.reserved_micro_usd when 'failed' then 0 else p_actual_micro_usd end;
  refund := c.reserved_micro_usd-billed;
  update public.budget_counters set micro_usd=micro_usd-refund
    where (scope='run' and scope_key=c.run_budget_key and day=date '1970-01-01')
      or (scope='user' and scope_key=c.user_budget_key and day=c.budget_day)
      or (scope='global' and scope_key='global' and day=c.budget_day);
  if c.allowance_id is not null then update public.eval_allowances set used_micro_usd=used_micro_usd-refund where id=c.allowance_id; end if;
  update public.call_ledger set status=p_status,actual_micro_usd=case when p_status='unknown' then null else billed end,
    input_tokens=p_input_tokens,output_tokens=p_output_tokens,
    response_payload=case when c.user_id is not null and p_status='settled' then p_response_payload else null end,
    settled_at=clock_timestamp() where id=c.id returning * into c;
  return to_jsonb(c);
end $$;

create function public.complete_attempt(p_attempt uuid,p_output_text text,p_content_hash text,p_flags jsonb,
  p_verdict text,p_claim_status text,p_judge_coverage jsonb,p_style_distance double precision default null,p_style_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.attempts; r public.rewrite_runs; v text;
begin
  select * into strict a from public.attempts where id=p_attempt;
  select * into strict r from public.rewrite_runs where id=a.run_id for update;
  select * into strict a from public.attempts where id=p_attempt for update;
  if r.status<>'attempting' or a.state<>'in_flight' then raise exception 'invalid_attempt_state'; end if;
  if exists(select 1 from public.call_ledger where attempt_id=a.id and status in ('reserved','dispatching')) then raise exception 'call_not_settled'; end if;
  if exists(select 1 from public.call_ledger where attempt_id=a.id and status in ('failed','unknown')) then raise exception 'attempt_has_failed_call'; end if;
  if r.system not in ('B0','B1') and not exists(select 1 from public.call_ledger where attempt_id=a.id and purpose='rewrite' and status='settled') then
    raise exception 'rewrite_call_required'; end if;
  if r.system='B3' and (select count(*) from public.call_ledger where attempt_id=a.id and purpose in ('rewrite','b3_check','b3_revise') and status='settled')<>3 then
    raise exception 'b3_phases_required'; end if;
  if p_output_text is null or p_content_hash is distinct from encode(sha256(convert_to(p_output_text,'UTF8')),'hex') then raise exception 'content_hash_mismatch'; end if;
  if not coalesce(public.flags_valid(p_flags),false) then raise exception 'invalid_flags'; end if;
  if p_claim_status is distinct from 'overlap_only' then raise exception 'judging_not_yet_allowed'; end if;
  v := public.flags_verdict(p_flags);
  if p_verdict is distinct from v then raise exception 'verdict_mismatch'; end if;
  update public.attempts set state='complete',output_text=p_output_text,content_hash=p_content_hash,
    flags=p_flags,verdict=v,claim_status=p_claim_status,judge_coverage=p_judge_coverage,
    style_distance=p_style_distance,style_reason=p_style_reason where id=a.id returning * into a;
  update public.rewrite_runs set evidence_version=evidence_version+1 where id=r.id;
  return to_jsonb(a);
end $$;

create function public.fail_attempt(p_attempt uuid,p_state text,p_error text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.attempts; r public.rewrite_runs;
begin
  select * into strict a from public.attempts where id=p_attempt;
  select * into strict r from public.rewrite_runs where id=a.run_id for update;
  select * into strict a from public.attempts where id=p_attempt for update;
  if r.status<>'attempting' or a.state<>'in_flight' then raise exception 'invalid_attempt_state'; end if;
  if p_state is null or p_state not in ('call_failed','unknown') or length(btrim(coalesce(p_error,'')))=0 then raise exception 'invalid_failure'; end if;
  if exists(select 1 from public.call_ledger where attempt_id=a.id and status in ('reserved','dispatching')) then raise exception 'call_not_settled'; end if;
  update public.attempts set state=p_state,error=p_error where id=a.id returning * into a;
  update public.rewrite_runs set error=p_error,evidence_version=evidence_version+1 where id=r.id;
  return to_jsonb(a);
end $$;

create function public.finish_attempts(p_run uuid,p_judge_enabled boolean default false,p_error text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rewrite_runs; a public.attempts; err text; n integer;
begin
  select * into strict r from public.rewrite_runs where id=p_run for update;
  if r.status<>'attempting' then raise exception 'invalid_run_state'; end if;
  if exists(select 1 from public.attempts where run_id=r.id and state='in_flight')
    or exists(select 1 from public.call_ledger where run_id=r.id and status in ('reserved','dispatching')) then raise exception 'operation_in_flight'; end if;
  err := coalesce(nullif(btrim(p_error),''),r.error);
  if exists(select 1 from public.attempts where run_id=r.id and state in ('call_failed','unknown')) then err:=coalesce(err,'operational_incomplete'); end if;
  select * into a from public.attempts a0 where a0.run_id=r.id and a0.state='complete'
    order by (select count(*) from jsonb_array_elements(a0.flags) f where f->>'class'='hard'),
      (select count(*) from jsonb_array_elements(a0.flags) f where f->>'class' in ('soft','claim')),a0.ordinal limit 1;
  if a.id is not null and r.system='B4' and err is null and a.verdict='failed'
    and (select count(*) from public.attempts where run_id=r.id)<3 then raise exception 'hard_failure_requires_retry_or_error'; end if;
  if a.id is not null and err is not null then
    select coalesce(max(substring(f->>'id' from 2)::integer),0)+1 into n from jsonb_array_elements(a.flags) f where f->>'class'='coverage';
    update public.attempts set flags=flags || jsonb_build_array(jsonb_build_object('id','G'||n,'class','coverage',
      'code','operational_incomplete','found',err)),verdict=case when verdict='failed' then 'failed' else 'needs_review' end,error=err
      where id=a.id returning * into a;
  end if;
  update public.rewrite_runs set selected_attempt_id=a.id,verdict=a.verdict,error=case when a.id is null then coalesce(err,'no_completed_attempt') else err end,
    status=case when a.id is not null and err is null and p_judge_enabled and r.system='B4' then 'judging' else 'review_ready' end,
    evidence_version=evidence_version+1 where id=r.id returning * into r;
  return to_jsonb(r);
end $$;

create function public.finish_judging(p_run uuid,p_attempt uuid,p_flags jsonb,p_claim_status text,p_judge_coverage jsonb,p_error text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rewrite_runs; a public.attempts; fs jsonb; n integer; judged integer; total integer;
begin
  select * into strict r from public.rewrite_runs where id=p_run for update;
  if r.status<>'judging' or r.system<>'B4' or r.selected_attempt_id is distinct from p_attempt then raise exception 'invalid_judge_target'; end if;
  select * into strict a from public.attempts where id=p_attempt and run_id=p_run for update;
  if exists(select 1 from public.call_ledger where run_id=r.id and status in ('reserved','dispatching')) then raise exception 'call_not_settled'; end if;
  if p_claim_status is null or p_claim_status not in ('llm_done','llm_unavailable','truncated') then raise exception 'invalid_claim_status'; end if;
  -- New flag IDs begin after existing class maxima; validate the combined array for contiguous emission order.
  if p_flags is null or jsonb_typeof(p_flags)<>'array' or not coalesce(public.flags_valid(a.flags || p_flags),false)
    or exists(select 1 from jsonb_array_elements(p_flags) f where f->>'class' not in ('claim','coverage')) then
    raise exception 'invalid_judge_flags'; end if;
  if exists(select 1 from jsonb_array_elements(p_flags) f join jsonb_array_elements(a.flags) oldf on f->>'id'=oldf->>'id') then raise exception 'flag_id_collision'; end if;
  -- Appended IDs must exceed the maximum existing ID in that class; prior IDs and flags are never rewritten.
  if exists(select 1 from jsonb_array_elements(p_flags) f where substring(f->>'id' from 2)::integer <=
    (select coalesce(max(substring(oldf->>'id' from 2)::integer),0) from jsonb_array_elements(a.flags) oldf where oldf->>'class'=f->>'class')) then
    raise exception 'flag_id_not_append'; end if;
  if p_judge_coverage is null or jsonb_typeof(p_judge_coverage)<>'object'
    or not(p_judge_coverage ?& array['judged','total']) then raise exception 'invalid_coverage'; end if;
  judged := (p_judge_coverage->>'judged')::integer; total := (p_judge_coverage->>'total')::integer;
  if judged is null or total is null or judged<0 or total<judged or judged>120
    or (p_claim_status='llm_done' and judged<>total) or (p_claim_status='truncated' and judged>=total) then raise exception 'invalid_coverage'; end if;
  if p_claim_status='llm_done' and (p_error is not null or exists(select 1 from public.call_ledger where run_id=r.id and purpose='judge' and status in ('failed','unknown'))) then
    raise exception 'incomplete_judge'; end if;
  if judged>0 and not exists(select 1 from public.call_ledger where run_id=r.id and purpose='judge' and status='settled') then raise exception 'judge_call_required'; end if;
  fs := a.flags || p_flags;
  if p_claim_status in ('llm_unavailable','truncated') and not exists(select 1 from jsonb_array_elements(fs) f where f->>'class'='coverage' and f->>'code'=p_claim_status) then
    select coalesce(max(substring(f->>'id' from 2)::integer),0)+1 into n from jsonb_array_elements(fs) f where f->>'class'='coverage';
    fs := fs || jsonb_build_array(jsonb_build_object('id','G'||n,'class','coverage','code',p_claim_status,'found',coalesce(p_error,p_claim_status)));
  end if;
  update public.attempts set flags=fs,verdict=public.flags_verdict(fs),claim_status=p_claim_status,judge_coverage=p_judge_coverage,error=p_error
    where id=a.id returning * into a;
  update public.rewrite_runs set status='review_ready',verdict=a.verdict,error=p_error,evidence_version=evidence_version+1 where id=r.id returning * into r;
  return to_jsonb(r);
end $$;

revoke all on function public.freeze_run_inputs(uuid,text,jsonb,text,text,text,text,timestamptz),
  public.begin_attempt(uuid,integer,text,jsonb),public.reserve_model_call(uuid,uuid,text,text,text,text,text,bigint),
  public.claim_dispatch(uuid),public.settle_model_call(uuid,text,bigint,bigint,bigint,jsonb),
  public.complete_attempt(uuid,text,text,jsonb,text,text,jsonb,double precision,text),public.fail_attempt(uuid,text,text),
  public.finish_attempts(uuid,boolean,text),public.finish_judging(uuid,uuid,jsonb,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.freeze_run_inputs(uuid,text,jsonb,text,text,text,text,timestamptz),
  public.begin_attempt(uuid,integer,text,jsonb),public.reserve_model_call(uuid,uuid,text,text,text,text,text,bigint),
  public.claim_dispatch(uuid),public.settle_model_call(uuid,text,bigint,bigint,bigint,jsonb),
  public.complete_attempt(uuid,text,text,jsonb,text,text,jsonb,double precision,text),public.fail_attempt(uuid,text,text),
  public.finish_attempts(uuid,boolean,text),public.finish_judging(uuid,uuid,jsonb,text,jsonb,text) to service_role;
