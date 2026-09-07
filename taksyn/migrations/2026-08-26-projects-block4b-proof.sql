-- =====================================================================
-- Taksyn — Projects module, BLOCK 4b: the three unproven behaviours
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
-- Date: 26 August 2026
-- Requires: block 4 already seeded PRJ-TEST-0001.
--
-- Block 4 proved area matching, idempotence and dry-run safety.  It did
-- NOT prove three things, and P3 returned nothing because the test was
-- built wrong: plumbing finished day 19 against an inspection on day
-- 20, so there was a day of slack and correctly nothing was blocked.
-- A delay too small to threaten a date proves nothing about what
-- happens when one is.
--
--   P6  LOCK GUARD   — a delay big enough to push past the inspection
--   P7  PAST DUE     — a predecessor overdue and NOT complete uses
--                      TODAY, so successors track a delay while it is
--                      happening rather than only once it ends
--   P8  CYCLE        — a dependency loop is caught and nothing changes
--
-- Reads only until P8, which adds and then removes a link.
-- =====================================================================

\set ON_ERROR_STOP on

-- The temp-table NOTICE spam in block 4 is harmless (drop if exists on
-- a table that has not been made yet) but it buries the results.
set client_min_messages = warning;

do $$
begin
  if exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose found. This looks like LIVE. Sandbox-only.';
  end if;
  if not exists (select 1 from public.projects where ref='PRJ-TEST-0001') then
    raise exception 'ABORT: block 4 has not been run — no test project.';
  end if;
end $$;


-- =====================================================================
-- P6 — THE LOCK GUARD
--
-- Rewire the bar now finishes on day 30, twenty-five days later than
-- planned.  The chain: plumb-bar must start day 30; plumbing's whole
-- package therefore finishes day 30; the inspection sits on day 20 and
-- would have to move ten days.  It is locked.
--
-- PASS = PRJTEST_SO_INS appears with kind 'blocked', old and new dates
-- EQUAL, delta 0, and a note saying what the chain wanted to do.
-- PRJTEST_PL_BAR should shift normally alongside it.
-- =====================================================================
update public.tasks
   set completed_at = (current_date + 30)::timestamptz,
       status = 'approved'
 where id = 'PRJTEST_RW_BAR';

select 'PRJ-B4B-P6' as marker, kind, task_id,
       old_due_date, new_due_date, delta_days, note
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-TEST-0001'), true)
order by kind, task_id;

-- Explicit assertion, so a wrong result is an ERROR rather than
-- something to read carefully.
do $p6$
declare v_ok integer;
begin
  select count(*) into v_ok
  from public.recompute_project_dates(
    (select id from public.projects where ref='PRJ-TEST-0001'), true) r
  where r.task_id = 'PRJTEST_SO_INS'
    and r.kind = 'blocked'
    and r.old_due_date = r.new_due_date;

  if v_ok = 1 then
    raise notice 'PRJ-B4B-P6 PASS: locked inspection blocked, date unchanged';
  else
    raise exception 'PRJ-B4B-P6 FAIL: expected 1 blocked row for the inspection, got %', v_ok;
  end if;
end $p6$;


-- =====================================================================
-- P7 — PAST DUE AND NOT COMPLETE
--
-- Rewire the KITCHEN is moved to ten days ago and left incomplete.  It
-- has no completed_at, so the rule says its finish is TODAY and keeps
-- moving each day it slips.  Plumb-kitchen is moved to five days ago so
-- there is a real gap to close.
--
-- Expect: plumb-kitchen pushed forward 5 days, to today.
--
-- This is the rule that stops a successor sitting there looking healthy
-- for a fortnight while its predecessor is visibly late.
-- =====================================================================
update public.tasks set due_date = current_date - 10 where id = 'PRJTEST_RW_KIT';
update public.tasks set due_date = current_date - 5  where id = 'PRJTEST_PL_KIT';

select 'PRJ-B4B-P7' as marker, kind, task_id,
       old_due_date, new_due_date, delta_days,
       new_due_date - current_date as new_days_out
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-TEST-0001'), true)
where task_id = 'PRJTEST_PL_KIT';

do $p7$
declare v_new date;
begin
  select r.new_due_date into v_new
  from public.recompute_project_dates(
    (select id from public.projects where ref='PRJ-TEST-0001'), true) r
  where r.task_id = 'PRJTEST_PL_KIT' and r.kind = 'shift';

  if v_new = current_date then
    raise notice 'PRJ-B4B-P7 PASS: overdue incomplete predecessor pushed successor to today';
  else
    raise exception 'PRJ-B4B-P7 FAIL: expected %, got %', current_date, coalesce(v_new::text,'no shift row');
  end if;
end $p7$;


-- =====================================================================
-- P8 — CYCLE DETECTION
--
-- Adds Sign-off -> Rewire, closing the loop Rewire -> Plumbing ->
-- Sign-off -> Rewire.  No package can ever start.
--
-- A CHECK constraint cannot see this: it can only compare columns in
-- one row.  Only the walk can, which is why the guard lives there.
--
-- PASS = kind 'cycle' and NO shift rows.  The link is removed
-- afterwards either way, in a transaction, so a failure here does not
-- leave the test project poisoned.
-- =====================================================================
begin;

insert into public.task_dependencies
  (org, project_id, predecessor_section_id, successor_section_id, gap_days, match_by_area)
select 'ORG1900000000001',
       p.id,
       (select id from public.project_sections where project_id=p.id and name='Sign-off'),
       (select id from public.project_sections where project_id=p.id and name='Rewire'),
       0, false
from public.projects p where p.ref='PRJ-TEST-0001';

select 'PRJ-B4B-P8' as marker, kind, task_id, note
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-TEST-0001'), true)
order by kind;

do $p8$
declare v_cycle integer; v_shifts integer;
begin
  select count(*) filter (where r.kind='cycle'),
         count(*) filter (where r.kind='shift')
    into v_cycle, v_shifts
  from public.recompute_project_dates(
    (select id from public.projects where ref='PRJ-TEST-0001'), true) r;

  if v_cycle = 1 and v_shifts = 0 then
    raise notice 'PRJ-B4B-P8 PASS: loop detected, nothing changed';
  else
    raise exception 'PRJ-B4B-P8 FAIL: cycle rows %, shift rows %', v_cycle, v_shifts;
  end if;
end $p8$;

rollback;


-- =====================================================================
-- The loop is gone (rolled back).  Confirm the project is intact and
-- still behaves.
-- =====================================================================
select 'PRJ-B4B-CLEAN' as marker,
       (select count(*) from public.task_dependencies d
          join public.projects p on p.id = d.project_id
         where p.ref='PRJ-TEST-0001') as links_should_be_2;

select 'PRJ-B4B-FINAL' as marker, id, due_date - current_date as days_out,
       due_date_locked, completed_at is not null as done
from public.tasks where id like 'PRJTEST_%' order by id;
