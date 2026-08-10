-- =====================================================================
-- Taksyn migration: reminder_config
-- 10 August 2026
-- Companion to 2026-08-10-reminder-ledger.sql. Apply AFTER it.
--
-- WHY THIS EXISTS: THE CUTOVER
-- Twelve one-off tasks on LIVE are already past due, some by weeks.
-- Without a cutover the job's first run would compute every threshold
-- those tasks ever crossed and send the lot in one burst to Kemrose
-- staff. That is not a feature launch, it is an incident.
--
-- first_run_date is written ONCE, on the job's first execution, and
-- never updated. Any threshold whose trigger day falls before it is
-- ignored permanently. Nothing is ever sent retroactively.
--
-- A table rather than an env var: env vars get changed, lost on
-- redeploy, and differ between environments without anyone noticing.
-- The cutover must be durable and auditable.
--
-- SANDBOX FIRST. psql -f, never the browser SQL editor.
-- =====================================================================

\set ON_ERROR_STOP on

select 'PRE-ENV' as marker, count(*) as auth_users from auth.users;
select 'PRE-LEDGER' as marker,
       to_regclass('public.reminder_ledger') is not null as ledger_exists;

begin;

create table if not exists public.reminder_config (
  id             boolean primary key default true check (id),  -- single row, enforced
  first_run_date date,
  enabled        boolean     not null default false,
  updated_at     timestamptz not null default now()
);

-- enabled defaults to FALSE. The job is inert until switched on
-- deliberately, so deploying it cannot itself start sending.
insert into public.reminder_config (id, first_run_date, enabled)
values (true, null, false)
on conflict (id) do nothing;

alter table public.reminder_config enable row level security;
revoke all on public.reminder_config from anon;
revoke all on public.reminder_config from authenticated;

commit;

-- VERIFY: one row, enabled false, no cutover yet, RLS on, no policies.
select 'POST-CFG' as marker, id, first_run_date, enabled,
       (select count(*) from public.reminder_config) as row_count,
       (select count(*) from pg_policies
         where tablename='reminder_config') as policy_count
from public.reminder_config;

-- Prove the single-row constraint bites.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.reminder_config (id) values (false);
  exception when others then
    v_failed := true;
  end;
  if v_failed then
    raise notice 'POST-SINGLE | PASS | second row rejected';
  else
    raise exception 'POST-SINGLE | FAIL | a second config row was accepted';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- TO ENABLE, once the dry run has been reviewed and looks right:
--   update public.reminder_config set enabled = true, updated_at = now();
--
-- TO STOP IMMEDIATELY (the kill switch -- no redeploy needed):
--   update public.reminder_config set enabled = false, updated_at = now();
--
-- ROLLBACK: drop table if exists public.reminder_config;
-- ---------------------------------------------------------------------
