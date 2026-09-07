-- =====================================================================
-- Taksyn — Projects module, BLOCK 8: milestones and the sign-off gate
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
-- Date: 26 August 2026
-- Requires: blocks 1-7 applied.
--
-- Creates:  project_milestones
--           tasks.milestone_id, tasks.blocks_milestone
--           project_milestone_state   (view)
--           mark_milestone_met()      (RPC)
-- Replaces: sign_off_project()        (adds the milestone gate)
--
-- WHAT A MILESTONE IS
-- A dated gate. Not a task, not a package — it has no duration and
-- nobody is assigned to it. It is the moment someone asserts a stage is
-- finished, and the assertion is what an inspector reads.
--
-- MILESTONES DO NOT MOVE.
-- Packages shift when the chain slips. Milestones do not. If the work
-- gets pushed past its milestone date, that is the signal — surfacing
-- it is the entire point, and silently sliding the gate to meet the
-- delay would erase the thing worth knowing. A milestone can be
-- rescheduled deliberately by an admin, which is an edit with an author
-- on it, not an automatic consequence.
--
-- BLOCKERS
-- Unplanned work — an incident's corrective action, a risk control —
-- attaches to a milestone and does exactly one thing: stops it being
-- met while open. It never joins the dependency chain. Forty
-- attachments still leave six bars on the timeline.
--
-- The design says only MAJOR and SEVERE attachments block, derived from
-- task consequence rating (roadmap 7.8). That rating does not exist
-- yet, so blocking is an explicit boolean for now. When 7.8 lands,
-- default it from consequence rather than adding a second concept.
-- =====================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
begin
  if exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose found. This looks like LIVE. Sandbox-only.';
  end if;
  if to_regclass('public.project_sections') is null then
    raise exception 'ABORT: block 1 has not been applied.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- project_milestones
