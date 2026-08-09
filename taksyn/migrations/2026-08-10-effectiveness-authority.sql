-- migrations/2026-08-10-effectiveness-authority.sql
--
-- Restrict the effectiveness assessment to an active client_admin of the
-- incident's org, ENFORCED IN THE DATABASE.
--
-- WHY THIS IS A TRIGGER AND NOT A POLICY CHANGE.
--
-- act_update on incident_actions is a bare EXISTS against incidents with NO
-- role clause and an EMPTY with_check. It is safe by INHERITANCE -- a user who
-- cannot see the incident cannot touch its actions -- but within an org, any
-- supervisor or manager who can see an incident can currently write anything on
-- its actions, including effectiveness.
--
-- Adding a client_admin clause to act_update WOULD BREAK THE CAPA RECONCILE.
-- App.jsx ~15848 flips incident_actions.status to 'completed' and sets
-- verified_at / verified_by when the linked task is approved, and that runs as
-- WHOEVER OPENED THE INCIDENT -- routinely a supervisor or manager. Locking the
-- whole UPDATE path to client_admin would silently stop that reconcile working
-- for them, and it would fail the way PostgREST fails: 200, error null, nothing
-- written.
--
-- So the gate is surgical: it rejects a CHANGE TO THE EFFECTIVENESS TEXT by a
-- non-admin, and leaves every other column on the row alone. status,
-- verified_at, verified_by, owner, due_date all keep working exactly as before
-- for every role that can already write them.
--
-- It lives INSIDE the existing effectiveness trigger rather than in a second
-- one. Two BEFORE triggers on the same table fire in name order, which is a
-- fragile thing to depend on, and this function is already the only thing that
-- touches these columns.
--
-- ROLE LOOKUP: org_members directly, with is_active is true. NOT my_role_in(),
-- which reads:
--     select role from org_members where org = p_org and user_id = auth.uid() limit 1;
-- -- no is_active filter, so a DEACTIVATED client_admin would still pass it.
-- Confirmed by reading the function body, not from prose. This matches the
-- incident_evidence and incident_findings triggers rather than adding a fifth
-- is_active variant to the four already in the codebase.
--
-- SUPERSEDES the function created by 2026-08-10-incident-actions-link-and-
-- effectiveness.sql. The trigger itself is unchanged and is not recreated.

begin;

create or replace function public.incident_actions_effectiveness_attribution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid;
  v_name  text;
  v_role  text;
  v_org   text;
  v_set   boolean;
  v_dirty boolean;
begin
  -- Is the effectiveness text actually being changed by this statement?
  if TG_OP = 'INSERT' then
    v_dirty := new.effectiveness is not null and btrim(new.effectiveness) <> '';
  else
    v_dirty := new.effectiveness is distinct from old.effectiveness;
  end if;

  -- Untouched on UPDATE: carry the existing attribution forward verbatim and
  -- return early. No authority check -- this is the reconcile's path, and it
  -- must keep working for supervisors and managers.
  if TG_OP = 'UPDATE' and not v_dirty then
    new.effectiveness_by      := old.effectiveness_by;
    new.effectiveness_at      := old.effectiveness_at;
    new.effectiveness_by_name := old.effectiveness_by_name;
    return new;
  end if;

  -- An INSERT with no effectiveness is the ordinary case: an action is created
  -- long before it is assessed. Nothing to gate.
  if TG_OP = 'INSERT' and not v_dirty then
    new.effectiveness_by      := null;
    new.effectiveness_at      := null;
    new.effectiveness_by_name := null;
    return new;
  end if;

  -- From here the effectiveness text IS being set or changed. Gate it.
  v_uid := auth.uid();

  select i.org into v_org
  from public.incidents i
  where i.id = new.incident_id;

  if v_org is null then
    raise exception 'Incident % not found -- effectiveness cannot be recorded', new.incident_id
      using errcode = '23503';
  end if;

  if v_uid is not null then
    select om.role into v_role
    from public.org_members om
    where om.user_id = v_uid
      and om.org = v_org
      and om.is_active is true
    limit 1;
  end if;

  if v_role is distinct from 'client_admin' then
    raise exception 'Only a client admin may assess the effectiveness of a corrective action'
      using errcode = '42501';
  end if;

  v_set := new.effectiveness is not null and btrim(new.effectiveness) <> '';

  -- Clearing the text clears the attribution with it, so a blanked assessment
  -- cannot leave a stale author behind. Note an admin IS permitted to clear.
  if not v_set then
    new.effectiveness         := null;
    new.effectiveness_by      := null;
    new.effectiveness_at      := null;
    new.effectiveness_by_name := null;
    return new;
  end if;

  new.effectiveness_by := v_uid;
  new.effectiveness_at := now();

  select p.name into v_name from public.profiles p where p.id = v_uid;
  new.effectiveness_by_name := v_name;

  return new;
end;
$$;

commit;

-- ===========================================================================
-- NEGATIVE CONTROL -- SANDBOX ONLY, and it CANNOT be run from psql.
--
-- psql connects as the postgres superuser, where auth.uid() is null. That makes
-- v_role null, so EVERY write is rejected -- which proves the gate fires but
-- proves nothing about who it lets through. The permissive case needs a real
-- authenticated session, i.e. a PostgREST probe with the publishable key, the
-- same way the incident_evidence gate was proven on 9 Aug.
--
-- Expected from psql as superuser:
--   update public.incident_actions set effectiveness = 'x' where id = 1;
--   -> 42501 'Only a client admin may assess the effectiveness...'
--
-- Expected from a probe as drolaf+testadmin (client_admin): 200, row returned,
-- effectiveness_by_name = 'Test Admin'.
-- Expected from a probe as a supervisor who can see the incident: 42501.
-- ===========================================================================
