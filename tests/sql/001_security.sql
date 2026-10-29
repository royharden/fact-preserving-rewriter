-- Run AFTER all five migrations in a disposable Supabase-compatible database as the SQL owner.
-- No test source has been executed during Dirty Mode. Every file rolls its fixtures back.
begin;
insert into auth.users(id,aud,role) values
 ('10000000-0000-0000-0000-000000000001','authenticated','authenticated'),
 ('10000000-0000-0000-0000-000000000002','authenticated','authenticated');

do $$
declare tbl text; fn record;
begin
  foreach tbl in array array['style_profiles','rewrite_runs','attempts','rulings','call_ledger','budget_counters','budget_limits','eval_allowances'] loop
    if not (select relrowsecurity from pg_class where oid=('public.'||tbl)::regclass) then raise exception 'RLS absent: %',tbl; end if;
    if has_table_privilege('authenticated','public.'||tbl,'UPDATE,DELETE') then raise exception 'client mutation grant: %',tbl; end if;
  end loop;
  if exists(select 1 from pg_policies where schemaname='public' and tablename in
    ('style_profiles','rewrite_runs','attempts','rulings','call_ledger','budget_counters','budget_limits','eval_allowances')
    and cmd in ('UPDATE','DELETE','ALL')) then raise exception 'client update/delete policy'; end if;
  for fn in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('freeze_run_inputs','begin_attempt','reserve_model_call','claim_dispatch',
      'settle_model_call','complete_attempt','fail_attempt','finish_attempts','finish_judging') loop
    if not fn.prosecdef or not coalesce('search_path=public, pg_temp'=any(fn.proconfig),false)
      or has_function_privilege('authenticated',fn.oid,'EXECUTE') or has_function_privilege('anon',fn.oid,'EXECUTE')
      or not has_function_privilege('service_role',fn.oid,'EXECUTE') then raise exception 'RPC grant/search_path: %',fn.proname; end if;
  end loop;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
insert into public.rewrite_runs(id,user_id,source_text,samples)
 values('20000000-0000-0000-0000-000000000001',auth.uid(),'Synthetic source.','["Synthetic sample."]');
do $$
begin
  if (select count(*) from public.rewrite_runs)<>1 then raise exception 'owner cannot read'; end if;
  begin
    insert into public.rewrite_runs(user_id,source_text,samples,reference_time)
      values(auth.uid(),'Invalid derived insert.','["Sample."]',clock_timestamp());
    raise exception 'derived insert accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.rewrite_runs(user_id,source_text,samples,status)
      values(auth.uid(),'Invalid state.','["Sample."]','review_ready');
    raise exception 'finalized client insert accepted';
  exception when insufficient_privilege then null; end;
  begin
    update public.rewrite_runs set source_text='tampered';
    raise exception 'client update accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.attempts(run_id,ordinal,request_key) values('20000000-0000-0000-0000-000000000001',1,'forged');
    raise exception 'client attempt accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.budget_limits;
    raise exception 'budget readable';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ begin
  if exists(select 1 from public.rewrite_runs) then raise exception 'cross-user read'; end if;
  if public.can_export('30000000-0000-0000-0000-000000000001') then raise exception 'unknown export'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.rewrite_runs; raise exception 'anonymous read accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.delete_my_data(); raise exception 'anonymous RPC accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
