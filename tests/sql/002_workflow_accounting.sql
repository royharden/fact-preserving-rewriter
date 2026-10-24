-- SQL owner, fresh disposable database; source-only test definitions. No provider/network calls.
begin;
insert into auth.users(id,aud,role) values('10000000-0000-0000-0000-000000000001','authenticated','authenticated');
update public.budget_limits set live_enabled=true,per_user_day_calls=1,global_day_calls=1;
insert into public.rewrite_runs(id,user_id,source_text,samples,system,mode) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Synthetic source.','["Synthetic sample."]','B4','live');
do $$
declare rid uuid:='20000000-0000-0000-0000-000000000001'; r jsonb; a jsonb; c jsonb; other jsonb; reference timestamptz;
begin
  r:=public.freeze_run_inputs(rid); reference:=(r->>'reference_time')::timestamptz;
  if reference is null then raise exception 'server time not frozen'; end if;
  r:=public.freeze_run_inputs(rid);
  if (r->>'reference_time')::timestamptz<>reference then raise exception 'reference clock moved'; end if;
  r:=public.freeze_run_inputs(rid,encode(sha256(convert_to('Synthetic source.','UTF8')),'hex'),'[]','abc123','check-v1','prompt-v1','mask-v1',reference);
  a:=public.begin_attempt(rid,1,'workflow-first');
  other:=public.begin_attempt(rid,1,'workflow-first');
  if a->>'id'<>other->>'id' then raise exception 'attempt idempotency'; end if;
  c:=public.reserve_model_call(rid,(a->>'id')::uuid,'workflow-call','rewrite','rewrite','anthropic','synthetic-model',40000);
  other:=public.reserve_model_call(rid,(a->>'id')::uuid,'workflow-call','rewrite','rewrite','anthropic','synthetic-model',40000);
  if c->>'id'<>other->>'id' or (select calls from public.budget_counters where scope='global')<>1 then raise exception 'reservation idempotency'; end if;
  if not public.claim_dispatch((c->>'id')::uuid) or public.claim_dispatch((c->>'id')::uuid) then raise exception 'dispatch not single claimant'; end if;
  c:=public.settle_model_call((c->>'id')::uuid,'settled',25000,20,10,'{"rewrite":"Synthetic source."}');
  other:=public.settle_model_call((c->>'id')::uuid,'settled',1,0,0,'{}');
  if (other->>'actual_micro_usd')::bigint<>25000 or (select micro_usd from public.budget_counters where scope='global')<>25000 then raise exception 'settlement applied twice'; end if;
  a:=public.complete_attempt((a->>'id')::uuid,'Synthetic source.',encode(sha256(convert_to('Synthetic source.','UTF8')),'hex'),
    '[{"id":"S1","class":"soft","code":"modal_drift","found":"may"}]','needs_review','overlap_only','{"judged":0,"total":0}');
  r:=public.finish_attempts(rid,false);
  if r->>'status'<>'review_ready' or r->>'selected_attempt_id'<>a->>'id' then raise exception 'selection/state'; end if;
  begin
    perform public.finish_attempts(rid,false); raise exception 'sealed run mutated';
  exception when raise_exception then if sqlerrm<>'invalid_run_state' then raise; end if; end;
  perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
  begin
    perform public.record_ruling((a->>'id')::uuid,'approve',null,'[]',a->>'content_hash',(r->>'evidence_version')::integer);
    raise exception 'unacknowledged approval';
  exception when raise_exception then if sqlerrm<>'flags_not_acknowledged' then raise; end if; end;
  perform public.record_ruling((a->>'id')::uuid,'approve',null,'["S1"]',a->>'content_hash',(r->>'evidence_version')::integer);
  if not public.can_export((a->>'id')::uuid) then raise exception 'approved export blocked'; end if;
  perform public.record_ruling((a->>'id')::uuid,'reject',null,'[]',a->>'content_hash',(r->>'evidence_version')::integer);
  if public.can_export((a->>'id')::uuid) then raise exception 'reject failed to revoke'; end if;
  perform public.delete_my_data();
  if exists(select 1 from public.rewrite_runs) or exists(select 1 from public.attempts) or exists(select 1 from public.rulings) then raise exception 'erasure retained content rows'; end if;
  if exists(select 1 from public.call_ledger where user_id is not null or run_id is not null or attempt_id is not null or response_payload is not null) then raise exception 'erasure retained cache/link'; end if;
  if (select calls from public.budget_counters where scope='user')<>1 or (select micro_usd from public.budget_counters where scope='user')<>25000 then raise exception 'erasure reset cap'; end if;
  insert into public.rewrite_runs(id,user_id,source_text,samples,system,mode)
    values(rid,'10000000-0000-0000-0000-000000000001','Synthetic source.','["Synthetic sample."]','B2','live');
  r:=public.freeze_run_inputs(rid);
  perform public.freeze_run_inputs(rid,encode(sha256(convert_to('Synthetic source.','UTF8')),'hex'),'[]',null,'c','p','m',(r->>'reference_time')::timestamptz);
  a:=public.begin_attempt(rid,1,'post-erasure-first');
  begin
    perform public.reserve_model_call(rid,(a->>'id')::uuid,'post-erasure-call','rewrite','rewrite','anthropic','synthetic-model',10000);
    raise exception 'erasure bypassed daily cap';
  exception when raise_exception then if sqlerrm<>'budget_exceeded:user' then raise; end if; end;
end $$;
rollback;
