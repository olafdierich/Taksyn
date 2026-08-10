-- =====================================================================
-- Taksyn migration: reminder_ledger
-- 10 August 2026
--
-- Ahead-of-due-date reminders for ONE-OFF tasks.
--
-- THE LADDER (decided 10 Aug). Bands are inclusive; every threshold at
-- or below the band also fires:
--     lead 0-2 days    -> nothing
--     lead 3-10 days   -> 2-day
--     lead 11-30 days  -> 7-day, 2-day
--     lead 31+ days    -> 14-day, 7-day, 2-day
-- A task 56 days out gets three reminders; 21 days gets two; 9 days
-- gets one; 2 days gets none.
--
-- RECURRING TASKS ARE OUT OF SCOPE FOR v1, deliberately.
-- App.jsx line 231 comments "This is the FOURTH walk" over the
-- occurrence-stepping logic. A scheduled job would be the fifth, in a
-- second runtime, running unattended. Recurring reminders wait for the
-- per-occurrence rebuild. The ladder is unchanged when they arrive --
-- only the date source changes, which is why occurrence_date is in the
-- unique key from day one rather than being retrofitted.
--
-- Exclusion filter MIRRORS isRecurring() at App.jsx 133 exactly:
--     recurrence is null or recurrence = '' or recurrence = 'once'
-- Do NOT simplify to "recurrence = 'once'" -- null and '' are both
-- treated as one-off by the app.
--
-- WHY A LEDGER AND NOT JUST SENDING
-- The unique constraint is the entire idempotency story. A double run,
-- a retry after a timeout, or two overlapping invocations all collide
-- on it. Without it, a job that runs twice emails everyone twice, and
-- that is how a reminder system becomes the thing people mute.
--
-- SANDBOX FIRST. Apply with psql -f, never the browser SQL editor.
-- =====================================================================

\set ON_ERROR_STOP on

select 'PRE-ENV' as marker, count(*) as auth_users from auth.users;

select 'PRE-EXISTS' as marker,
       to_regclass('public.reminder_ledger') is not null as already_there;

begin;

create table if not exists public.reminder_ledger (
  id                uuid primary key default gen_random_uuid(),

  -- tasks.id is TEXT, not uuid. No FK: tasks may be hard-deleted and a
  -- send record should outlive its task for audit. Orphans are expected.
  task_id           text        not null,

  -- tasks.org stores the org NAME, not the ID (the org gremlin).
  -- This column follows tasks.org so joins stay honest. Reaching
  -- organisations.timezone means joining on organisations.name.
  org               text        not null,

  -- For one-off tasks this equals tasks.due_date. It exists now so that
  -- recurring tasks slot in later without altering the unique key.
  occurrence_date   date        not null,

  -- 14, 7 or 2. Stored as the number of days, not a label, so the
  -- ladder can gain a tier without a type change.
  threshold_days    integer     not null check (threshold_days > 0),

  channel           text        not null default 'email'
                    check (channel in ('email','whatsapp','in_app')),

  recipient_user_id text        not null,

  -- Resolved at SEND time, not here. tasks.assigned_user_email is a
  -- denormalised snapshot and goes stale when a user changes address.
  recipient_address text,

  -- CONTENT AS FIELDS, NOT PROSE. WhatsApp Business templates fill
  -- variables; storing a rendered string now would make that migration
  -- painful. Email composes its body from these at send time.
  task_title        text        not null,
  due_date          date        not null,

  status            text        not null default 'queued'
                    check (status in ('queued','sent','failed','skipped')),
  attempts          integer     not null default 0,
  error             text,

  -- 'skipped' carries a reason: how an org with a null or invalid
  -- timezone is RECORDED as deliberately not sent, rather than silently
  -- missing. A gap in the ledger must never be ambiguous.
  skip_reason       text,

  queued_at         timestamptz not null default now(),
  sent_at           timestamptz
);

-- THE IDEMPOTENCY SPINE. Everything else in this design leans on it.
create unique index if not exists reminder_ledger_unique_send
  on public.reminder_ledger
  (task_id, occurrence_date, threshold_days, channel, recipient_user_id);

-- The dispatcher's hot path: find what still needs sending.
create index if not exists reminder_ledger_pending
  on public.reminder_ledger (status, queued_at)
  where status in ('queued','failed');

