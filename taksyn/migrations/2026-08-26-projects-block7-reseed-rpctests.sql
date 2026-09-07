-- =====================================================================
-- Taksyn — Projects module, BLOCK 7: clean re-seed + RPC authorization
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
-- Date: 26 August 2026
-- Requires: blocks 1-6b applied.
--
-- PART A  Re-seed PRJ-TEST-0001 CLEAN.
--         Block 4b deliberately left overdue tasks and a completion
--         date 30 days in the future — correct for exercising a
--         dependency engine, wrong-looking if a UI is pointed at it.
--         Re-running block 4 would just recreate the mess, because its
--         proofs are what make it. This seeds and stops.
--
-- PART B  Prove create_project, create_org_area and sign_off_project.
--         These are the only pieces still unproven: they need
--         auth.uid(), which is null under psql as postgres. Same
--         technique that proved RLS — set request.jwt.claims, switch to
--         the authenticated role, and the functions see a real user.
--
-- Every test runs in a transaction that rolls back. Nothing in part B
-- survives the run.
-- =====================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
begin
  if exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose found. This looks like LIVE. Sandbox-only.';
  end if;
end $$;


-- =====================================================================
-- PART A — CLEAN SEED
-- =====================================================================
begin;

delete from public.project_schedule_events
 where project_id in (select id from public.projects where ref='PRJ-TEST-0001');
delete from public.tasks    where id  like 'PRJTEST_%';
delete from public.projects where ref = 'PRJ-TEST-0001';
delete from public.org_areas
 where org = 'ORG1900000000001' and name in ('Test Bar','Test Kitchen');

do $seed$
declare
  v_org      text := 'ORG1900000000001';
  v_org_name text;
  v_proj     uuid;
  v_sec      uuid;
  v_rewire   uuid;
  v_plumb    uuid;
  v_signoff  uuid;
  v_bar      uuid;
  v_kitchen  uuid;
begin
  select name into v_org_name from public.organisations where id = v_org;

  insert into public.org_areas (org,name) values (v_org,'Test Bar')     returning id into v_bar;
  insert into public.org_areas (org,name) values (v_org,'Test Kitchen') returning id into v_kitchen;

  insert into public.projects (org,ref,name,description,status,start_date,target_end_date)
  values (v_org,'PRJ-TEST-0001','Kitchen refurbishment (test)',
          'Seeded test project for the projects module. Safe to delete.',
          'active', current_date - 7, current_date + 45)
  returning id into v_proj;

  insert into public.project_sections (project_id,parent_id,name,sort_order)
  values (v_proj,null,'Services',1) returning id into v_sec;

  insert into public.project_sections (project_id,parent_id,name,sort_order)
  values (v_proj,v_sec,'Rewire',1)   returning id into v_rewire;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
  values (v_proj,v_sec,'Plumbing',2) returning id into v_plumb;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
  values (v_proj,v_sec,'Sign-off',3) returning id into v_signoff;

  -- All future-dated, none complete, none overdue. A healthy project.
  insert into public.tasks (id,title,org,status,due_date,project_id,section_id,area_id)
  values
    ('PRJTEST_RW_BAR','Rewire the bar',    v_org_name,'pending',current_date + 5, v_proj,v_rewire,v_bar),
    ('PRJTEST_RW_KIT','Rewire the kitchen',v_org_name,'pending',current_date + 8, v_proj,v_rewire,v_kitchen),
    ('PRJTEST_PL_BAR','Plumb the bar',     v_org_name,'pending',current_date + 12,v_proj,v_plumb, v_bar),
    ('PRJTEST_PL_KIT','Plumb the kitchen', v_org_name,'pending',current_date + 15,v_proj,v_plumb, v_kitchen);

  insert into public.tasks (id,title,org,status,due_date,project_id,section_id,
                            due_date_locked,due_date_lock_reason)
  values ('PRJTEST_SO_INS','Health inspection',v_org_name,'pending',current_date + 30,
          v_proj,v_signoff,true,
          'Statutory inspection date. Does not move for site delays.');

  insert into public.task_dependencies
    (org,project_id,predecessor_section_id,successor_section_id,gap_days,match_by_area)
  values
    (v_org,v_proj,v_rewire,v_plumb,   0,true),
    (v_org,v_proj,v_plumb, v_signoff, 0,false);
end $seed$;

commit;

