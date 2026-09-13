-- ===========================================================================
-- Taksyn migration -- incident authority fixes (four SECURITY DEFINER functions)
-- 11 September 2026
--
-- WHY
-- All four run SECURITY DEFINER, so the incidents RLS policies do NOT apply
-- inside them: each must check the caller itself. Four did not check enough,
-- and two of the holes crossed organisations.
--
--   incident_rate_risk      read profiles.role and never checked the org. ANY
--                           signed-in user could change the risk rating on ANY
--                           incident in ANY organisation, given its id -- and
--                           ids are sequential.
--   incident_edit_narrative checked membership but not authority, so ANY member
--                           could rewrite what happened on an open incident.
--   incident_edit_action    read profiles.role with no org check, so a
--   incident_void_action    client_admin of ANY organisation passed.
--
-- profiles.role is global and goes stale; org_members.role is per-organisation
-- and is what the RLS policies gate on. my_role_in(org) reads the latter.
--
-- THE BLANK-SAFE COMPARISON IS LOAD-BEARING
-- The first fix used "v_inc.assigned_to = v_uid". On an UNASSIGNED incident that
-- is NULL, not false, so the refusal never fired and any manager passed. A
-- behaviour test caught it; reading the code had not. Every handler check here
-- uses IS NOT DISTINCT FROM, as incident_transition already did.
--
-- AUTHORITY AFTER THIS MIGRATION
--   rate_risk, edit_narrative : client_admin, or the MANAGER assigned_to or
--                               investigator_id on that incident. Closed
--                               incidents stay client_admin-only.
--   edit_action, void_action  : client_admin OF THAT ORGANISATION.
--
-- incident_edit_action also carries the corrective-action changes of the same
-- day (CA-DB-V1): a reassigned owner must be a manager or client_admin of that
-- organisation, and the linked task keeps " - <incident ref>" in its title.
--
-- VERIFIED on sandbox by impersonating five callers per function inside a
-- rolled-back block (CHK-DB-12, CHK-DB-16c): 18 of 18 as designed, each refused
-- for the right reason.
--
-- SAFE TO RE-RUN. CREATE OR REPLACE only; no data touched.
-- Applied to SANDBOX and LIVE 11 Sep 2026 via the SQL editor.
--
-- VERIFY after running on a rebuilt database -- these must match:
--   incident_edit_action     8c097356fd
--   incident_edit_narrative  5027d78725
--   incident_rate_risk       0177af744a
--   incident_void_action     ca2d3e83d8
-- select p.proname, left(md5(p.prosrc),10) from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname in
--   ('incident_rate_risk','incident_edit_narrative','incident_edit_action','incident_void_action')
--  order by p.proname;
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.incident_edit_action(p_action_id bigint, p_description text, p_owner_id uuid, p_due_date date, p_reason text)
 RETURNS incident_actions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_act      public.incident_actions;
  v_inc      public.incidents;
  v_uid      uuid := auth.uid();
  v_name     text;
  v_role     text;
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_desc     text := btrim(coalesce(p_description, ''));
  v_owner_nm text;
  v_task_st  text;
  v_changes  jsonb := '{}'::jsonb;
  v_fields   text[] := array[]::text[];
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  -- Lock the action for the duration. Two people editing the same action must
  -- serialise, or the second event records a "from" that was already replaced.
  select * into v_act
  from public.incident_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'Action % not found.', p_action_id using errcode = 'P0002';
  end if;

  select * into v_inc from public.incidents where id = v_act.incident_id;
  if not found then
    raise exception 'Parent incident not found.' using errcode = 'P0002';
  end if;

  -- Caller identity read server-side, never passed in.
  -- SUP-DB-V1: role from ORG_MEMBERS for THIS incident's org (was profiles.role:
  -- global and stale, so a client admin of ANY organisation passed).
  select p.name into v_name from public.profiles p where p.id = v_uid;
  v_role := public.my_role_in(v_inc.org);

  if v_role is null then
    raise exception 'You are not a member of this organisation.' using errcode = '42501';
  end if;

  -- RULING 3 -- client_admin only.
  if v_role <> 'client_admin' then
    raise exception 'Only a client admin may edit a corrective action.'
      using errcode = '42501';
  end if;

  -- RULING 2 -- nothing to correct on a withdrawn action.
  if v_act.status = 'void' then
    raise exception
      'This action has been voided. Raise a new action rather than editing a withdrawn one.'
      using errcode = '22023';
  end if;

  -- RULING 1 -- approved means finished. Mirrors the void rule exactly.
  if v_act.task_id is not null then
    select t.status into v_task_st from public.tasks t where t.id = v_act.task_id;
    if v_task_st = 'approved' then
      raise exception
        'This action''s task has been completed and approved. It cannot be edited — '
        'the work was done and signed off. Raise a new action if something further is needed.'
        using errcode = '22023';
    end if;
  end if;

  -- Reason mandatory, with a floor.
  if length(v_reason) < 10 then
    raise exception
      'Give a reason for this change (at least 10 characters). It is recorded in the audit trail.'
      using errcode = '22023';
  end if;

  -- description is NOT NULL on the table and is what the worker is asked to do.
  if v_desc = '' then
    raise exception 'The action description cannot be left empty.' using errcode = '22023';
  end if;

  -- Resolve the owner's name server-side rather than trusting a client copy.
  -- An owner who is not a profile is rejected: an action assigned to nobody
  -- identifiable is not an assignment.
  if p_owner_id is not null then
    select p.name into v_owner_nm from public.profiles p where p.id = p_owner_id;
    if v_owner_nm is null then
      raise exception 'That person could not be found.' using errcode = '22023';
    end if;
    -- CA-DB-V1: the owner must be able to open the incident.
    if coalesce((select om.role from public.org_members om
                  where om.user_id::text = p_owner_id::text and om.org = v_inc.org limit 1), '')
       not in ('manager','client_admin') then
      raise exception 'The owner must be a manager or client admin of this organisation.' using errcode = '22023';
    end if;
  end if;

  -- RULING 5 -- record both sides of every field that actually changed.
  if v_desc is distinct from v_act.description then
    v_fields  := v_fields || array['description'];
    v_changes := v_changes || jsonb_build_object(
      'description', jsonb_build_object('from', v_act.description, 'to', v_desc));
  end if;

  if p_owner_id is distinct from v_act.owner_id then
    v_fields  := v_fields || array['owner'];
    v_changes := v_changes || jsonb_build_object(
      'owner', jsonb_build_object('from', v_act.owner_name, 'to', v_owner_nm));
  end if;

  if p_due_date is distinct from v_act.due_date then
    v_fields  := v_fields || array['due_date'];
    v_changes := v_changes || jsonb_build_object(
      'due_date', jsonb_build_object('from', v_act.due_date, 'to', p_due_date));
  end if;

  if array_length(v_fields, 1) is null then
    raise exception 'Nothing changed.' using errcode = '22023';
  end if;

  update public.incident_actions
     set description = v_desc,
         owner_id    = p_owner_id,
         owner_name  = v_owner_nm,
         due_date    = p_due_date
   where id = p_action_id
  returning * into v_act;

  -- THE LINKED TASK FOLLOWS. Same transaction: the incident record and the
  -- worker's task must never disagree about what was asked for, and the
  -- worker's copy is the one that gets acted on.
  --
  -- The task's ASSIGNEE is deliberately NOT changed here. Reassigning a task
  -- someone may already have started is a different act with its own history,
  -- and quietly moving it from inside an incident edit would hide that. The
  -- action's owner and the task's assignee can therefore diverge -- which is
  -- honest: the action records who is accountable, the task records who was
  -- given the work.
  if v_act.task_id is not null then
    update public.tasks
       set title      = v_desc || coalesce(' - ' || v_inc.ref, ''),  -- CA-DB-V1: keep the incident ref
           due_date   = coalesce(p_due_date, due_date),
           updated_at = now()
     where id = v_act.task_id;
  end if;

  insert into public.incident_events (
    incident_id, org, event_type, by_id, by_name, by_role,
    from_value, to_value, details
  ) values (
    v_act.incident_id, v_inc.org, 'action_edited', v_uid, v_name, v_role,
    array_to_string(v_fields, ','),
    v_reason,
    jsonb_build_object('reason', v_reason, 'action_id', p_action_id,
                       'task_id', v_act.task_id, 'changes', v_changes)
  );

  return v_act;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.incident_edit_narrative(p_incident_id bigint, p_facts text, p_immediate text, p_root_cause text, p_reason text)
 RETURNS incidents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inc      public.incidents;
  v_uid      uuid := auth.uid();
  v_name     text;
  v_role     text;
  v_org      text;
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_facts    text := btrim(coalesce(p_facts, ''));
  v_imm      text := nullif(btrim(coalesce(p_immediate, '')), '');
  v_root     text := nullif(btrim(coalesce(p_root_cause, '')), '');
  v_changes  jsonb := '{}'::jsonb;
  v_fields   text[] := array[]::text[];
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  -- Lock the row for the duration: two people editing the same narrative
  -- must serialise, or the second event records a "from" that was already
  -- superseded and the trail reads as though a change never happened.
  select * into v_inc
  from public.incidents
  where id = p_incident_id
  for update;

  if not found then
    raise exception 'Incident % not found.', p_incident_id using errcode = 'P0002';
  end if;

  -- Caller identity, read server-side. Never passed in by the client.
  select p.name, p.org
    into v_name, v_org
  from public.profiles p
  where p.id = v_uid;

  -- Role from ORG_MEMBERS, not profiles: the RLS policies gate on
  -- org_members.role and the two must not be able to disagree.
  -- super_admin exists only in profiles.role and therefore has no path
  -- through this gate, which is deliberate.
  v_role := public.my_role_in(v_inc.org);
  if v_role is null then
    raise exception 'You are not a member of this organisation.' using errcode = '42501';
  end if;

  -- SUP-DB-V1: an open incident's narrative may be edited only by a client admin
  -- or the manager handling it (was: any member). "is not distinct from" so an
  -- unassigned incident is a firm no, never an unknown that slips through.
  if v_role <> 'client_admin'
     and not (v_role = 'manager' and (v_inc.assigned_to is not distinct from v_uid
                                   or v_inc.investigator_id is not distinct from v_uid)) then
    raise exception 'Only a client admin, or the manager handling this incident, may edit its narrative.'
      using errcode = '42501';
  end if;

  -- RULING 3 -- authority depends on status.
  if v_inc.status = 'closed' and v_role <> 'client_admin' then
    raise exception
      'This incident is closed. Only a client admin may amend a closed record.'
      using errcode = '42501';
  end if;

  -- RULING 2 -- the reason is mandatory, with a floor.
  if length(v_reason) < 10 then
    raise exception
      'Give a reason for this edit (at least 10 characters). It is recorded in the audit trail.'
      using errcode = '22023';
  end if;

  -- facts is NOT NULL on the table and is the account of what happened.
  -- Refuse to blank it rather than let the constraint produce a worse message.
  if v_facts = '' then
    raise exception 'What happened cannot be left empty.' using errcode = '22023';
  end if;

  -- RULING 4 -- record both sides of every field that actually changed.
  if v_facts is distinct from v_inc.facts then
    v_fields  := v_fields || array['facts'];
    v_changes := v_changes || jsonb_build_object(
      'facts', jsonb_build_object('from', v_inc.facts, 'to', v_facts));
  end if;

  if v_imm is distinct from v_inc.immediate_actions then
    v_fields  := v_fields || array['immediate_actions'];
    v_changes := v_changes || jsonb_build_object(
      'immediate_actions', jsonb_build_object('from', v_inc.immediate_actions, 'to', v_imm));
  end if;

  if v_root is distinct from v_inc.root_cause then
    v_fields  := v_fields || array['root_cause'];
    v_changes := v_changes || jsonb_build_object(
      'root_cause', jsonb_build_object('from', v_inc.root_cause, 'to', v_root));
  end if;

  -- Nothing changed: raise rather than write an event that asserts an edit
  -- which did not happen. A log full of empty edits is a log nobody reads.
  if array_length(v_fields, 1) is null then
    raise exception 'Nothing changed.' using errcode = '22023';
  end if;

  update public.incidents
     set facts             = v_facts,
         immediate_actions = v_imm,
         root_cause        = v_root,
         updated_at        = now()
   where id = p_incident_id
  returning * into v_inc;

  insert into public.incident_events (
    incident_id, org, event_type, by_id, by_name, by_role,
    from_value, to_value, details
  ) values (
    p_incident_id, v_inc.org, 'narrative_edited', v_uid, v_name, v_role,
    array_to_string(v_fields, ','),   -- which fields changed
    v_reason,                          -- the reason, visible without opening details
    jsonb_build_object('reason', v_reason, 'changes', v_changes)
  );

  return v_inc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.incident_rate_risk(p_incident_id bigint, p_kind text, p_likelihood integer, p_consequence integer, p_reason text DEFAULT NULL::text)
 RETURNS incidents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inc      public.incidents;
  v_uid      uuid := auth.uid();
  v_name     text;
  v_role     text;
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_rating   integer;
  v_old_l    integer;
  v_old_c    integer;
  v_old_r    integer;
  v_event    text;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  if p_kind not in ('initial','residual') then
    raise exception 'Unknown rating kind %.', p_kind using errcode = '22023';
  end if;

  select * into v_inc
  from public.incidents
  where id = p_incident_id
  for update;

  if not found then
    raise exception 'Incident % not found.', p_incident_id using errcode = 'P0002';
  end if;

  -- SUP-DB-V1: role from ORG_MEMBERS for THIS incident's org (was profiles.role:
  -- global, stale, and no org check -- any signed-in user could rate any incident).
  select p.name into v_name from public.profiles p where p.id = v_uid;
  v_role := public.my_role_in(v_inc.org);

  if v_role is null then
    raise exception 'You are not a member of this organisation.' using errcode = '42501';
  end if;
  if v_role <> 'client_admin'
     and not (v_role = 'manager' and (v_inc.assigned_to is not distinct from v_uid or v_inc.investigator_id is not distinct from v_uid)) then
    raise exception 'Only a client admin, or the manager handling this incident, may rate its risk.'
      using errcode = '42501';
  end if;

  -- Both figures or neither. A likelihood without a consequence is not a
  -- rating, and storing half of one produces a null product that reads as
  -- "not rated" while looking on screen as though it was.
  if (p_likelihood is null) <> (p_consequence is null) then
    raise exception 'Give both a likelihood and a consequence, or neither.'
      using errcode = '22023';
  end if;

  if p_likelihood is not null then
    if p_likelihood < 1 or p_likelihood > 5 or p_consequence < 1 or p_consequence > 5 then
      raise exception 'Likelihood and consequence must each be between 1 and 5.'
        using errcode = '22023';
    end if;
    v_rating := p_likelihood * p_consequence;
  end if;

  if p_kind = 'initial' then
    v_old_l := v_inc.risk_likelihood;
    v_old_c := v_inc.risk_consequence;
    v_old_r := v_inc.risk_rating;
    v_event := 'risk_rated';
  else
    v_old_l := v_inc.residual_likelihood;
    v_old_c := v_inc.residual_consequence;
    v_old_r := v_inc.residual_rating;
    v_event := 'residual_risk_rated';
  end if;

  if v_old_l is not distinct from p_likelihood
     and v_old_c is not distinct from p_consequence then
    raise exception 'Nothing changed.' using errcode = '22023';
  end if;

  -- THE RULING. A first assessment needs no justification; changing a
  -- recorded judgement does.
  if v_old_r is not null and length(v_reason) < 10 then
    raise exception
      'This rating has already been recorded. Give a reason for changing it (at least 10 characters).'
      using errcode = '22023';
  end if;

  if p_kind = 'initial' then
    update public.incidents
       set risk_likelihood  = p_likelihood,
           risk_consequence = p_consequence,
           risk_rating      = v_rating,
           updated_at       = now()
     where id = p_incident_id
    returning * into v_inc;
  else
    update public.incidents
       set residual_likelihood  = p_likelihood,
           residual_consequence = p_consequence,
           residual_rating      = v_rating,
           updated_at           = now()
     where id = p_incident_id
    returning * into v_inc;
  end if;

  insert into public.incident_events (
    incident_id, org, event_type, by_id, by_name, by_role,
    from_value, to_value, details
  ) values (
    p_incident_id, v_inc.org, v_event, v_uid, v_name, v_role,
    case when v_old_r is null then null else v_old_r::text end,
    case when v_rating is null then null else v_rating::text end,
    jsonb_build_object(
      'likelihood',  p_likelihood,
      'consequence', p_consequence,
      'from', jsonb_build_object('likelihood', v_old_l, 'consequence', v_old_c, 'rating', v_old_r),
      'to',   jsonb_build_object('likelihood', p_likelihood, 'consequence', p_consequence, 'rating', v_rating))
      || case when v_old_r is null then '{}'::jsonb
              else jsonb_build_object('reason', v_reason) end
  );

  return v_inc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.incident_void_action(p_action_id bigint, p_reason text)
 RETURNS incident_actions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_act      public.incident_actions;
  v_inc      public.incidents;
  v_uid      uuid := auth.uid();
  v_name     text;
  v_role     text;
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_task_st  text;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  select * into v_act
  from public.incident_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'Action % not found.', p_action_id using errcode = 'P0002';
  end if;

  select * into v_inc from public.incidents where id = v_act.incident_id;
  if not found then
    raise exception 'Parent incident not found.' using errcode = 'P0002';
  end if;

  -- Caller identity read server-side, never passed in.
  -- SUP-DB-V1: role from ORG_MEMBERS for THIS incident's org (was profiles.role:
  -- global and stale, so a client admin of ANY organisation passed).
  select p.name into v_name from public.profiles p where p.id = v_uid;
  v_role := public.my_role_in(v_inc.org);

  if v_role is null then
    raise exception 'You are not a member of this organisation.' using errcode = '42501';
  end if;

  -- RULING 4 -- client_admin only.
  if v_role <> 'client_admin' then
    raise exception 'Only a client admin may void a corrective action.'
      using errcode = '42501';
  end if;

  -- RULING 1 -- no un-void, and no double-void.
  if v_act.status = 'void' then
    raise exception 'This action is already void.' using errcode = '22023';
  end if;

  -- RULING 3 -- work that was done and verified cannot be withdrawn.
  if v_act.task_id is not null then
    select t.status into v_task_st from public.tasks t where t.id = v_act.task_id;
    if v_task_st = 'approved' then
      raise exception
        'This action''s task has been completed and approved. It cannot be voided — '
        'the work was done. Raise a new action if something further is needed.'
        using errcode = '22023';
    end if;
  end if;

  -- Reason mandatory, with a floor, matching incident_edit_narrative.
  if length(v_reason) < 10 then
    raise exception
      'Give a reason for voiding this action (at least 10 characters). It is recorded in the audit trail.'
      using errcode = '22023';
  end if;

  update public.incident_actions
     set status = 'void'
   where id = p_action_id
  returning * into v_act;

  insert into public.incident_events (
    incident_id, org, event_type, by_id, by_name, by_role,
    from_value, to_value, details
  ) values (
    v_act.incident_id, v_inc.org, 'action_voided', v_uid, v_name, v_role,
    left(coalesce(v_act.description,''), 60),
    v_reason,
    jsonb_build_object('reason', v_reason, 'action_id', p_action_id,
                       'task_id', v_act.task_id)
  );

  return v_act;
end;
$function$
;
