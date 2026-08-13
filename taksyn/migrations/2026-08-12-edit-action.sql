-- ===========================================================================
-- Taksyn migration — incident_edit_action()
-- 12 August 2026
--
-- WHY
-- A corrective action could be created and voided, but never corrected. A
-- mistyped description, the wrong owner or a wrong due date could only be
-- fixed by voiding the action and raising another -- which leaves two rows
-- on the record for one piece of work and makes the register read as though
-- something was abandoned.
--
-- THE HARD PART: TWO ROWS, ONE SENTENCE
-- incident_actions.description and tasks.title are the SAME sentence stored
-- twice. Editing one without the other leaves the incident record and the
-- worker's task disagreeing about what was asked for -- and the worker's copy
-- is the one that gets acted on. So the update to tasks is not optional
-- garnish here; it is half the point, and it happens in the same transaction.
--
-- RULINGS ENCODED HERE (Olaf, 12 Aug 2026 -- do not reverse without a new one)
--   1. Approved means finished. An action whose linked task is approved
--      cannot be edited AT ALL -- not the description, not the owner, not the
--      date. This MIRRORS the void rule decided earlier today: that work was
--      done and signed off, and amending it afterwards rewrites what was
--      verified. One principle, applied in both places, rather than two.
--   2. A voided action cannot be edited. There is nothing to correct on
--      something already withdrawn; raise a new action instead.
--   3. client_admin only, matching void and the effectiveness gate.
--   4. Mandatory reason, 10-character floor, matching every other edit path
--      written today.
--   5. Both sides of every changed field stored in full, in details.
--
-- NOT ENFORCED HERE, DELIBERATELY
-- The worker-visible-title warning is a UI concern and stays in the UI. This
-- function cannot know what a human considers identifying, and a database
-- rule that tried would either block legitimate text or give false comfort.
--
-- action_edited is ALREADY in the event_type constraint (Migration 1, named
-- ahead of use), so no constraint change is needed.
--
-- Sandbox first, then LIVE. And CALL it before believing it: this morning a
-- function applied cleanly to both environments and still failed at runtime.
-- ===========================================================================

create or replace function public.incident_edit_action(
  p_action_id   bigint,
  p_description text,
  p_owner_id    uuid,
  p_due_date    date,
  p_reason      text
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
  select p.name, p.role into v_name, v_role
  from public.profiles p where p.id = v_uid;

  if v_role is null then
    raise exception 'No profile for the calling user.' using errcode = '42501';
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
       set title      = v_desc,
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
$$;

revoke all on function public.incident_edit_action(bigint, text, uuid, date, text) from public;
revoke all on function public.incident_edit_action(bigint, text, uuid, date, text) from anon;
grant execute on function public.incident_edit_action(bigint, text, uuid, date, text) to authenticated;

comment on function public.incident_edit_action(bigint, text, uuid, date, text) is
  'Correct a corrective action. client_admin only, mandatory reason, refused '
  'once the linked task is approved or the action is void. Updates the linked '
  'task title and due date in the same transaction. Olaf rulings, 12 Aug 2026.';