-- Confirm the seed is healthy: nothing overdue, nothing complete, and a
-- dry run that finds nothing to do.
select 'PRJ-B7-SEED' as marker, id, due_date - current_date as days_out,
       due_date_locked, completed_at is not null as done
from public.tasks where id like 'PRJTEST_%' order by due_date;

select 'PRJ-B7-DRY' as marker, kind, task_id, note
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-TEST-0001'), true);


-- =====================================================================
-- PART B — RPC AUTHORIZATION
-- =====================================================================

-- ---------------------------------------------------------------------
-- R1 — a WORKER cannot create a project.
-- PASS = the function raises 'not permitted'.
-- ---------------------------------------------------------------------
begin;
select set_config('request.jwt.claims', json_build_object('sub',
  (select m.user_id::text from public.org_members m
   where m.org='ORG1900000000001' and m.role='worker'
     and m.user_id is not null and m.is_active is not false limit 1))::text, true);
set local role authenticated;

do $r1$
declare v_ref text;
begin
  begin
    select r.ref into v_ref
    from public.create_project('ORG1900000000001','Worker should not create this') r;
    raise exception 'PRJ-B7-R1 FAIL: worker created project %', v_ref;
  exception when others then
    if sqlerrm like '%not permitted%' then
      raise notice 'PRJ-B7-R1 PASS: worker refused (%)', sqlerrm;
    else
      raise exception 'PRJ-B7-R1 FAIL: wrong error — %', sqlerrm;
    end if;
  end;
end $r1$;

reset role;
rollback;


-- ---------------------------------------------------------------------
-- R2 — a CLIENT_ADMIN can create a project, and the ref is allocated.
-- PASS = ref matches PRJ-<year>-NNNN and owner_id is the caller.
-- ---------------------------------------------------------------------
begin;
select set_config('request.jwt.claims', json_build_object('sub',
  (select m.user_id::text from public.org_members m
   where m.org='ORG1900000000001' and m.role='client_admin'
     and m.user_id is not null and m.is_active is not false limit 1))::text, true);
set local role authenticated;

do $r2$
declare v_id uuid; v_ref text; v_orgname text; v_owner uuid;
begin
  select r.id, r.ref, r.org_name into v_id, v_ref, v_orgname
  from public.create_project('ORG1900000000001','RPC test project',
                             'created by block 7', current_date, current_date + 30) r;

  select p.owner_id into v_owner from public.projects p where p.id = v_id;

  if v_ref ~ ('^PRJ-' || to_char(current_date,'YYYY') || '-[0-9]{4}$')
     and v_owner = auth.uid() and v_orgname is not null then
    raise notice 'PRJ-B7-R2 PASS: created % for org "%", owner set', v_ref, v_orgname;
  else
    raise exception 'PRJ-B7-R2 FAIL: ref=% owner=% orgname=%', v_ref, v_owner, v_orgname;
  end if;
end $r2$;

reset role;
rollback;


-- ---------------------------------------------------------------------
-- R3 — the similar-name warning refuses, then confirms.
-- "Test Bar Back" is similar to the seeded "Test Bar".
-- PASS = first call raises naming the similar area, second call creates.
-- ---------------------------------------------------------------------
begin;
select set_config('request.jwt.claims', json_build_object('sub',
  (select m.user_id::text from public.org_members m
   where m.org='ORG1900000000001' and m.role='client_admin'
     and m.user_id is not null and m.is_active is not false limit 1))::text, true);
set local role authenticated;

do $r3$
declare v_id uuid; v_warn text; v_refused boolean := false;
begin
  begin
    perform public.create_org_area('ORG1900000000001','Test Bar Back');
  exception when others then
    if sqlerrm like '%similar areas already exist%' then
      v_refused := true;
      raise notice 'PRJ-B7-R3a PASS: refused — %', sqlerrm;
    else
      raise exception 'PRJ-B7-R3a FAIL: wrong error — %', sqlerrm;
    end if;
  end;

  if not v_refused then
    raise exception 'PRJ-B7-R3a FAIL: similar name was accepted without confirmation';
  end if;

  select a.id, a.warning into v_id, v_warn
  from public.create_org_area('ORG1900000000001','Test Bar Back',null,true) a;

  if v_id is not null then
    raise notice 'PRJ-B7-R3b PASS: created on confirmation (%)', v_warn;
  else
    raise exception 'PRJ-B7-R3b FAIL: confirmed call created nothing';
  end if;

  -- And an EXACT duplicate is never confirmable.
  begin
    perform public.create_org_area('ORG1900000000001','test  bar',null,true);
    raise exception 'PRJ-B7-R3c FAIL: exact duplicate accepted';
  exception when others then
    if sqlerrm like '%already exists here%' then
      raise notice 'PRJ-B7-R3c PASS: exact duplicate refused even with confirm';
    else
      raise exception 'PRJ-B7-R3c FAIL: wrong error — %', sqlerrm;
    end if;
  end;
