-- =====================================================================
-- Taksyn — Projects module, BLOCK 6: RLS policies
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
-- Date: 26 August 2026
-- Requires: blocks 1-3, 5 applied.
--
-- Five tables have had RLS ENABLED WITH NO POLICIES since block 1,
-- which means deny-all to anon and authenticated.  This writes the
-- policies.
--
-- AND PROVES THEM.  Policies that are written but never exercised are
-- policies nobody knows work — the 2 August parity audit found 17
-- sandbox tables with RLS off and every "proven on sandbox" result
-- touching them had to be re-examined.  psql connects as postgres and
-- bypasses RLS, so the proof section sets request.jwt.claims and
-- switches to the authenticated role, which makes auth.uid() resolve
-- to a real user.  That is a genuine test, not an inspection.
--
-- THE MODEL
--   projects, sections, areas, links, events   -> readable by any
--       ACTIVE member of the org
--   writes                                     -> org admins
--   projects INSERT, org_areas INSERT          -> NO POLICY, on purpose
--   project_schedule_events UPDATE/DELETE      -> NO POLICY, on purpose
--
-- Why a worker can read the project skeleton: the timeline is DRAWN
-- from tasks, and tasks already has its own RLS.  A worker querying
-- tasks gets their own, so their timeline shows their own bars without
-- any project-level rule needing to know about assignment.  Duplicating
-- assignment logic here would be a second place to get it wrong.
--
-- Why projects has no INSERT policy: ref is NOT NULL and is allocated
-- by next_project_ref inside create_project.  A direct insert cannot
-- produce a valid ref, so forcing the RPC is not a restriction, it is
-- the only path that works.  Same for org_areas: create_org_area is
-- where the similar-name guard lives, and an insert that goes round it
-- goes round the guard.
--
-- Why schedule events cannot be updated or deleted by anyone: they are
-- the record of what the system moved and what it refused to move.  An
-- editable audit trail is not one.
-- =====================================================================

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
-- projects
-- ---------------------------------------------------------------------
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (public.is_org_member(org));

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using (public.is_org_admin(org))
  with check (public.is_org_admin(org));

-- Deleting a project would orphan its schedule events and take its
-- sections with it. Archiving is status='cancelled'. No delete policy.


-- ---------------------------------------------------------------------
-- project_sections
--
-- Scoped through the parent project rather than carrying its own org
-- column. One source of truth for which org a section belongs to.
-- ---------------------------------------------------------------------
drop policy if exists project_sections_select on public.project_sections;
create policy project_sections_select on public.project_sections
  for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_sections.project_id
      and public.is_org_member(p.org)
  ));

drop policy if exists project_sections_write on public.project_sections;
create policy project_sections_write on public.project_sections
  for all to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_sections.project_id
      and public.is_org_admin(p.org)
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = project_sections.project_id
      and public.is_org_admin(p.org)
  ));


-- ---------------------------------------------------------------------
-- org_areas
--
-- No INSERT policy: create_org_area holds the similar-name guard.
-- UPDATE is allowed so an admin can rename or deactivate; the unique
-- index still refuses an exact collision on rename.
-- ---------------------------------------------------------------------
drop policy if exists org_areas_select on public.org_areas;
create policy org_areas_select on public.org_areas
  for select to authenticated
  using (public.is_org_member(org));

drop policy if exists org_areas_update on public.org_areas;
create policy org_areas_update on public.org_areas
  for update to authenticated
  using (public.is_org_admin(org))
  with check (public.is_org_admin(org));

-- No delete: an area referenced by tasks should be deactivated, not
-- removed. tasks.area_id is ON DELETE SET NULL, so a delete would
-- silently strip the area off historical work.


-- ---------------------------------------------------------------------
-- task_dependencies
-- ---------------------------------------------------------------------
drop policy if exists task_dependencies_select on public.task_dependencies;
create policy task_dependencies_select on public.task_dependencies
  for select to authenticated
  using (public.is_org_member(org));

drop policy if exists task_dependencies_write on public.task_dependencies;
create policy task_dependencies_write on public.task_dependencies
  for all to authenticated
  using (public.is_org_admin(org))
  with check (public.is_org_admin(org));


-- ---------------------------------------------------------------------
-- project_schedule_events — read only, for everyone.
--
-- Written by recompute_project_dates, which is SECURITY DEFINER and
-- therefore bypasses RLS. No INSERT, UPDATE or DELETE policy exists,
-- so no client can write, alter or remove one. That is the point.
-- ---------------------------------------------------------------------
drop policy if exists project_schedule_events_select on public.project_schedule_events;
create policy project_schedule_events_select on public.project_schedule_events
  for select to authenticated
  using (public.is_org_member(org));

commit;


-- =====================================================================
-- PROOF — actually exercise the policies.
--
-- Each test sets request.jwt.claims to a real user's id and switches to
-- the authenticated role, so auth.uid() resolves and the policies
-- apply. Everything runs inside a transaction that rolls back.
-- =====================================================================
set client_min_messages = warning;

-- Which users are we impersonating?
select 'PRJ-B6-WHO' as marker, m.role, m.user_id, o.name as org_name
from public.org_members m
join public.organisations o on o.id = m.org
where m.org = 'ORG1900000000001'
  and m.user_id is not null
  and m.is_active is not false
  and m.role in ('worker','client_admin')
order by m.role
limit 4;


