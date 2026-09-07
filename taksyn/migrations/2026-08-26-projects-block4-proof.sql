-- =====================================================================
-- Taksyn — Projects module, BLOCK 4: seed and PROVE propagation
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
-- Date: 26 August 2026
-- Requires: blocks 1, 2, 3 applied.
--
-- A function that compiles is not a function that is correct.  Block 3
-- has a topological walk, per-area matching and a lock guard, none of
-- which have been exercised.  This file exercises all three.
--
-- Seeds on Test Org Alpha (ORG1900000000001).  Every seeded row is
-- prefixed PRJTEST_ and the file deletes them before re-seeding, so it
-- is safe to run repeatedly.
--
-- THE SHAPE
--   Project:  Kitchen refurbishment
--   Section:  Services
--     Package A: Rewire    — tasks in area bar, area kitchen
--     Package B: Plumbing  — tasks in area bar, area kitchen
--     Package C: Sign-off  — one task, DATE LOCKED (the inspection)
--   Links:    Rewire -> Plumbing   (match_by_area, gap 0)
--             Plumbing -> Sign-off (whole package,  gap 0)
--
-- THE FIVE PROOFS
--   1  Nothing late            -> noop
--   2  Rewire-BAR two weeks late -> plumb-BAR moves, plumb-KITCHEN does NOT
--   3  Chain reaches the locked inspection -> 'blocked', date unchanged
--   4  Run twice               -> second run is a noop (idempotent)
--   5  Dry run                 -> tasks table untouched
-- =====================================================================

\set ON_ERROR_STOP on

begin;

do $$
begin
  if exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose found. This looks like LIVE. Sandbox-only.';
  end if;
  if to_regclass('public.project_schedule_events') is null then
    raise exception 'ABORT: block 3 has not been applied.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- Clean any previous run.  Tasks first: they reference the sections.
-- ---------------------------------------------------------------------
delete from public.tasks   where id  like 'PRJTEST_%';
delete from public.projects where ref = 'PRJ-TEST-0001';
delete from public.org_areas
 where org = 'ORG1900000000001' and name in ('Test Bar','Test Kitchen');


-- ---------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------
do $seed$
declare
  v_org     text := 'ORG1900000000001';
  v_proj    uuid;
  v_sec     uuid;
  v_rewire  uuid;
  v_plumb   uuid;
  v_signoff uuid;
  v_bar     uuid;
  v_kitchen uuid;
  -- tasks.org stores the NAME, projects.org stores the ID. They are
  -- joined through project_id, never through org. This is the gremlin
  -- and it is load-bearing, so the seed reproduces it faithfully rather
  -- than tidying it up.
  v_org_name text;
begin
  select name into v_org_name from public.organisations where id = v_org;

  insert into public.org_areas (org, name) values (v_org,'Test Bar')     returning id into v_bar;
  insert into public.org_areas (org, name) values (v_org,'Test Kitchen') returning id into v_kitchen;

  insert into public.projects (org, ref, name, status, start_date, target_end_date)
  values (v_org,'PRJ-TEST-0001','Kitchen refurbishment (test)','active',
          current_date - 30, current_date + 60)
  returning id into v_proj;

  insert into public.project_sections (project_id, parent_id, name, sort_order)
  values (v_proj, null, 'Services', 1) returning id into v_sec;

  insert into public.project_sections (project_id, parent_id, name, sort_order)
  values (v_proj, v_sec, 'Rewire',   1) returning id into v_rewire;
  insert into public.project_sections (project_id, parent_id, name, sort_order)
  values (v_proj, v_sec, 'Plumbing', 2) returning id into v_plumb;
  insert into public.project_sections (project_id, parent_id, name, sort_order)
  values (v_proj, v_sec, 'Sign-off', 3) returning id into v_signoff;

  -- Rewire: both areas due in 5 days, neither complete yet.
  insert into public.tasks (id,title,org,status,due_date,project_id,section_id,area_id)
  values
    ('PRJTEST_RW_BAR','Rewire the bar',        v_org_name,'pending',current_date + 5,v_proj,v_rewire,v_bar),
    ('PRJTEST_RW_KIT','Rewire the kitchen',    v_org_name,'pending',current_date + 5,v_proj,v_rewire,v_kitchen);

  -- Plumbing: both areas due in 10 days. Five days of slack after
  -- rewire, which is why proof 1 must be a noop.
  insert into public.tasks (id,title,org,status,due_date,project_id,section_id,area_id)
  values
    ('PRJTEST_PL_BAR','Plumb the bar',         v_org_name,'pending',current_date + 10,v_proj,v_plumb,v_bar),
    ('PRJTEST_PL_KIT','Plumb the kitchen',     v_org_name,'pending',current_date + 10,v_proj,v_plumb,v_kitchen);

  -- The inspection. No area, LOCKED, 20 days out.
  insert into public.tasks (id,title,org,status,due_date,project_id,section_id,
                            due_date_locked,due_date_lock_reason)
  values
    ('PRJTEST_SO_INS','Health inspection',     v_org_name,'pending',current_date + 20,v_proj,v_signoff,
     true,'Statutory inspection date. Does not move for site delays.');

  insert into public.task_dependencies
    (org,project_id,predecessor_section_id,successor_section_id,gap_days,match_by_area)
  values
    (v_org,v_proj,v_rewire,v_plumb,   0,true),
    (v_org,v_proj,v_plumb, v_signoff, 0,false);

  raise notice 'PRJ-B4-SEED project=%', v_proj;
