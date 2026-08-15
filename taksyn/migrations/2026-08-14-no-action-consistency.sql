-- ===========================================================================
-- Taksyn migration — no_action_required cannot contradict the record
-- 14 August 2026
--
-- WHY
-- An incident could hold "no corrective action required" as TRUE while three
-- live corrective actions sat on the same record. Observed on LIVE:
-- INC-2026-0002 carried the tick alongside Ff, gg and xx, and the audit trail
-- shows it toggled three times in as many minutes. The content gate correctly
-- ignores the tick when actions exist, so nothing broke -- but a compliance
-- record asserting two contradictory things is a record nobody can rely on.
--
-- THE RULING (Olaf, 14 Aug 2026)
-- The contradiction can never persist, and neither direction obstructs a
-- legitimate workflow:
--
--   * Ticking is REFUSED while a non-void action exists. If actions are
--     recorded, "none required" is false on its face.
--   * Raising an action CLEARS the tick automatically. The honest sequence is
--     "I thought none was needed, then realised one was" -- blocking that
--     would force a pointless extra step. The clearing is written to the
--     event log as its own entry, so the reversal is attributable rather
--     than silent.
--
-- WHY A TRIGGER RATHER THAN UI
-- The tickbox will also be hidden when actions exist, but that is a courtesy.
-- Every other rule in this module is enforced in the database, and a
-- client_admin calling the API directly should meet the same rule as one
-- clicking a checkbox.
--
-- Voided actions are ignored throughout: an action that was withdrawn is not
-- an outstanding action.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Refuse the tick while live actions exist.
-- ---------------------------------------------------------------------------
create or replace function public.incidents_no_action_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only when the flag is being turned ON.
  if coalesce(new.no_action_required, false) = true
     and coalesce(old.no_action_required, false) = false then
    if exists (select 1 from public.incident_actions a
                where a.incident_id = new.id
                  and a.status <> 'void') then
      raise exception
        'This incident has corrective actions recorded. Void them first, or leave this unticked.'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists incidents_no_action_guard_trg on public.incidents;
create trigger incidents_no_action_guard_trg
  before update of no_action_required on public.incidents
  for each row
  execute function public.incidents_no_action_guard();

-- ---------------------------------------------------------------------------
-- 2. Raising an action clears the tick, and says so in the log.
--
-- AFTER INSERT, not BEFORE: the action must exist before the guard above
-- would object to it, and this runs in the same transaction so the two can
-- never disagree.
--
-- The guard trigger is BEFORE UPDATE OF no_action_required and only fires
-- when the flag goes FALSE -> TRUE, so clearing it here does not trip it.
-- ---------------------------------------------------------------------------
create or replace function public.incident_actions_clear_no_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inc public.incidents;
begin
  if new.status = 'void' then
    return new;
  end if;

  select * into v_inc from public.incidents where id = new.incident_id;
  if not found then
    return new;
  end if;

  if coalesce(v_inc.no_action_required, false) = true then
    update public.incidents
       set no_action_required = false,
           updated_at = now()
     where id = new.incident_id;

    -- Attributable, not silent. Uses the same event type the tickbox writes,
    -- so the timeline reads as one continuous story.
    insert into public.incident_events (
      incident_id, org, event_type, by_id, by_name, by_role,
      from_value, to_value, details
    )
    select new.incident_id, v_inc.org, 'no_action_decided',
           auth.uid(), coalesce(p.name, 'System'), coalesce(p.role, 'system'),
           'true', 'false',
           jsonb_build_object('reason', 'Cleared automatically: a corrective action was recorded.',
                              'action_id', new.id)
    from (select 1) x
    left join public.profiles p on p.id = auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists incident_actions_clear_no_action_trg on public.incident_actions;
create trigger incident_actions_clear_no_action_trg
  after insert on public.incident_actions
  for each row
  execute function public.incident_actions_clear_no_action();

comment on function public.incidents_no_action_guard() is
  'Refuses no_action_required = true while a non-void corrective action exists. '
  'Olaf ruling, 14 Aug 2026.';
comment on function public.incident_actions_clear_no_action() is
  'Clears no_action_required when a corrective action is raised, and logs the '
  'reversal. Olaf ruling, 14 Aug 2026.';