-- ---------------------------------------------------------------------
-- T1 — a WORKER in Test Org Alpha can READ the project skeleton.
-- PASS = at least one project visible.
-- ---------------------------------------------------------------------
begin;
select set_config('request.jwt.claims',
  json_build_object('sub',
    (select m.user_id::text from public.org_members m
     where m.org='ORG1900000000001' and m.role='worker'
       and m.user_id is not null and m.is_active is not false limit 1)
  )::text, true);
set local role authenticated;

select 'PRJ-B6-T1' as marker,
       (select count(*) from public.projects)                as projects_visible,
       (select count(*) from public.project_sections)        as sections_visible,
       (select count(*) from public.org_areas)               as areas_visible,
       (select count(*) from public.task_dependencies)       as links_visible;

reset role;
rollback;


-- ---------------------------------------------------------------------
-- T2 — a worker CANNOT write.
-- PASS = the update affects 0 rows (RLS filters it out silently, which
-- is how a policy denial looks from the client side — no error).
-- ---------------------------------------------------------------------
begin;
select set_config('request.jwt.claims',
  json_build_object('sub',
    (select m.user_id::text from public.org_members m
     where m.org='ORG1900000000001' and m.role='worker'
       and m.user_id is not null and m.is_active is not false limit 1)
  )::text, true);
set local role authenticated;

do $t2$
declare v_n integer;
begin
  update public.projects set name = 'WORKER SHOULD NOT DO THIS'
   where ref = 'PRJ-TEST-0001';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise notice 'PRJ-B6-T2 PASS: worker update blocked (0 rows)';
  else
    raise exception 'PRJ-B6-T2 FAIL: worker updated % project row(s)', v_n;
  end if;
end $t2$;

reset role;
rollback;


-- ---------------------------------------------------------------------
-- T3 — a CLIENT_ADMIN in the same org CAN write.
-- PASS = 1 row updated.  Rolled back either way.
-- ---------------------------------------------------------------------
begin;
select set_config('request.jwt.claims',
  json_build_object('sub',
    (select m.user_id::text from public.org_members m
     where m.org='ORG1900000000001' and m.role='client_admin'
       and m.user_id is not null and m.is_active is not false limit 1)
  )::text, true);
set local role authenticated;

do $t3$
declare v_n integer;
begin
  update public.projects set description = 'admin write test'
   where ref = 'PRJ-TEST-0001';
  get diagnostics v_n = row_count;
  if v_n = 1 then
    raise notice 'PRJ-B6-T3 PASS: client_admin update allowed';
  else
    raise exception 'PRJ-B6-T3 FAIL: expected 1 row, got %', v_n;
  end if;
end $t3$;

reset role;
rollback;


-- ---------------------------------------------------------------------
-- T4 — a stranger (valid uuid, member of nothing) sees NOTHING.
-- This is the test that matters. A policy that lets everyone read is
-- not a policy, and it looks identical to a working one until someone
-- outside the org is asked.
-- ---------------------------------------------------------------------
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-0000000000ff')::text, true);
set local role authenticated;

do $t4$
declare v_p integer; v_s integer; v_a integer; v_e integer;
begin
  select count(*) into v_p from public.projects;
  select count(*) into v_s from public.project_sections;
  select count(*) into v_a from public.org_areas;
  select count(*) into v_e from public.project_schedule_events;

  if v_p = 0 and v_s = 0 and v_a = 0 and v_e = 0 then
    raise notice 'PRJ-B6-T4 PASS: non-member sees nothing';
  else
    raise exception 'PRJ-B6-T4 FAIL: non-member saw projects=% sections=% areas=% events=%',
      v_p, v_s, v_a, v_e;
  end if;
end $t4$;

reset role;
rollback;


-- ---------------------------------------------------------------------
-- T5 — nobody can alter or delete a schedule event.
-- There is no UPDATE or DELETE policy, so both must affect 0 rows even
-- for a client_admin. An editable audit trail is not an audit trail.
-- ---------------------------------------------------------------------
begin;
select set_config('request.jwt.claims',
  json_build_object('sub',
    (select m.user_id::text from public.org_members m
     where m.org='ORG1900000000001' and m.role='client_admin'
       and m.user_id is not null and m.is_active is not false limit 1)
  )::text, true);
set local role authenticated;

do $t5$
declare v_u integer; v_d integer;
begin
  update public.project_schedule_events set note = 'tampered';
  get diagnostics v_u = row_count;
  delete from public.project_schedule_events;
  get diagnostics v_d = row_count;

  if v_u = 0 and v_d = 0 then
    raise notice 'PRJ-B6-T5 PASS: schedule events are immutable (update 0, delete 0)';
  else
    raise exception 'PRJ-B6-T5 FAIL: updated %, deleted %', v_u, v_d;
  end if;
end $t5$;

reset role;
rollback;


-- ---------------------------------------------------------------------
-- Policy inventory, and a check for a super-admin helper.
--
-- Super admins work across orgs and no is_org_* helper covers them, so
-- if a cross-org helper exists these policies should probably call it.
-- Reporting rather than guessing: adding a super-admin clause on an
-- assumption would widen access on an assumption.
-- ---------------------------------------------------------------------
select 'PRJ-B6-POL' as marker, tablename, policyname, cmd
from pg_policies
where schemaname='public'
  and tablename in ('projects','project_sections','org_areas',
                    'task_dependencies','project_schedule_events')
order by tablename, cmd, policyname;

select 'PRJ-B6-SUPER' as marker, p.proname,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and (p.proname ilike '%super%' or p.proname ilike '%platform%')
order by p.proname;
