-- =====================================================================
-- migration_task_extension_requests.sql
--
-- TASK EXTENSION REQUESTS -- a worker asks for more time on a task,
-- an approver grants or declines, and the ask is recorded either way.
--
-- WHY THIS SHIPS BEFORE ONE-OFF EXPIRY
--   Expiry flags a task missed and archives it once it passes
--   due_date + grace, complete or not. Without a route to ask for more
--   time first, the very first thing expiry does is bin half-finished
--   work with no recourse. The request must exist before the expiry
--   writer is built.
--
-- MODELLED ON plan_change_requests -- DELIBERATELY
--   That table already implements raise / withdraw / approve / decline
--   with an admin queue and a sidebar indicator. Copying its shape means
--   one pattern for "someone asks, someone decides" rather than two.
--   Column names mirror it so the two read the same way.
--
-- ==================== FINDINGS THAT SHAPED THIS ======================
--
-- 1. THE ORG GREMLIN. plan_change_requests.org holds the org ID.
--    tasks.org holds the NAME -- measured, 41 of 41 name-form, 0 ID-form.
--    This table joins conceptually to tasks, so org holds the NAME.
--    Getting this backwards is how org_members_insert ended up silently
--    dead: it called get_my_org() (a name) against a column of IDs and
--    matched 0 of 27 rows with nobody noticing.
--
-- 2. caller_is_org_staff IS MISNAMED. It takes an org NAME (right form)
--    but filters role in ('client_admin','manager') -- it means "org
--    ADMIN", not "org staff". Workers are excluded, so it cannot gate a
--    worker-raised request. Hence caller_is_org_member below: the same
--    join, the same is_active clause, without the role filter.
--
-- 3. ASSIGNMENT IS NOT ENFORCED IN RLS, AND THAT IS A DECISION.
--    Measured across 41 tasks: 40 carry assigned_user_id, 41 carry
--    assigned_user_ids, 17 carry team_id. They OVERLAP rather than being
--    alternatives (the ASSIGNEE-RESOLVER problem). A policy checking all
--    three -- including array containment -- would be fragile, and an RLS
--    policy that is subtly wrong fails SILENTLY.
--
--    So RLS answers the question it is good at: may this person act
--    within this org at all. The UI answers "is this your task" using
--    amAssigned, which already resolves all three forms and is testable.
--    Tenant boundary in the database; assignment in the app.
--
-- 4. INLINE SUBQUERIES ARE AVOIDED. An inline profiles subquery caused a
--    circular dependency in org_members_select, fixed by replacing it
--    with a SECURITY DEFINER function. Same trap, same avoidance.
--
-- APPLY: SANDBOX buqlbmgxevuldahhdbxo FIRST. Do not run on LIVE until
-- the sandbox run is proven end to end through the UI.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. Helper: is the caller an active member of this org, any role?
-- --------------------------------------------------------------------
create or replace function public.caller_is_org_member(target_org_name text)
returns boolean
language sql
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from   org_members m
    join   organisations o on o.id = m.org
    where  m.user_id = auth.uid()
      and  o.name    = target_org_name
      and  m.is_active is not false
  );
$function$;

comment on function public.caller_is_org_member(text) is
  'Active membership in the named org, ANY role. Distinct from caller_is_org_staff, which despite its name is client_admin/manager only. Takes the org NAME, matching tasks.org.';

-- --------------------------------------------------------------------
-- 2. The table
-- --------------------------------------------------------------------
create table if not exists public.task_extension_requests (
  id                  bigserial primary key,
  task_id             text        not null,
  -- org holds the NAME, matching tasks.org. See finding 1.
  org                 text        not null,
  current_due_date    date,
  requested_due_date  date        not null,
  reason              text        not null,
  -- open | approved | declined | withdrawn. Mirrors plan_change_requests.
  status              text        not null default 'open',
  requested_by        uuid        not null,
  requested_by_name   text,
  requested_at        timestamptz not null default now(),
  decided_by          uuid,
  decided_by_name     text,
  decided_at          timestamptz,
  decision_note       text,
  constraint ter_status_chk
    check (status in ('open','approved','declined','withdrawn')),
  -- A later request may not ask for a date on or before the one it
  -- replaces. An "extension" that shortens the window is a defect, not
  -- a request, and it would corrupt the KPI it feeds.
  constraint ter_forward_chk
    check (current_due_date is null or requested_due_date > current_due_date)
);

-- One OPEN request per task. A worker may not stack three asks and
-- treat the pile as pressure; withdrawn and decided rows are unaffected,
-- so the history of every ask survives.
create unique index if not exists ter_one_open_per_task
  on public.task_extension_requests (task_id)
  where status = 'open';

create index if not exists ter_org_status_idx
  on public.task_extension_requests (org, status);

-- NO foreign key to tasks, deliberately and with a caveat.
-- tasks.id is text and task_occurrences/task_worker_times already have
-- no FK to it -- which is exactly why 34 orphaned occurrence rows and 19
-- orphaned worker-time rows were found on LIVE today, one of them a real
-- Kemrose miss still counting against a deleted task. Adding an FK here
-- alone would be inconsistent; adding CASCADE anywhere would DELETE
-- compliance history, which is the opposite of what this product exists
-- to do. The whole family needs one deliberate decision -- recorded as
-- an open item, not resolved by this migration.

-- --------------------------------------------------------------------
-- 3. RLS
-- --------------------------------------------------------------------
alter table public.task_extension_requests enable row level security;

-- SELECT: anyone active in the org. A worker seeing that a colleague
-- asked for more time is not a leak; the whole point is visibility.
drop policy if exists ter_select on public.task_extension_requests;
create policy ter_select on public.task_extension_requests
for select using (
  is_super_admin() or caller_is_org_member(org)
);

-- INSERT: an active member of the org, raising it as themselves, open,
-- undecided. requested_by = auth.uid() stops a request being filed in
-- someone else's name -- the same self-insert hole found in org_members.
drop policy if exists ter_insert on public.task_extension_requests;
create policy ter_insert on public.task_extension_requests
for insert with check (
  caller_is_org_member(org)
  and status = 'open'
  and requested_by = auth.uid()
  and decided_by is null
  and decided_at is null
);

-- UPDATE: two distinct routes, deliberately narrow.
--   an org admin/manager may decide an OPEN request
--   the requester may WITHDRAW their own open request
-- with_check pins the landing state, so an UPDATE cannot move a row to
-- an arbitrary status. This mirrors pcr_update, which restricts the
-- with_check to 'withdrawn' for the same reason.
drop policy if exists ter_update on public.task_extension_requests;
create policy ter_update on public.task_extension_requests
for update using (
  is_super_admin()
  or (caller_is_org_staff(org) and status = 'open')
  or (requested_by = auth.uid() and status = 'open')
) with check (
  is_super_admin()
  or status in ('approved','declined','withdrawn')
);

-- No DELETE policy, and that is the point. A request is a record of
-- someone asking. It is withdrawn or decided, never erased.
-- (Note: user_notifications has no DELETE policy either, but there it is
-- an oversight that makes dismiss inert. Here it is intentional.)

comment on table public.task_extension_requests is
  'Worker asks for more time on a task; approver grants or declines. Prerequisite for one-off expiry: without it, expiry bins half-finished work with no recourse. org holds the NAME, matching tasks.org.';
