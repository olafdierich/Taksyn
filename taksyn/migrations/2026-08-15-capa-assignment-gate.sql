-- ===========================================================================
-- Taksyn migration — CAPA assignment gate, enforced
-- 15 August 2026 (SD-1)
--
-- WHY
-- When an incident is severity 3 or above, or carries a risk rating of 9 or
-- above, only a client_admin may raise a corrective action against it. That
-- rule existed ONLY in the interface: a disabled picker, a disabled button
-- and a guard in create(). Anyone calling the API directly met nothing.
--
-- Every other authority rule in this module moved to the database. This one
-- was the last that had not.
--
-- WHY A TRIGGER RATHER THAN RLS
-- The same reason effectiveness went this way on 10 Aug, recorded in App.jsx
-- at the saveEffectiveness comment: the CAPA reconcile runs as WHOEVER OPENED
-- THE INCIDENT -- routinely a supervisor -- and updates incident_actions to
-- flip an action to completed when its linked task is approved. An RLS policy
-- broad enough to block a supervisor from creating actions would also block
-- the reconcile from updating them, and the reconcile is what keeps
-- verification honest.
--
-- A BEFORE INSERT trigger touches none of that. Read of the reconcile
-- confirms it only ever UPDATEs incident_actions and INSERTs
-- incident_events; it never inserts an action.
--
-- INSERT ONLY, deliberately
--   * UPDATE is untouched, so the reconcile keeps working and supervisors can
--     still complete their part.
--   * Reassigning an existing action is already client_admin-only, enforced
--     inside incident_edit_action.
--   * Raising the severity of an incident does NOT retroactively invalidate
--     actions raised when it was lower. The gate is about who may CREATE,
--     judged at the moment of creation.
--
-- THRESHOLDS match the UI exactly: severity >= 3 OR risk_rating >= 9.
-- If those ever diverge, the database is the authority and the UI is the
-- courtesy -- the same order as everywhere else in this module.
-- ===========================================================================

create or replace function public.incident_actions_assignment_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inc   public.incidents;
  v_role  text;
  v_uid   uuid := auth.uid();
begin
  -- No authenticated user means a service-role or SQL-editor connection.
  -- Those bypass RLS by design and are not what this gate is for.
  if v_uid is null then
    return new;
  end if;

  select * into v_inc from public.incidents where id = new.incident_id;
  if not found then
    return new;   -- the foreign key will refuse it a moment from now
  end if;

  -- Only high-severity or high-risk incidents are gated.
  if coalesce(v_inc.severity, 0) < 3
     and coalesce(v_inc.risk_rating, 0) < 9 then
    return new;
  end if;

  select p.role into v_role from public.profiles p where p.id = v_uid;

  if v_role is distinct from 'client_admin' then
    raise exception
      'This incident is high severity or high risk. Only a client admin may raise a corrective action against it.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists incident_actions_assignment_gate_trg on public.incident_actions;
create trigger incident_actions_assignment_gate_trg
  before insert on public.incident_actions
  for each row
  execute function public.incident_actions_assignment_gate();

comment on function public.incident_actions_assignment_gate() is
  'Refuses a corrective action INSERT by anyone but a client_admin when the '
  'parent incident is severity >= 3 or risk >= 9. INSERT only, so the CAPA '
  'reconcile -- which runs as whoever opened the incident and UPDATEs actions '
  '-- is untouched. SD-1, 15 Aug 2026.';
