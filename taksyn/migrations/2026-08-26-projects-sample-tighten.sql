-- =====================================================================
-- Taksyn — sample project: make the delay actually propagate
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
-- Date: 26 August 2026
-- Requires: 2026-08-26-projects-sample-demo-care.sql already seeded.
--
-- THE PROBLEM WITH THE SAMPLE AS SEEDED
-- recompute_project_dates returned noop. Riverside's electrical work is
-- overdue and incomplete, so its finish reads as TODAY — but the
-- Riverside safety checks sat six days out, so there was slack and
-- correctly nothing moved. The engine was right; the sample dates were
-- too generous to demonstrate what the sample exists to demonstrate.
--
-- THE FIX
-- Pull the Riverside safety checks in so the chain genuinely presses on
-- them. Hilltop stays where it is. Then propagation has something real
-- to do, and does it to ONE area only.
--
-- WHAT YOU SHOULD SEE AFTERWARDS
--   Riverside safety checks pushed out, Hilltop untouched.
--   In the section view: two bars on separate rows, Hilltop sitting to
--   the LEFT of Riverside even though they are the same trade, because
--   one area was held up and the other was not.
--
-- That single picture is the whole per-area argument, and it is the
-- thing no other planner can draw.
-- =====================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
begin
  if exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose found. This looks like LIVE. Sandbox-only.';
  end if;
  if not exists (select 1 from public.projects where ref='PRJ-SAMPLE-0001') then
    raise exception 'ABORT: the sample project has not been seeded.';
  end if;
end $$;

-- Riverside safety checks: pull them in to just after today, so the
-- chain (electrical finishes today + 1 day to make good) presses on
-- them rather than clearing them by a week.
update public.tasks set due_date = current_date + 1 where id = 'SAMPLE_SAF_1';
update public.tasks set due_date = current_date + 3 where id = 'SAMPLE_SAF_2';

-- Hilltop is deliberately left alone. Its electrical work finished on
-- time, so nothing should touch it, and its bars are the control in
-- this experiment.

select 'TIGHTEN-BEFORE' as marker, id, title, due_date, due_date - current_date as days_out
from public.tasks
where id in ('SAMPLE_SAF_1','SAMPLE_SAF_2','SAMPLE_SAF_3','SAMPLE_SAF_4','SAMPLE_AUD_1')
order by id;

-- Dry run first: see what it intends to do before it does it.
select 'TIGHTEN-DRY' as marker, kind, task_id, old_due_date, new_due_date, delta_days, note
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-SAMPLE-0001'), true)
order by kind, task_id;

-- Apply.
select 'TIGHTEN-APPLY' as marker, kind, task_id, old_due_date, new_due_date, delta_days, note
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-SAMPLE-0001'), false)
order by kind, task_id;

-- Idempotence check on real data, not a test fixture.
select 'TIGHTEN-AGAIN' as marker, kind, task_id, note
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-SAMPLE-0001'), false);

-- The proof: Riverside moved, Hilltop did not.
select 'TIGHTEN-AFTER' as marker, id, title, due_date - current_date as days_out
from public.tasks
where id in ('SAMPLE_SAF_1','SAMPLE_SAF_2','SAMPLE_SAF_3','SAMPLE_SAF_4','SAMPLE_AUD_1')
order by id;

-- And whether the audit gate is now flagged at risk.
select 'TIGHTEN-MILESTONES' as marker, name, due_date - current_date as days_out,
       status, date_locked, tasks_open, blockers_open, at_risk, latest_open_due
from public.project_milestone_state
where project_id = (select id from public.projects where ref='PRJ-SAMPLE-0001')
order by due_date;
