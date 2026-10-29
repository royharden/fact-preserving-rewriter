-- Mock provider ledger operations only; SQL definitions never executed during construction.
begin;
insert into auth.users(id,aud,role) values('10000000-0000-0000-0000-000000000001','authenticated','authenticated');
insert into public.rewrite_runs(id,user_id,source_text,samples,system,mode) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Synthetic source.','["Synthetic sample."]','B4','mock');
do $$
declare rid uuid:='20000000-0000-0000-0000-000000000001'; r jsonb; a jsonb; c jsonb;
begin
  r:=public.freeze_run_inputs(rid);
  perform public.freeze_run_inputs(rid,encode(sha256(convert_to('Synthetic source.','UTF8')),'hex'),'[]','abc123','c','p','m',(r->>'reference_time')::timestamptz);
  a:=public.begin_attempt(rid,1,'judging-first');
  c:=public.reserve_model_call(rid,(a->>'id')::uuid,'judging-draft','rewrite','rewrite','mock','synthetic-model',0);
  perform public.claim_dispatch((c->>'id')::uuid);
  perform public.settle_model_call((c->>'id')::uuid,'settled',0,0,0,'{"rewrite":"Synthetic source."}');
  a:=public.complete_attempt((a->>'id')::uuid,'Synthetic source.',encode(sha256(convert_to('Synthetic source.','UTF8')),'hex'),
    '[]','pass','overlap_only','{"judged":0,"total":2}');
  begin
    perform public.finish_judging(rid,(a->>'id')::uuid,'[]','llm_unavailable','{"judged":0,"total":2}');
    raise exception 'judging finalized from attempting';
  exception when raise_exception then if sqlerrm<>'invalid_judge_target' then raise; end if; end;
  r:=public.finish_attempts(rid,true);
  if r->>'status'<>'judging' then raise exception 'judge stage missing'; end if;
  begin
    perform public.finish_judging(rid,'30000000-0000-0000-0000-000000000009','[]','llm_unavailable','{"judged":0,"total":2}');
    raise exception 'wrong judge target accepted';
  exception when raise_exception then if sqlerrm<>'invalid_judge_target' then raise; end if; end;
  r:=public.finish_judging(rid,(a->>'id')::uuid,'[]','llm_unavailable','{"judged":0,"total":2}','Synthetic unavailable');
  if r->>'status'<>'review_ready' or r->>'verdict'<>'needs_review' then raise exception 'unavailable became pass'; end if;
  if not exists(select 1 from public.attempts where id=(a->>'id')::uuid and flags @> '[{"id":"G1","class":"coverage","code":"llm_unavailable"}]') then
    raise exception 'unavailable evidence missing'; end if;
  begin
    perform public.finish_judging(rid,(a->>'id')::uuid,'[]','llm_done','{"judged":2,"total":2}');
    raise exception 'sealed evidence changed';
  exception when raise_exception then if sqlerrm<>'invalid_judge_target' then raise; end if; end;
  perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
  begin
    perform public.record_ruling((a->>'id')::uuid,'approve',null,'[]',a->>'content_hash',(r->>'evidence_version')::integer);
    raise exception 'coverage acknowledgement omitted';
  exception when raise_exception then if sqlerrm<>'flags_not_acknowledged' then raise; end if; end;
  perform public.record_ruling((a->>'id')::uuid,'approve',null,'["G1"]',a->>'content_hash',(r->>'evidence_version')::integer);
  if not public.can_export((a->>'id')::uuid) then raise exception 'coverage acknowledged export blocked'; end if;
end $$;
rollback;
