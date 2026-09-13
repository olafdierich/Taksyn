-- ===========================================================================
-- Taksyn migration -- corrective-action gate reads the org role
-- 11 September 2026
--
-- WHY
-- incident_actions_assignment_gate is the trigger added on 15 August that stops
-- anyone but a client_admin raising a corrective action against a high-severity
-- or high-risk incident. It read profiles.role.
--
-- profiles.role is global and has no organisation attached, so it answers
-- "client_admin of SOMEWHERE", not "client_admin HERE". It also goes stale: a
-- demotion recorded in org_members leaves profiles.role untouched. Every other
-- authority check in this module moved to my_role_in(org) on 11 September; this
-- was the last one still reading the old column.
--
-- The rule itself is unchanged -- only who counts as a client_admin for it.
--
-- VERIFIED on sandbox inside a rolled-back block (CA-DB-04): an incident was
-- temporarily raised to severity 4, then a manager's attempt to add an action
-- was REFUSED and the client admin's was ALLOWED. Nothing saved.
--
-- SAFE TO RE-RUN. CREATE OR REPLACE only.
-- Applied to SANDBOX and LIVE 11 Sep 2026.
--
-- VERIFY after running on a rebuilt database:
--   incident_actions_assignment_gate  0dad8b620d
-- select left(md5(prosrc),10) from pg_proc
--  where oid = 'public.incident_actions_assignment_gate'::regproc;
--
-- The companion change to incident_edit_action (owner must be a manager or
-- client_admin of that organisation; the linked task keeps its incident ref) is
-- in 2026-09-11-incident-authority-fixes.sql, which carries that function whole.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.incident_actions_assignment_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_role := public.my_role_in(v_inc.org);  -- CA-DB-V1: org role, not profiles.role

  if v_role is distinct from 'client_admin' then
    raise exception
      'This incident is high severity or high risk. Only a client admin may raise a corrective action against it.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$
;
