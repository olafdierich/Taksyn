-- ===========================================================================
-- Taksyn migration — voiding a corrective action
-- 12 August 2026
--
-- WHY
-- An action raised in error had no remedy. It could not be deleted from the
-- UI, and an action with no linked task blocks verification permanently --
-- the incident cannot reach Resolved. Twice on LIVE the only fix was SQL
-- (rows 3 and 4, deleted 10 Aug with an over-specified WHERE).
--
-- WHY VOID RATHER THAN DELETE (Olaf, 12 Aug 2026)
-- An action that was raised and withdrawn IS part of what happened. Showing
-- it struck through, with who withdrew it and why, is a more honest account
-- than showing nothing at all. Deleting the row would leave the event log
-- asserting an action_created for something a reader can no longer see.
--
-- WHY NOT THE "LINK AN EXISTING TASK" CONTROL THAT WAS ORIGINALLY SCOPED
-- CHK-OP2 on LIVE: six tasks carry category 'Corrective action' and ALL SIX
-- are already linked. A picker of linkable tasks would open empty on every
-- incident. The observed failure is an action row with NO task ever created
-- -- which leaves nothing to link to. Void addresses the failure that has
-- actually occurred; the picker addressed one that has not.
--
-- RULINGS ENCODED HERE (do not reverse without a new one)
--   1. Void is NOT reversible. There is no un-void. An action wrongly voided
--      is corrected by raising a new one, which leaves both on the record.
--   2. The reason IS correctable, via the same edit-with-audit principle as
--      the narrative fields.
--   3. An action whose linked task is already APPROVED cannot be voided.
--      That work was done and verified; withdrawing it would be rewriting
--      the record rather than correcting it.
--   4. client_admin only, matching the effectiveness gate. Withdrawing a
--      corrective action changes what the verification count means.
--
-- Sandbox first, then LIVE. Depends on 2026-08-12-event-type-check.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. action_voided must be an accepted event_type, or the insert in the
--    function below is rejected by the constraint added earlier today.
--    Drop and re-add: a check constraint cannot be altered in place.
-- ---------------------------------------------------------------------------
alter table public.incident_events
  drop constraint if exists incident_events_event_type_check;

alter table public.incident_events
  add constraint incident_events_event_type_check
  check (event_type in (
    'reported','assigned','severity_set','investigation_started',
    'status_changed','status_reverted','closed','reopened',
    'risk_rated','residual_risk_rated','root_cause_recorded',
    'action_created','corrective_action_completed','no_action_decided',
    'notified','data_remediation',
    'narrative_edited','action_edited','ratings_edited','action_voided'
  ));

-- ---------------------------------------------------------------------------
-- 2. Constrain incident_actions.status. This closes a gap flagged as SD-2:
--    the column was free text running parallel to the linked task's status.
--    CHK-V1 (LIVE) and CHK-V2 (SANDBOX) both show exactly 'open' and
--    'completed' -- no drift to accommodate, so the vocabulary is those two
--    plus the new one.
--
--    NOTE the authority question SD-2 raises is NOT settled by this: the
--    linked task's status remains the source of truth for verification, and
--    incident_actions.status is derived from it by the reconcile. This
--    constraint just stops a typo inventing a fourth value.
-- ---------------------------------------------------------------------------
alter table public.incident_actions
  drop constraint if exists incident_actions_status_check;

alter table public.incident_actions
  add constraint incident_actions_status_check
  check (status in ('open','completed','void'));

-- ---------------------------------------------------------------------------
-- 3. Void a corrective action. Update and audit event in ONE transaction.
--
--    Deliberately an RPC and not a client-side update, for the same reason
--    as incident_edit_narrative: a PostgREST update returns HTTP 200 with
--    error null when RLS blocks it, so a client-side path can believe it
--    voided an action it never touched, and write an event saying so.
-- ---------------------------------------------------------------------------
create or replace function public.incident_void_action(
  p_action_id bigint,
  p_reason    text
) returns public.incident_actions
language plpgsql
security definer
set search_path = public
as $$
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
  select p.name, p.role into v_name, v_role
  from public.profiles p where p.id = v_uid;

  if v_role is null then
    raise exception 'No profile for the calling user.' using errcode = '42501';
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
$$;

revoke all on function public.incident_void_action(bigint, text) from public;
revoke all on function public.incident_void_action(bigint, text) from anon;
grant execute on function public.incident_void_action(bigint, text) to authenticated;

comment on function public.incident_void_action(bigint, text) is
  'Withdraw a corrective action raised in error. client_admin only, mandatory '
  'reason, not reversible, and refused once the linked task is approved. '
  'Update and audit event in one transaction. Olaf rulings, 12 Aug 2026.';