create index if not exists reminder_ledger_org_queued
  on public.reminder_ledger (org, queued_at desc);

alter table public.reminder_ledger enable row level security;

-- NO app-facing policy. RLS on with zero policies = deny all for every
-- authenticated role. The scheduler and dispatcher run as service_role,
-- which has BYPASSRLS. If client admins should later audit their own
-- org's sends, that is a deliberate SELECT policy scoped to
-- role = 'client_admin' -- NOT is_org_admin(), which includes managers.
revoke all on public.reminder_ledger from anon;
revoke all on public.reminder_ledger from authenticated;

commit;

-- ---------------------------------------------------------------------
-- VERIFY 1: table exists, RLS on, ZERO policies (deny-all).
-- ---------------------------------------------------------------------
select 'POST-TBL' as marker,
       c.relrowsecurity as rls_on,
       (select count(*) from pg_policies
         where tablename = 'reminder_ledger') as policy_count
from pg_class c where c.relname = 'reminder_ledger';

-- ---------------------------------------------------------------------
-- VERIFY 2: the unique index is present. If this returns zero rows the
-- idempotency guarantee does not exist and the dispatcher MUST NOT run.
-- ---------------------------------------------------------------------
select 'POST-IDX' as marker, indexname
from pg_indexes where tablename = 'reminder_ledger' order by indexname;

-- ---------------------------------------------------------------------
-- VERIFY 3: prove the constraint actually bites. Inserts the same
-- logical send twice; the second MUST fail. Rolled back either way, so
-- no test rows survive.
-- ---------------------------------------------------------------------
do $$
declare
  v_failed boolean := false;
begin
  begin
    insert into public.reminder_ledger
      (task_id, org, occurrence_date, threshold_days, recipient_user_id,
       task_title, due_date)
    values
      ('ZZTEST-TASK','ZZTest Org','2026-09-01',7,'ZZTEST-USER','ZZ probe','2026-09-01'),
      ('ZZTEST-TASK','ZZTest Org','2026-09-01',7,'ZZTEST-USER','ZZ probe','2026-09-01');
  exception when unique_violation then
    v_failed := true;
  end;

  if v_failed then
    raise notice 'POST-DUP | PASS | duplicate rejected by unique index';
  else
    raise exception 'POST-DUP | FAIL | duplicate ACCEPTED - the unique index is not working. Do not run the dispatcher.';
  end if;
end $$;

-- Belt and braces: nothing from the probe survived.
select 'POST-CLEAN' as marker, count(*) as zztest_rows
from public.reminder_ledger where task_id like 'ZZTEST%';

-- ---------------------------------------------------------------------
-- VERIFY 4: which one-off tasks WOULD be in scope today, per org
-- timezone. Read-only preview of the scheduler's candidate set --
-- run this before ever enabling the job.
--
-- Note the join: tasks.org holds the org NAME, so it joins to
-- organisations.name. Joining to organisations.id returns nothing.
-- ---------------------------------------------------------------------
select 'PREVIEW' as marker,
       t.id,
       t.title,
       t.org,
       coalesce(o.timezone,'(NULL - WOULD BE SKIPPED)') as tz,
       t.due_date,
       t.due_date - (current_date at time zone coalesce(o.timezone,'UTC'))::date as lead_days,
       case
         when o.timezone is null then 'skipped: no timezone'
         when t.due_date - (current_date at time zone o.timezone)::date <= 2  then 'none'
         when t.due_date - (current_date at time zone o.timezone)::date <= 10 then '2'
         when t.due_date - (current_date at time zone o.timezone)::date <= 30 then '7, 2'
         else '14, 7, 2'
       end as thresholds
from tasks t
left join organisations o on o.name = t.org
where (t.recurrence is null or t.recurrence = '' or t.recurrence = 'once')
  and t.status not in ('approved','awaiting_review')
  and t.due_date is not null
  and t.due_date >= current_date
order by t.due_date;

-- ---------------------------------------------------------------------
-- ROLLBACK
--   drop table if exists public.reminder_ledger;
-- Safe: no other object depends on it and there is no FK.
-- ---------------------------------------------------------------------
