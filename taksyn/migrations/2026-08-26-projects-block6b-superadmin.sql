
-- Taksyn — Projects module, BLOCK 6b: super admin access
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
-- Date: 26 August 2026
-- Requires: block 6 applied.
--
-- Block 6 wrote nine policies and none of them mentioned
-- is_super_admin(), so a super admin currently sees no projects in any
-- org. Every comparable table already handles this.
--
-- THE ESTABLISHED PATTERN, read from pg_policies rather than assumed:
--   tenant data      (organisations, profiles, plan_change_requests,
--                     task_extension_requests) -> SELECT and UPDATE
--   platform config  (incident_category_packs, org_industry_links)
--                                              -> ALL
--
-- Projects are tenant data, so: read everywhere, write parity with an
-- org admin, and NO exception to the immutability of schedule events.
-- A super admin who can edit the record of what the system moved is a
-- super admin who can rewrite an audit trail, and nothing about the
-- role justifies that.
--
-- is_super_admin() reads profiles.role, not org_members.role. Different
-- table from the is_org_* family, which is why it takes no argument.
-- =====================================================================

begin;

do $$
begin
  if exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose found. This looks like LIVE. Sandbox-only.';
  end if;
end $$;


-- projects ------------------------------------------------------------
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (public.is_org_member(org) or public.is_super_admin());

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using      (public.is_org_admin(org) or public.is_super_admin())
  with check (public.is_org_admin(org) or public.is_super_admin());


-- project_sections ----------------------------------------------------
drop policy if exists project_sections_select on public.project_sections;
create policy project_sections_select on public.project_sections
  for select to authenticated
  using (
    public.is_super_admin()
    or exists (select 1 from public.projects p
               where p.id = project_sections.project_id
                 and public.is_org_member(p.org))
  );

drop policy if exists project_sections_write on public.project_sections;
create policy project_sections_write on public.project_sections
  for all to authenticated
  using (
    public.is_super_admin()
    or exists (select 1 from public.projects p
               where p.id = project_sections.project_id
                 and public.is_org_admin(p.org))
  )
  with check (
    public.is_super_admin()
    or exists (select 1 from public.projects p
               where p.id = project_sections.project_id
                 and public.is_org_admin(p.org))
  );


-- org_areas -----------------------------------------------------------
drop policy if exists org_areas_select on public.org_areas;
create policy org_areas_select on public.org_areas
  for select to authenticated
  using (public.is_org_member(org) or public.is_super_admin());

drop policy if exists org_areas_update on public.org_areas;
create policy org_areas_update on public.org_areas
  for update to authenticated
  using      (public.is_org_admin(org) or public.is_super_admin())
  with check (public.is_org_admin(org) or public.is_super_admin());


-- task_dependencies ---------------------------------------------------
drop policy if exists task_dependencies_select on public.task_dependencies;
create policy task_dependencies_select on public.task_dependencies
  for select to authenticated
  using (public.is_org_member(org) or public.is_super_admin());

drop policy if exists task_dependencies_write on public.task_dependencies;
create policy task_dependencies_write on public.task_dependencies
  for all to authenticated
  using      (public.is_org_admin(org) or public.is_super_admin())
  with check (public.is_org_admin(org) or public.is_super_admin());


-- project_schedule_events ---------------------------------------------
-- SELECT widened. UPDATE and DELETE remain policy-less for EVERY role,
-- super admin included. This is the one place the pattern is
-- deliberately not followed, and the reason is in the header.
drop policy if exists project_schedule_events_select on public.project_schedule_events;
create policy project_schedule_events_select on public.project_schedule_events
  for select to authenticated
  using (public.is_org_member(org) or public.is_super_admin());

commit;


-- =====================================================================
-- PROOF — notices ON this time.
--
-- Block 6 set client_min_messages to warning, which swallowed its own
-- PASS notices. The tests were still valid (each raises an exception on
-- failure, and no error appeared), but "no error" is weaker evidence
-- than a printed result. Fixed here.
-- =====================================================================
set client_min_messages = notice;

-- T6 — a non-member who is NOT a super admin still sees nothing.
-- Widening access is exactly when this needs re-asking.
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-0000000000ff')::text, true);
set local role authenticated;

do $t6$
declare v_p integer; v_s integer; v_a integer; v_e integer; v_d integer;
begin
  select count(*) into v_p from public.projects;
  select count(*) into v_s from public.project_sections;
  select count(*) into v_a from public.org_areas;
  select count(*) into v_e from public.project_schedule_events;
  select count(*) into v_d from public.task_dependencies;

  if v_p+v_s+v_a+v_e+v_d = 0 then
    raise notice 'PRJ-B6B-T6 PASS: non-member still sees nothing after widening';
  else
    raise exception 'PRJ-B6B-T6 FAIL: p=% s=% a=% e=% d=%', v_p,v_s,v_a,v_e,v_d;
  end if;
end $t6$;

reset role;
rollback;


-- T7 — a worker still cannot write, and still can read.
begin;
select set_config('request.jwt.claims',
  json_build_object('sub',
    (select m.user_id::text from public.org_members m
     where m.org='ORG1900000000001' and m.role='worker'
       and m.user_id is not null and m.is_active is not false limit 1)
  )::text, true);
set local role authenticated;

do $t7$
declare v_read integer; v_n integer;
begin
  select count(*) into v_read from public.projects;

  update public.projects set name='WORKER SHOULD NOT DO THIS' where ref='PRJ-TEST-0001';
  get diagnostics v_n = row_count;

  if v_read >= 1 and v_n = 0 then
    raise notice 'PRJ-B6B-T7 PASS: worker reads % project(s), writes blocked', v_read;
  else
    raise exception 'PRJ-B6B-T7 FAIL: read=% wrote=%', v_read, v_n;
  end if;
end $t7$;

reset role;
rollback;


-- T8 — schedule events remain immutable for a client_admin.
-- Re-asked because 6b touched that table's SELECT policy.
begin;
select set_config('request.jwt.claims',
  json_build_object('sub',
    (select m.user_id::text from public.org_members m
     where m.org='ORG1900000000001' and m.role='client_admin'
       and m.user_id is not null and m.is_active is not false limit 1)
  )::text, true);
set local role authenticated;

do $t8$
declare v_u integer; v_d integer; v_r integer;
begin
  select count(*) into v_r from public.project_schedule_events;
  update public.project_schedule_events set note='tampered';
  get diagnostics v_u = row_count;
  delete from public.project_schedule_events;
  get diagnostics v_d = row_count;

  if v_u = 0 and v_d = 0 then
    raise notice 'PRJ-B6B-T8 PASS: % event(s) readable, 0 updatable, 0 deletable', v_r;
  else
    raise exception 'PRJ-B6B-T8 FAIL: updated %, deleted %', v_u, v_d;
  end if;
end $t8$;

reset role;
rollback;


-- Final inventory. Every policy should now name is_super_admin except
-- the ones that do not exist at all.
select 'PRJ-B6B-POL' as marker, tablename, policyname, cmd,
       (qual ilike '%is_super_admin%') as super_in_using
from pg_policies
where schemaname='public'
  and tablename in ('projects','project_sections','org_areas',
                    'task_dependencies','project_schedule_events')
order by tablename, cmd, policyname;