end $r3$;

reset role;
rollback;


-- ---------------------------------------------------------------------
-- R4 — sign-off is client_admin only, and refuses while work is open.
-- Both halves matter: the role check, and the open-work check that
-- gives the sign-off its meaning.
-- ---------------------------------------------------------------------
begin;
select set_config('request.jwt.claims', json_build_object('sub',
  (select m.user_id::text from public.org_members m
   where m.org='ORG1900000000001' and m.role='worker'
     and m.user_id is not null and m.is_active is not false limit 1))::text, true);
set local role authenticated;

do $r4$
begin
  begin
    perform public.sign_off_project(
      (select id from public.projects where ref='PRJ-TEST-0001'));
    raise exception 'PRJ-B7-R4 FAIL: worker signed off a project';
  exception when others then
    if sqlerrm like '%only a client admin%' then
      raise notice 'PRJ-B7-R4 PASS: worker refused sign-off';
    elsif sqlerrm like '%not found%' then
      raise exception 'PRJ-B7-R4 INCONCLUSIVE: RLS hid the project before the role check ran';
    else
      raise exception 'PRJ-B7-R4 FAIL: wrong error — %', sqlerrm;
    end if;
  end;
end $r4$;

reset role;
rollback;


-- ---------------------------------------------------------------------
-- R5 — a client_admin is ALSO refused while tasks are open, then
-- succeeds once they are approved.
-- PASS = refused first, closed second, closed_by_id set.
-- ---------------------------------------------------------------------
begin;
select set_config('request.jwt.claims', json_build_object('sub',
  (select m.user_id::text from public.org_members m
   where m.org='ORG1900000000001' and m.role='client_admin'
     and m.user_id is not null and m.is_active is not false limit 1))::text, true);
set local role authenticated;

do $r5$
declare v_proj uuid; v_status text; v_closer uuid; v_refused boolean := false;
begin
  select id into v_proj from public.projects where ref='PRJ-TEST-0001';

  begin
    perform public.sign_off_project(v_proj,'should not get through');
  exception when others then
    if sqlerrm like '%still open%' then
      v_refused := true;
      raise notice 'PRJ-B7-R5a PASS: refused — %', sqlerrm;
    else
      raise exception 'PRJ-B7-R5a FAIL: wrong error — %', sqlerrm;
    end if;
  end;

  if not v_refused then
    raise exception 'PRJ-B7-R5a FAIL: signed off with open tasks';
  end if;

  -- Approve everything, then sign off for real.
  update public.tasks set status='approved', completed_at=now()
   where id like 'PRJTEST_%';

  perform public.sign_off_project(v_proj,'Block 7 test sign-off.');

  select p.status, p.closed_by_id into v_status, v_closer
  from public.projects p where p.id = v_proj;

  if v_status = 'closed' and v_closer = auth.uid() then
    raise notice 'PRJ-B7-R5b PASS: signed off, closed_by recorded';
  else
    raise exception 'PRJ-B7-R5b FAIL: status=% closer=%', v_status, v_closer;
  end if;
end $r5$;

reset role;
rollback;


-- =====================================================================
-- Everything in part B rolled back. Confirm the clean seed survived.
-- =====================================================================
select 'PRJ-B7-FINAL' as marker,
       (select status from public.projects where ref='PRJ-TEST-0001')      as project_status,
       (select count(*) from public.tasks where id like 'PRJTEST_%')       as tasks,
       (select count(*) from public.tasks where id like 'PRJTEST_%'
          and completed_at is not null)                                    as completed_should_be_0,
       (select count(*) from public.org_areas
          where org='ORG1900000000001' and name like 'Test %')             as areas_should_be_2,
       (select count(*) from public.projects
          where org='ORG1900000000001' and ref like 'PRJ-2026-%')          as rpc_projects_should_be_0;