end
$seed$;

commit;


-- =====================================================================
-- PROOF 1 — nothing is late, so nothing should move.
-- PASS = a single row, kind 'noop'.
-- =====================================================================
select 'PRJ-B4-P1' as marker, kind, task_id, old_due_date, new_due_date, delta_days
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-TEST-0001'), true)
order by kind, task_id;


-- =====================================================================
-- PROOF 2 — rewire the BAR finishes 14 days late.
-- Dry run.
-- PASS = PRJTEST_PL_BAR shifts, PRJTEST_PL_KIT does NOT appear.
-- This is the whole area argument: one drawn link, applied per area,
-- so a delay in the bar does not hold up the kitchen.
-- =====================================================================
update public.tasks
   set completed_at = (current_date + 19)::timestamptz,
       status = 'approved'
 where id = 'PRJTEST_RW_BAR';

select 'PRJ-B4-P2' as marker, kind, task_id, old_due_date, new_due_date, delta_days, note
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-TEST-0001'), true)
order by kind, task_id;


-- =====================================================================
-- PROOF 3 — the same run, looking only at the locked inspection.
-- PASS = one 'blocked' row for PRJTEST_SO_INS whose new_due_date equals
-- its old_due_date, and a note saying what the chain wanted to do.
-- =====================================================================
select 'PRJ-B4-P3' as marker, kind, task_id, old_due_date, new_due_date, note
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-TEST-0001'), true)
where task_id = 'PRJTEST_SO_INS';


-- =====================================================================
-- PROOF 5 (run before 4, because 4 commits) — dry run wrote nothing.
-- PASS = plumb-bar still on its ORIGINAL date, events table empty.
-- =====================================================================
select 'PRJ-B4-P5' as marker,
       (select due_date - current_date from public.tasks where id='PRJTEST_PL_BAR')
         as plumb_bar_days_out_should_be_10,
       (select count(*) from public.project_schedule_events)
         as events_should_be_0;


-- =====================================================================
-- PROOF 4 — apply for real, then run again.
-- PASS = the first run shifts, the SECOND returns only 'noop'.
-- Idempotence is the property that stops "push back two weeks" applied
-- twice becoming four weeks.
-- =====================================================================
select 'PRJ-B4-P4a' as marker, kind, task_id, old_due_date, new_due_date, delta_days
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-TEST-0001'), false)
order by kind, task_id;

select 'PRJ-B4-P4b' as marker, kind, task_id, old_due_date, new_due_date, delta_days
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-TEST-0001'), false)
order by kind, task_id;


-- =====================================================================
-- FINAL STATE
-- Expected after the real run:
--   PRJTEST_PL_BAR  moved out to day 19  (rewire bar finished then)
--   PRJTEST_PL_KIT  unchanged at day 10  (kitchen was never late)
--   PRJTEST_SO_INS  unchanged at day 20  (locked)
-- =====================================================================
select 'PRJ-B4-FINAL' as marker, id, due_date - current_date as days_out,
       due_date_locked, completed_at is not null as done
from public.tasks
where id like 'PRJTEST_%'
order by id;

select 'PRJ-B4-EVENTS' as marker, kind, task_id, delta_days, note
from public.project_schedule_events
order by created_at, task_id;
