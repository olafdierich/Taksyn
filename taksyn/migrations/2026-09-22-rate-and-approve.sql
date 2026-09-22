create or replace function public.rate_and_approve_task(
  p_task_id text, p_rating int, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_t    tasks%rowtype;
  v_org  text;
  v_name text;
  v_rsn  text := nullif(btrim(coalesce(p_reason,'')),'');
begin
  if v_uid is null then
    raise exception 'RATE-APPROVE: requires a signed-in user' using errcode='42501';
  end if;
  v_t := (select t from tasks t where t.id = p_task_id);
  if v_t.id is null then
    raise exception 'RATE-APPROVE: task % not found', p_task_id using errcode='22023';
  end if;
  v_org := org_id_for(v_t.org);
  if not ( coalesce(v_t.approver_id,'') = v_uid::text or is_org_admin(v_org) ) then
    raise exception 'RATE-APPROVE: only the named approver or an org admin may approve and rate'
      using errcode='42501';
  end if;
  if v_t.status <> 'awaiting_review' then
    raise exception 'RATE-APPROVE: task is %, not awaiting review', v_t.status using errcode='22023';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'RATE-APPROVE: rating must be 1 to 5' using errcode='22023';
  end if;
  if p_rating < 3 and v_rsn is null then
    raise exception 'RATE-APPROVE: a rating below 3 needs a reason' using errcode='22023';
  end if;
  v_name := (select p.name from profiles p where p.id = v_uid);

  insert into task_rating_events
    (org_id, subject_kind, subject_id, event_kind, rating, reason, actor_id, actor_name, source)
  values (v_org, 'task', p_task_id, 'rated', p_rating, v_rsn, v_uid, v_name, 'user');

  update tasks
     set status = 'approved', reviewed_at = now(),
         quality_rating = p_rating, rating_reason = v_rsn,
         rated_by_id = v_uid, rated_by_name = v_name, rated_at = now()
   where id = p_task_id;
end
$fn$;

grant execute on function public.rate_and_approve_task(text,int,text) to authenticated;
