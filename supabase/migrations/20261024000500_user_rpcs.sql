-- These entrypoints derive ownership from the JWT; no caller-supplied owner ID is accepted.
create function public.record_ruling(p_attempt uuid,p_decision text,p_reason text,p_acknowledged_flags jsonb,
  p_expected_hash text,p_evidence_version integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); a public.attempts; r public.rewrite_runs; result public.rulings;
begin
  if u is null then raise exception 'authentication_required'; end if;
  select * into a from public.attempts where id=p_attempt;
  if a.id is null then raise exception 'ruling_target_not_found'; end if;
  select * into r from public.rewrite_runs where id=a.run_id and user_id=u for update;
  if r.id is null then raise exception 'ruling_target_not_found'; end if;
  select * into strict a from public.attempts where id=p_attempt;
  if r.status<>'review_ready' or r.selected_attempt_id is distinct from a.id or a.state<>'complete' then raise exception 'invalid_ruling_target'; end if;
  if p_expected_hash is distinct from a.content_hash or p_evidence_version is distinct from r.evidence_version then raise exception 'stale_evidence'; end if;
  if p_decision is null or p_decision not in ('approve','reject','override') then raise exception 'invalid_decision'; end if;
  if p_acknowledged_flags is null or jsonb_typeof(p_acknowledged_flags)<>'array'
    or exists(select 1 from jsonb_array_elements(p_acknowledged_flags) f where jsonb_typeof(f)<>'string') then raise exception 'invalid_acknowledgements'; end if;
  if p_decision='approve' then
    if a.verdict not in ('pass','needs_review') then raise exception 'failed_requires_override'; end if;
    if exists(select 1 from jsonb_array_elements_text(p_acknowledged_flags) ack where not exists(
      select 1 from jsonb_array_elements(a.flags) f where f->>'class' in ('soft','claim','coverage') and f->>'id'=ack)) then
      raise exception 'unknown_acknowledgement'; end if;
    if a.verdict='needs_review' and exists(select 1 from jsonb_array_elements(a.flags) f
      where f->>'class' in ('soft','claim','coverage') and not(p_acknowledged_flags @> jsonb_build_array(f->>'id'))) then
      raise exception 'flags_not_acknowledged'; end if;
  elsif p_decision='override' then
    if a.verdict<>'failed' then raise exception 'override_only_failed'; end if;
    if length(btrim(coalesce(p_reason,'')))<10 then raise exception 'override_reason_too_short'; end if;
  end if;
  insert into public.rulings(user_id,run_id,attempt_id,content_hash,evidence_version,decision,reason,acknowledged_flags)
    values(u,r.id,a.id,a.content_hash,r.evidence_version,p_decision,nullif(btrim(p_reason),''),p_acknowledged_flags)
    returning * into result;
  return to_jsonb(result);
end $$;

create function public.can_export(p_attempt uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); a public.attempts; r public.rewrite_runs; ruling public.rulings;
begin
  if u is null then raise exception 'authentication_required'; end if;
  select * into a from public.attempts where id=p_attempt;
  if a.id is null then return false; end if;
  select * into r from public.rewrite_runs where id=a.run_id and user_id=u;
  if r.id is null or r.status<>'review_ready' or r.selected_attempt_id is distinct from a.id or a.state<>'complete' then return false; end if;
  select * into ruling from public.rulings where attempt_id=a.id and user_id=u and content_hash=a.content_hash
    and evidence_version=r.evidence_version order by sequence desc limit 1;
  return coalesce(ruling.decision in ('approve','override'),false);
end $$;

create function public.delete_my_data() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'authentication_required'; end if;
  -- Lock before detaching calls: reserve/claim/settle all take the parent run lock first.
  perform 1 from public.rewrite_runs where user_id=u order by id for update;
  update public.call_ledger set user_id=null,run_id=null,attempt_id=null,response_payload=null where user_id=u;
  -- No counter deletion or money refund: erasure must not reset the user's retained pseudonymous daily cap.
  update public.eval_allowances set user_id=null where user_id=u;
  delete from public.rewrite_runs where user_id=u; -- cascades attempts and rulings
  delete from public.style_profiles where user_id=u;
end $$;

revoke all on function public.record_ruling(uuid,text,text,jsonb,text,integer),public.can_export(uuid),public.delete_my_data()
  from public,anon,authenticated;
grant execute on function public.record_ruling(uuid,text,text,jsonb,text,integer),public.can_export(uuid),public.delete_my_data()
  to authenticated;

-- Trigger functions cannot be used as ordinary RPCs; explicit grants keep the callable surface narrow.
revoke all on function public.guard_run_update(),public.guard_attempt_update() from public,anon,authenticated;
revoke all on function public.valid_samples(jsonb),public.flags_valid(jsonb),public.flags_verdict(jsonb) from public,anon,authenticated;
grant execute on function public.valid_samples(jsonb) to authenticated,service_role;
grant execute on function public.flags_valid(jsonb),public.flags_verdict(jsonb) to service_role;