-- ---------------------------------------------------------------------
create table if not exists public.project_milestones (
  id            uuid primary key default gen_random_uuid(),
  org           text not null references public.organisations(id),
  project_id    uuid not null references public.projects(id) on delete cascade,

  -- Optional. A milestone usually closes a section ("Services
  -- complete"), but a project-level one ("Handover") belongs to no
  -- section at all.
  section_id    uuid references public.project_sections(id) on delete set null,

  name          text not null,
  due_date      date not null,
  sort_order    integer not null default 0,

  -- Same lock semantics as tasks. A locked milestone is a statutory
  -- gate: it cannot be rescheduled at all, by anyone.
  date_locked   boolean not null default false,
  lock_reason   text,

  status        text not null default 'open',
  met_at        timestamptz,
  met_by_id     uuid references auth.users(id),
  met_note      text,

  created_by_id uuid references auth.users(id),
  created_at    timestamptz not null default now(),

  constraint pm_org_must_be_id check (org like 'ORG%'),
  constraint pm_status_check   check (status in ('open','met','cancelled')),

  -- A met milestone must say who met it and when. The assertion IS the
  -- compliance artefact; an unattributed one is worth nothing.
  constraint pm_met_needs_attribution
    check (status <> 'met' or (met_at is not null and met_by_id is not null)),

  constraint pm_lock_needs_reason
    check (not date_locked or length(btrim(coalesce(lock_reason,''))) >= 10)
);

comment on table public.project_milestones is
  'Dated gates. They do NOT move when the chain slips — work being pushed past a milestone is the signal, and sliding the gate would erase it.';

create index if not exists pm_project_idx on public.project_milestones (project_id, sort_order);
create index if not exists pm_open_idx    on public.project_milestones (org, status, due_date);

alter table public.project_milestones enable row level security;


-- ---------------------------------------------------------------------
-- tasks — two more nullable columns.
--
-- milestone_id      which gate this task belongs to
-- blocks_milestone  whether it STOPS that gate while open
--
-- Separate columns on purpose: planned work belongs to a milestone
-- without blocking it (the gate closes when the section is done),
-- whereas an attached corrective action blocks. One column could not
-- say both.
-- ---------------------------------------------------------------------
alter table public.tasks
  add column if not exists milestone_id     uuid references public.project_milestones(id) on delete set null,
  add column if not exists blocks_milestone boolean not null default false;

comment on column public.tasks.blocks_milestone is
  'True = this task stops its milestone being met while open. Set on attached corrective actions and risk controls. When roadmap 7.8 (consequence rating) lands, default this from major/severe rather than adding a second concept.';

create index if not exists tasks_milestone_idx
  on public.tasks (milestone_id) where milestone_id is not null;


-- ---------------------------------------------------------------------
-- project_milestone_state — what the UI reads.
--
-- security_invoker so RLS applies as the QUERYING user. Without it a
-- view runs as its owner and quietly becomes a hole straight through
-- every policy written in block 6.
--
-- at_risk: the latest due date among this milestone's unfinished tasks
-- is past the milestone date. That is propagation and milestones
-- meeting: the chain pushed work beyond a gate that did not move.
-- ---------------------------------------------------------------------
create or replace view public.project_milestone_state
with (security_invoker = true) as
select
  m.id                                   as milestone_id,
  m.project_id,
  m.org,
  m.section_id,
  m.name,
  m.due_date,
  m.status,
  m.date_locked,
  m.met_at,

  count(t.id)                                                      as task_count,
  count(t.id) filter (where t.status in ('approved','completed'))   as tasks_done,
  count(t.id) filter (where t.status not in ('approved','completed')) as tasks_open,
  count(t.id) filter (where t.blocks_milestone
                        and t.status not in ('approved','completed')) as blockers_open,

  max(t.due_date) filter (where t.status not in ('approved','completed'))
                                                                   as latest_open_due,

  (m.status = 'open'
   and max(t.due_date) filter (where t.status not in ('approved','completed'))
       > m.due_date)                                               as at_risk,

  (m.status = 'open'
   and count(t.id) filter (where t.status not in ('approved','completed')) = 0)
                                                                   as ready_to_meet

from public.project_milestones m
left join public.tasks t on t.milestone_id = m.id
group by m.id;

comment on view public.project_milestone_state is
  'Per-milestone counts, at_risk and ready_to_meet. security_invoker so block 6 RLS still applies.';


-- ---------------------------------------------------------------------
-- mark_milestone_met
--
-- Org admins can meet a milestone; sign-off of the whole project stays
-- client_admin only. Refuses while any task under it is open, blocker
-- or not — a gate that can be closed over unfinished work is not a gate.
-- ---------------------------------------------------------------------
create or replace function public.mark_milestone_met(
  p_milestone_id uuid,
  p_note         text default null
)
returns table (id uuid, name text, status text, met_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      text;
  v_status   text;
  v_open     integer;
  v_blockers integer;
begin
  select m.org, m.status into v_org, v_status
  from public.project_milestones m where m.id = p_milestone_id;

  if v_org is null then
    raise exception 'mark_milestone_met: milestone % not found', p_milestone_id;
  end if;
  if not public.is_org_admin(v_org) then
    raise exception 'mark_milestone_met: not permitted for org %', v_org;
  end if;
  if v_status <> 'open' then
    raise exception 'mark_milestone_met: milestone is already %', v_status;
  end if;

  select count(*) filter (where t.status not in ('approved','completed')),
         count(*) filter (where t.blocks_milestone
                            and t.status not in ('approved','completed'))
    into v_open, v_blockers
  from public.tasks t where t.milestone_id = p_milestone_id;

  -- Blockers are named separately because the fix is different: an open
  -- blocker is usually a corrective action someone forgot, not slow work.
  if v_blockers > 0 then
    raise exception 'mark_milestone_met: % open blocker(s) must be closed first', v_blockers;
  end if;
  if v_open > 0 then
    raise exception 'mark_milestone_met: % task(s) are still open', v_open;
  end if;

  update public.project_milestones m
     set status    = 'met',
         met_at    = now(),
         met_by_id = auth.uid(),
         met_note  = nullif(btrim(coalesce(p_note,'')),'')
   where m.id = p_milestone_id;

  return query
    select m.id, m.name, m.status, m.met_at
    from public.project_milestones m where m.id = p_milestone_id;
end $$;


-- ---------------------------------------------------------------------
-- sign_off_project — REPLACED, one gate added.
--
-- Everything from block 5 is retained. The new clause refuses while any
-- milestone is still open. A project whose gates were never closed has
-- not been through the process the gates exist to record, and signing
-- off over them would make the sign-off decorative.
-- ---------------------------------------------------------------------
create or replace function public.sign_off_project(
  p_project_id uuid,
  p_note       text default null
)
returns table (id uuid, ref text, status text, closed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org        text;
  v_open       integer;
  v_blocked    integer;
  v_milestones integer;
  v_last_run   uuid;
begin
  select p.org into v_org from public.projects p where p.id = p_project_id;
  if v_org is null then
    raise exception 'sign_off_project: project % not found', p_project_id;
  end if;

  if not public.is_org_client_admin(v_org) then
    raise exception 'sign_off_project: only a client admin can sign off a project';
  end if;

  if exists (select 1 from public.projects p
              where p.id = p_project_id and p.status in ('closed','cancelled')) then
    raise exception 'sign_off_project: already closed';
  end if;

  select count(*) into v_open
  from public.tasks t
  where t.project_id = p_project_id
    and coalesce(t.status,'') not in ('approved','completed');
  if v_open > 0 then
    raise exception 'sign_off_project: % task(s) are still open', v_open;
  end if;

  select count(*) into v_open
  from public.tasks t
  where t.project_id = p_project_id
    and t.status = 'completed'
    and coalesce(t.requires_approval, true);
  if v_open > 0 then
    raise exception 'sign_off_project: % task(s) are done but not yet approved', v_open;
  end if;

  -- NEW in block 8.
  select count(*) into v_milestones
  from public.project_milestones m
  where m.project_id = p_project_id and m.status = 'open';
  if v_milestones > 0 then
    raise exception 'sign_off_project: % milestone(s) are still open', v_milestones;
  end if;

  select e.run_id into v_last_run
  from public.project_schedule_events e
  where e.project_id = p_project_id
  order by e.created_at desc limit 1;

  if v_last_run is not null then
    select count(*) into v_blocked
    from public.project_schedule_events e
    where e.project_id = p_project_id and e.run_id = v_last_run and e.kind = 'blocked';
    if v_blocked > 0 then
      raise exception
        'sign_off_project: % locked date(s) are at risk. Resolve or record them before sign-off.',
        v_blocked;
    end if;
  end if;

  update public.projects p
     set status = 'closed', closed_at = now(), closed_by_id = auth.uid(),
         signoff_note = nullif(btrim(coalesce(p_note,'')),'')
   where p.id = p_project_id;

  return query
    select p.id, p.ref, p.status, p.closed_at
    from public.projects p where p.id = p_project_id;
end $$;


-- ---------------------------------------------------------------------
-- RLS — same shape as block 6/6b.
-- No INSERT policy: milestones are created by admins through a write
-- path that does not exist yet, so for now creation is service-side
-- only. Adding an INSERT policy before there is a guarded creation path
-- would open a hole ahead of the door.
-- ---------------------------------------------------------------------
drop policy if exists project_milestones_select on public.project_milestones;
create policy project_milestones_select on public.project_milestones
  for select to authenticated
  using (public.is_org_member(org) or public.is_super_admin());

drop policy if exists project_milestones_update on public.project_milestones;
create policy project_milestones_update on public.project_milestones
  for update to authenticated
  using      (public.is_org_admin(org) or public.is_super_admin())
  with check (public.is_org_admin(org) or public.is_super_admin());

grant select on public.project_milestone_state to authenticated;
grant execute on function public.mark_milestone_met(uuid,text) to authenticated;

commit;


-- =====================================================================
-- PROOFS
-- =====================================================================

-- Seed two milestones onto the clean test project and attach the tasks.
begin;
do $seed$
declare
  v_proj uuid; v_org text := 'ORG1900000000001';
  v_svc uuid; v_so uuid; v_m1 uuid; v_m2 uuid;
begin
  select id into v_proj from public.projects where ref='PRJ-TEST-0001';
  if v_proj is null then
    raise exception 'ABORT: block 7 clean seed is missing.';
  end if;

  delete from public.project_milestones where project_id = v_proj;

  select id into v_svc from public.project_sections
   where project_id=v_proj and name='Services' and parent_id is null;
  select id into v_so from public.project_sections
   where project_id=v_proj and name='Sign-off';

  insert into public.project_milestones (org,project_id,section_id,name,due_date,sort_order)
  values (v_org,v_proj,v_svc,'Services complete',current_date + 20,1)
  returning id into v_m1;

  insert into public.project_milestones
    (org,project_id,section_id,name,due_date,sort_order,date_locked,lock_reason)
  values (v_org,v_proj,v_so,'Inspection passed',current_date + 30,2,
          true,'Statutory inspection. This gate cannot be rescheduled.')
  returning id into v_m2;

  -- The four trade tasks gate Services complete.
  update public.tasks set milestone_id = v_m1
   where id in ('PRJTEST_RW_BAR','PRJTEST_RW_KIT','PRJTEST_PL_BAR','PRJTEST_PL_KIT');

  -- The inspection gates its own milestone.
  update public.tasks set milestone_id = v_m2 where id = 'PRJTEST_SO_INS';

  -- An attached corrective action: blocks, no dependency, no area.
  insert into public.tasks (id,title,org,status,due_date,project_id,section_id,
                            milestone_id,blocks_milestone)
  select 'PRJTEST_CAPA_1','Corrective action from incident (test)',
         o.name,'pending',current_date + 10,v_proj,v_svc,v_m1,true
  from public.organisations o where o.id = v_org;
end $seed$;
commit;


-- M1 — the view reports correctly with an open blocker.
select 'PRJ-B8-M1' as marker, name, task_count, tasks_open, blockers_open,
       at_risk, ready_to_meet
from public.project_milestone_state
where project_id = (select id from public.projects where ref='PRJ-TEST-0001')
order by due_date;


-- M2 — the blocker refuses the gate, and is NAMED as a blocker rather
-- than lumped in with slow work.
begin;
select set_config('request.jwt.claims', json_build_object('sub',
  (select m.user_id::text from public.org_members m
   where m.org='ORG1900000000001' and m.role='client_admin'
     and m.user_id is not null and m.is_active is not false limit 1))::text, true);
set local role authenticated;

do $m2$
declare v_m uuid;
begin
  select id into v_m from public.project_milestones
   where name='Services complete'
     and project_id=(select id from public.projects where ref='PRJ-TEST-0001');

  begin
    perform public.mark_milestone_met(v_m);
    raise exception 'PRJ-B8-M2 FAIL: gate closed with an open blocker';
  exception when others then
    if sqlerrm like '%open blocker%' then
      raise notice 'PRJ-B8-M2 PASS: %', sqlerrm;
    else
      raise exception 'PRJ-B8-M2 FAIL: wrong error — %', sqlerrm;
    end if;
  end;

  -- Close the blocker; the four trade tasks are still open, so it must
  -- now refuse for a DIFFERENT reason. Two distinct gates, not one.
  update public.tasks set status='approved', completed_at=now() where id='PRJTEST_CAPA_1';

  begin
    perform public.mark_milestone_met(v_m);
    raise exception 'PRJ-B8-M2b FAIL: gate closed with open tasks';
  exception when others then
    if sqlerrm like '%still open%' then
      raise notice 'PRJ-B8-M2b PASS: %', sqlerrm;
    else
      raise exception 'PRJ-B8-M2b FAIL: wrong error — %', sqlerrm;
    end if;
  end;

  -- Approve the work; now it should close, with attribution.
  update public.tasks set status='approved', completed_at=now()
   where milestone_id = v_m;

  perform public.mark_milestone_met(v_m,'Block 8 test.');

  if exists (select 1 from public.project_milestones
              where id=v_m and status='met' and met_by_id = auth.uid()) then
    raise notice 'PRJ-B8-M2c PASS: gate met, met_by recorded';
  else
    raise exception 'PRJ-B8-M2c FAIL: milestone not met or unattributed';
  end if;
end $m2$;

reset role;
rollback;


-- M3 — sign-off refuses while a milestone is open, even with every task
-- approved. This is the block 8 gate.
begin;
select set_config('request.jwt.claims', json_build_object('sub',
  (select m.user_id::text from public.org_members m
   where m.org='ORG1900000000001' and m.role='client_admin'
     and m.user_id is not null and m.is_active is not false limit 1))::text, true);
set local role authenticated;

do $m3$
declare v_proj uuid;
begin
  select id into v_proj from public.projects where ref='PRJ-TEST-0001';
  update public.tasks set status='approved', completed_at=now()
   where project_id = v_proj;

  begin
    perform public.sign_off_project(v_proj);
    raise exception 'PRJ-B8-M3 FAIL: signed off with open milestones';
  exception when others then
    if sqlerrm like '%milestone(s) are still open%' then
      raise notice 'PRJ-B8-M3 PASS: %', sqlerrm;
    else
      raise exception 'PRJ-B8-M3 FAIL: wrong error — %', sqlerrm;
    end if;
  end;
end $m3$;

reset role;
rollback;


-- M4 — a locked milestone needs a reason of real length, and a met
-- milestone cannot be unattributed. Both constraints, both must FAIL.
do $m4$
begin
  begin
    insert into public.project_milestones (org,project_id,name,due_date,date_locked,lock_reason)
    select 'ORG1900000000001', id, 'bad lock', current_date+1, true, 'x'
    from public.projects where ref='PRJ-TEST-0001';
    raise exception 'PRJ-B8-M4a FAIL: locked milestone accepted a one-character reason';
  exception when check_violation then
    raise notice 'PRJ-B8-M4a PASS: lock reason floor enforced';
  end;

  begin
    insert into public.project_milestones (org,project_id,name,due_date,status)
    select 'ORG1900000000001', id, 'bad met', current_date+1, 'met'
    from public.projects where ref='PRJ-TEST-0001';
    raise exception 'PRJ-B8-M4b FAIL: met milestone accepted without attribution';
  exception when check_violation then
    raise notice 'PRJ-B8-M4b PASS: met milestone requires who and when';
  end;
end $m4$;


-- M5 — the view must NOT leak to a non-member. A view without
-- security_invoker runs as its owner and bypasses every policy in
-- block 6, so this is the test that catches that mistake.
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-0000000000ff')::text, true);
set local role authenticated;

do $m5$
declare v_n integer;
begin
  select count(*) into v_n from public.project_milestone_state;
  if v_n = 0 then
    raise notice 'PRJ-B8-M5 PASS: view respects RLS, non-member sees nothing';
  else
    raise exception 'PRJ-B8-M5 FAIL: non-member saw % milestone row(s) — check security_invoker', v_n;
  end if;
end $m5$;

reset role;
rollback;


-- Final state. The CAPA task and milestones persist; everything the
-- proofs did to task statuses was rolled back.
select 'PRJ-B8-FINAL' as marker, name, due_date - current_date as days_out,
       status, date_locked, task_count, blockers_open, ready_to_meet
from public.project_milestone_state
where project_id = (select id from public.projects where ref='PRJ-TEST-0001')
order by due_date;
