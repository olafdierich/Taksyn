-- =====================================================================
-- Taksyn migration: organisations.escalate_to
-- 10 August 2026
-- Third of three. Apply AFTER reminder-ledger and reminder-config.
--
-- WHY A COLUMN AND NOT org_settings JSON
-- organisations.org_settings is TEXT holding JSON: no constraint, no
-- validation, and a typo silently falls back to a default nobody sees.
-- This value decides whether a task's STATUS changes and who gets told,
-- so it gets a real column with a CHECK. A bad value must fail loudly
-- at write time, not quietly at 6am in a scheduled job.
--
-- WHY IT IS CONFIGURABLE
-- Orgs differ. A hotel escalates to the duty manager; a clinic to the
-- practice manager; a small provider to the owner. Hardcoding
-- client_admin would make this a Kemrose feature rather than a product
-- feature.
--
--   client_admin  all client_admins of the org (DEFAULT)
--   manager       all managers of the org
--   approver      the task's own approver_id, falling back to
--                 client_admin when the task has none
--   none          send the day-7 notice, change nothing, tell no one
--
-- 'none' is not decoration. Some orgs will want the warning without an
-- automatic status change, and forcing escalation on everyone makes the
-- feature unusable for them. When escalate_to = 'none' the day-7 email
-- MUST NOT claim escalation will follow — the wording is derived from
-- this value, never hardcoded.
--
-- SANDBOX FIRST. psql -f, never the browser SQL editor.
-- =====================================================================

\set ON_ERROR_STOP on

select 'PRE-ENV' as marker, count(*) as auth_users from auth.users;

select 'PRE-COL' as marker,
       count(*) filter (where column_name = 'escalate_to') as already_there
from information_schema.columns where table_name = 'organisations';

begin;

alter table public.organisations
  add column if not exists escalate_to text not null default 'client_admin';

-- Added separately and guarded so re-running cannot error on an
-- existing constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organisations_escalate_to_check'
  ) then
    alter table public.organisations
      add constraint organisations_escalate_to_check
      check (escalate_to in ('client_admin','manager','approver','none'));
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- VERIFY 1: every org has a value, and it is a legal one.
-- ---------------------------------------------------------------------
select 'POST-VAL' as marker, escalate_to, count(*)
from public.organisations group by escalate_to order by count(*) desc;

-- ---------------------------------------------------------------------
-- VERIFY 2: prove the CHECK bites. Rolled back either way.
-- ---------------------------------------------------------------------
do $$
declare v_failed boolean := false;
begin
  begin
    update public.organisations set escalate_to = 'ZZBOGUS'
    where id = (select id from public.organisations limit 1);
    raise exception 'ROLLBACK_PROBE';
  exception
    when check_violation then v_failed := true;
    when others then
      if sqlerrm = 'ROLLBACK_PROBE' then
        raise exception 'POST-CHK | FAIL | an illegal escalate_to value was ACCEPTED';
      else raise;
      end if;
  end;
  if v_failed then
    raise notice 'POST-CHK | PASS | illegal value rejected by constraint';
  end if;
end $$;

-- Nothing from the probe survived.
select 'POST-CLEAN' as marker, count(*) as bogus_rows
from public.organisations where escalate_to = 'ZZBOGUS';

-- ---------------------------------------------------------------------
-- VERIFY 3: who WOULD be escalated to, per org, if a task hit day 7
-- today. Read-only. Run this before enabling the job.
--
-- NOTE the join: org_members.org stores the org ID, so it joins to
-- organisations.id. tasks.org stores the org NAME. Never cross the two
-- without a bridge.
--
-- The role test is INLINE and not is_org_admin(), which grants both
-- client_admin AND manager — it would silently widen 'client_admin' to
-- include every manager.
-- ---------------------------------------------------------------------
select 'PREVIEW-ESC' as marker,
       o.name as org,
       o.escalate_to,
       coalesce(o.timezone,'(NULL — org would be SKIPPED)') as tz,
       count(m.user_id) filter (
         where (o.escalate_to = 'client_admin' and m.role = 'client_admin')
            or (o.escalate_to = 'manager'      and m.role = 'manager')
       ) as recipients,
       case
         when o.escalate_to = 'none' then 'no escalation, notice only'
         when o.escalate_to = 'approver' then 'per-task approver_id'
         when count(m.user_id) filter (
           where (o.escalate_to = 'client_admin' and m.role = 'client_admin')
              or (o.escalate_to = 'manager'      and m.role = 'manager')
         ) = 0 then 'WARNING: nobody holds this role — escalation would notify no one'
         else 'ok'
       end as note
from public.organisations o
left join public.org_members m on m.org = o.id
group by o.name, o.escalate_to, o.timezone
order by o.name;

-- ---------------------------------------------------------------------
-- TO CONFIGURE AN ORG, e.g.:
--   update public.organisations set escalate_to = 'manager'
--    where id = 'ORG1780482520610';   -- Kemrose
--
-- ROLLBACK:
--   alter table public.organisations drop constraint if exists
--     organisations_escalate_to_check;
--   alter table public.organisations drop column if exists escalate_to;
-- ---------------------------------------------------------------------
