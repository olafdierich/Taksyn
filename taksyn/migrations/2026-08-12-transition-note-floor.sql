-- Taksyn migration: 10-character floor on incident_transition notes.
-- 12 August 2026. Closure and backwards-move notes were merely non-empty,
-- so "x" satisfied them. The two RPCs written today require 10 characters.
-- DERIVED via pg_get_functiondef + sed, not retyped. Prior md5 on both
-- environments: 1d863d795c3e648cf471a841913f1a6c

CREATE OR REPLACE FUNCTION public.incident_transition(p_incident_id bigint, p_to_status text, p_note text DEFAULT NULL::text)
 RETURNS incidents
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_inc     public.incidents;
  v_role    text;
  v_name    text;
  v_from    text;
  v_from_ix int;
  v_to_ix   int;
  v_kind    text;
  v_event   text;
  v_order   constant text[] :=
    array['reported','assessing','investigating','actions_open','review','closed'];
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if public.is_super_admin() then
    raise exception 'Platform administrators cannot alter an organisation''s incident workflow'
      using errcode = '42501';
  end if;

  select * into v_inc from public.incidents where id = p_incident_id;
  if not found then
    raise exception 'Incident not found or not visible' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.org_members m
   where m.user_id = auth.uid()
     and m.org = v_inc.org
     and m.is_active is not false;

  if v_role is null then
    raise exception 'Not an active member of this organisation' using errcode = '42501';
  end if;

  v_from    := v_inc.status;
  v_from_ix := array_position(v_order, v_from);
  v_to_ix   := array_position(v_order, p_to_status);

  if v_to_ix is null then
    raise exception 'Unknown status %', p_to_status using errcode = '22023';
  end if;

  if v_to_ix = v_from_ix then
    raise exception 'Incident is already at %', p_to_status using errcode = '22023';
  end if;

  if v_from = 'closed' and p_to_status = 'review' then
    v_kind := 'reopen';  v_event := 'reopened';
  elsif v_to_ix = v_from_ix + 1 then
    v_kind := 'forward';
    v_event := case when p_to_status = 'investigating' then 'investigation_started'
                    when p_to_status = 'closed'        then 'closed'
                    else 'status_changed' end;
  elsif v_to_ix = v_from_ix - 1 then
    v_kind := 'reverse'; v_event := 'status_reverted';
  else
    raise exception 'Cannot move from % to % — steps must be taken in order', v_from, p_to_status
      using errcode = '22023';
  end if;

  if v_kind = 'forward' and p_to_status = 'closed' then
    if v_role <> 'client_admin' then
      raise exception 'Only a client admin may close an incident' using errcode = '42501';
    end if;
    if p_note is null or length(btrim(p_note)) < 10 then
      raise exception 'A closure note of at least 10 characters is required' using errcode = '22023';
    end if;

  elsif v_kind = 'forward' then
    if v_role not in ('supervisor','manager','client_admin') then
      raise exception 'Your role may not advance an incident' using errcode = '42501';
    end if;
    if v_role <> 'client_admin'
       and v_inc.assigned_to     is distinct from auth.uid()
       and v_inc.investigator_id is distinct from auth.uid() then
      raise exception 'Only the assigned handler or investigator may advance this incident'
        using errcode = '42501';
    end if;

  else
    if v_role <> 'client_admin' then
      raise exception 'Only a client admin may move an incident backwards' using errcode = '42501';
    end if;
    if p_note is null or length(btrim(p_note)) < 10 then
      raise exception 'A note of at least 10 characters is required when moving an incident backwards' using errcode = '22023';
    end if;
  end if;

  select p.name into v_name from public.profiles p where p.id = auth.uid();

  update public.incidents
     set status       = p_to_status,
         updated_at   = now(),
         closed_at    = case when p_to_status = 'closed' then now()
                             when v_kind = 'reopen'      then null
                             else closed_at end,
         closure_note = case when p_to_status = 'closed' then p_note else closure_note end
   where id = p_incident_id
  returning * into v_inc;

  insert into public.incident_events
    (incident_id, org, event_type, by_id, by_name, by_role, from_value, to_value, details)
  values
    (p_incident_id, v_inc.org, v_event, auth.uid(), v_name, v_role, v_from, p_to_status,
     case when p_note is null then null else jsonb_build_object('note', p_note) end);

  -- ADDED 10 Aug 2026 (step 4b). Seed the investigation and RCA findings on
  -- entry to investigating. Idempotent; a reverse-then-forward cannot wipe or
  -- duplicate existing answers. Inside this transaction by design.
  if p_to_status = 'investigating' then
    perform public.seed_incident_findings(p_incident_id);
  end if;

  return v_inc;
end;
$function$

