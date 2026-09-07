-- =====================================================================
-- Taksyn — sample project: make the delay real (v2)
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
--
-- WHY v1 STILL RETURNED noop
-- Riverside electrical is overdue and incomplete, so its finish reads as
-- TODAY. The link carries gap_days = 1, so the successor is required to
-- start at today + 1. v1 moved the Riverside safety checks to exactly
-- today + 1 — the boundary. Delta was 0, and the function pushes only on
-- a STRICTLY positive delta, by design: push-only, never pull, and never
-- churn on a zero.
--
-- The engine was right both times. The sample was wrong both times.
--
-- v2 CHANGES THE STORY INSTEAD OF THE BOUNDARY
-- The Riverside switchboard upgrade is in progress and has been
-- re-scheduled to finish in 8 days — which is what actually happens on
-- site when a contractor hits a problem. Everything downstream in that
-- area then has to move, and the amount it moves is not a rounding
-- error.
--
-- EXPECTED AFTER THIS
--   Riverside fire safety      +1  ->  +9
--   Riverside egress check     +3  -> +11
--   Hilltop fire safety        +4  ->  unchanged
--   Hilltop egress check       +7  ->  unchanged
--
-- One area held up, the other untouched, from one drawn link. In the
-- section view the Hilltop bar then sits clearly LEFT of the Riverside
-- bar in the same package — which is the picture worth showing anyone.
-- =====================================================================

\set ON_ERROR_STOP on
set client_min_messages = warning;

do $$
begin
  if exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose found. This looks like LIVE. Sandbox-only.';
  end if;
  if not exists (select 1 from public.projects where ref='PRJ-SAMPLE-0001') then
    raise exception 'ABORT: the sample project has not been seeded.';
  end if;
end $$;

-- The switchboard hit a problem and has been re-scheduled. Still in
-- progress, now finishing in 8 days.
update public.tasks
   set due_date = current_date + 8, status = 'in_progress'
 where id = 'SAMPLE_ELE_1';

-- Emergency lighting follows it on site, a couple of days behind.
update public.tasks
   set due_date = current_date + 10
 where id = 'SAMPLE_ELE_2';

-- Riverside safety checks sit where they were originally planned. They
-- are about to be pushed, and that push is the point.
update public.tasks set due_date = current_date + 1 where id = 'SAMPLE_SAF_1';
update public.tasks set due_date = current_date + 3 where id = 'SAMPLE_SAF_2';

-- Hilltop untouched. It is the control.

select 'V2-BEFORE' as marker, id, title, due_date - current_date as days_out, status
from public.tasks
where id like 'SAMPLE_ELE_%' or id like 'SAMPLE_SAF_%'
order by id;

-- Dry run: what it intends.
select 'V2-DRY' as marker, kind, task_id, old_due_date, new_due_date, delta_days, note
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-SAMPLE-0001'), true)
order by kind, task_id;

-- Apply.
select 'V2-APPLY' as marker, kind, task_id, old_due_date, new_due_date, delta_days
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-SAMPLE-0001'), false)
order by kind, task_id;

-- Idempotence on real data.
select 'V2-AGAIN' as marker, kind, task_id, note
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-SAMPLE-0001'), false);

-- The proof: Riverside moved, Hilltop did not.
select 'V2-AFTER' as marker, id, title, due_date - current_date as days_out
from public.tasks
where id like 'SAMPLE_SAF_%' or id = 'SAMPLE_AUD_1'
order by id;

select 'V2-MILESTONES' as marker, name, due_date - current_date as days_out,
       status, date_locked, tasks_open, blockers_open, at_risk, latest_open_due
from public.project_milestone_state
where project_id = (select id from public.projects where ref='PRJ-SAMPLE-0001')
order by due_date;
