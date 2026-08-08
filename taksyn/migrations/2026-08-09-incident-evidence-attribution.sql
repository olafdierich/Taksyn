-- migrations/2026-08-09-incident-evidence-attribution.sql
--
-- WHY. A probe on SANDBOX (9 Aug) inserted a row with incident_id = 1, which
-- belongs to ORG1900000000001, while labelling the row org = 'ORG1900000000002'
-- and setting by_id / by_name / by_role to arbitrary client-supplied values.
-- HTTP 201. The evd_insert policy is transitively org-scoped -- cross-org
-- inserts and inserts against nonexistent incidents are both denied 42501 --
-- but nothing validates the org LABEL against the parent, and nothing binds
-- attribution to the session. A row labelled with another org would surface in
-- that org's trend reports.
--
-- WHAT. A BEFORE INSERT trigger overwrites four columns from authoritative
-- sources, ignoring whatever the client sent:
--   org      <- incidents.org for the parent row
--   by_id    <- auth.uid()
--   by_role  <- org_members.role for (auth.uid(), that org)   [per-org, NOT profiles.role]
--   by_name  <- profiles.name
--
-- by_role deliberately reads org_members, not profiles. profiles.role is
-- GLOBAL; org_members.role is PER-ORG. patchIncident writes by_role from
-- profiles.role and is wrong for exactly this reason (open finding, v25 s9).
-- This trigger does not repeat that defect.
--
-- is_active IS TRUE, not = true: org_members.is_active is NULLABLE, and a null
-- would silently drop the row under = true, leaving by_role null. Note the
-- storage.objects policies use = true, so a null-is_active member is locked out
-- of storage today. Recorded, not changed here.
--
-- On UPDATE the trigger does nothing. There is no UPDATE policy on this table
-- for authenticated, so evidence is insert-only by design.
--
-- SECURITY DEFINER is required: the trigger reads org_members and profiles rows
-- the inserting user may not be able to SELECT under their own RLS. search_path
-- is pinned to defeat search_path injection.

begin;

create or replace function public.incident_evidence_attribution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  text;
  v_uid  uuid;
  v_role text;
  v_name text;
begin
  -- Parent org is authoritative. If the parent does not exist the RLS policy
  -- would have rejected this insert anyway; raise rather than write a row with
  -- a null org into a NOT NULL column.
  select i.org into v_org
  from public.incidents i
  where i.id = new.incident_id;

  if v_org is null then
    raise exception 'Incident % not found -- evidence cannot be attached', new.incident_id
      using errcode = '23503';
  end if;

  new.org := v_org;

  v_uid := auth.uid();
  new.by_id := v_uid;

  -- Attribution is best-effort. by_id / by_name / by_role are all nullable, so
  -- an unresolvable actor leaves them null rather than blocking the upload.
  -- Never a stale or borrowed value.
  if v_uid is not null then
    select om.role into v_role
    from public.org_members om
    where om.user_id = v_uid
      and om.org = v_org
      and om.is_active is true
    limit 1;

    select p.name into v_name
    from public.profiles p
    where p.id = v_uid;
  end if;

  new.by_role := v_role;
  new.by_name := v_name;

  return new;
end;
$$;

drop trigger if exists incident_evidence_attribution_bi on public.incident_evidence;

create trigger incident_evidence_attribution_bi
  before insert on public.incident_evidence
  for each row
  execute function public.incident_evidence_attribution();

commit;

-- VERIFICATION (run separately, after commit):
--
-- select (select count(*) from auth.users) as env, 'CHK-EV6' as marker,
--        t.tgname, t.tgenabled, p.proname, p.prosecdef
-- from pg_trigger t
-- join pg_proc p on p.oid = t.tgfoid
-- where t.tgrelid = 'public.incident_evidence'::regclass
--   and not t.tgisinternal;
--
-- Expect one row: incident_evidence_attribution_bi, tgenabled = 'O',
-- prosecdef = true.
--
-- NEGATIVE CONTROL (SANDBOX only, inside begin/rollback): re-run the P2 probe
-- shape and confirm org comes back as the PARENT's org, not the supplied one.
