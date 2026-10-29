begin;
insert into auth.users(id,aud,role) values('10000000-0000-0000-0000-000000000001','authenticated','authenticated');
update public.budget_limits set live_enabled=true,per_user_day_calls=0,global_day_calls=0;
insert into public.eval_allowances(user_id,expires_at,max_calls,max_micro_usd,approved_by,note)
 values('10000000-0000-0000-0000-000000000001',clock_timestamp()+interval '1 hour',1,100000,'SQL test owner','Synthetic test allowance');
insert into public.rewrite_runs(id,user_id,source_text,samples,system,mode) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Synthetic source.','["Synthetic sample."]','B3','live');
do $$
declare rid uuid:='20000000-0000-0000-0000-000000000001'; r jsonb; a jsonb; c jsonb;
begin
  r:=public.freeze_run_inputs(rid);
  perform public.freeze_run_inputs(rid,encode(sha256(convert_to('Synthetic source.','UTF8')),'hex'),'[]','abc123','c','p','m',(r->>'reference_time')::timestamptz);
  a:=public.begin_attempt(rid,1,'allowance-first');
  c:=public.reserve_model_call(rid,(a->>'id')::uuid,'allowance-draft','rewrite','rewrite','anthropic','synthetic-model',40000);
  if (select used_calls from public.eval_allowances)<>1 or (select calls from public.budget_counters where scope='global')<>1 then raise exception 'allowance/reporting not incremented'; end if;
  perform public.claim_dispatch((c->>'id')::uuid);
  perform public.settle_model_call((c->>'id')::uuid,'unknown');
  perform public.settle_model_call((c->>'id')::uuid,'settled',0);
  if (select micro_usd from public.budget_counters where scope='user')<>40000
    or (select used_micro_usd from public.eval_allowances)<>40000 then raise exception 'unknown refunded'; end if;
  perform public.fail_attempt((a->>'id')::uuid,'unknown','Synthetic uncertain provider outcome');
  r:=public.finish_attempts(rid,false);
  if r->>'selected_attempt_id' is not null or r->>'verdict' is not null then raise exception 'failed call created exportable content'; end if;
  begin
    perform public.begin_attempt(rid,2,'illegal-b3-retry'); raise exception 'B3 retried';
  exception when raise_exception then if sqlerrm<>'evidence_immutable' then raise; end if; end;
  rid:='20000000-0000-0000-0000-000000000002';
  insert into public.rewrite_runs(id,user_id,source_text,samples,system,mode)
    values(rid,'10000000-0000-0000-0000-000000000001','Synthetic source.','["Synthetic sample."]','B2','live');
  r:=public.freeze_run_inputs(rid);
  perform public.freeze_run_inputs(rid,encode(sha256(convert_to('Synthetic source.','UTF8')),'hex'),'[]',null,'c','p','m',(r->>'reference_time')::timestamptz);
  a:=public.begin_attempt(rid,1,'second-allowance-first');
  begin
    perform public.reserve_model_call(rid,(a->>'id')::uuid,'second-allowance-call','rewrite','rewrite','anthropic','synthetic-model',10000);
    raise exception 'exhausted allowance bypassed';
  exception when raise_exception then if sqlerrm<>'budget_exceeded:allowance' then raise; end if; end;
  if (select calls from public.budget_counters where scope='global')<>1 or (select used_calls from public.eval_allowances)<>1 then raise exception 'rejected reservation changed counters'; end if;
end $$;
rollback;
