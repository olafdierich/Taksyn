-- =====================================================================
-- Taksyn — Projects module, BLOCK 9: teams replace areas
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
-- Date: 26 August 2026
-- Requires: blocks 1-8 applied.
--
-- WHY
-- Areas were a concept Taksyn does not have. The product is built on
-- tasks, teams and staff, and tasks ALREADY carry team_id and team_name
-- — so the independent-stream behaviour that made packages overlap
-- needs no new vocabulary at all. Riverside's team being held up while
-- Hilltop's carries on is the same mechanism, expressed in the terms
-- the rest of the app already uses.
--
-- This also fixes the confusion the areas version created: a bar
-- labelled "Riverside House" looked like a team but was a place, and
-- nothing on screen said who actually had to do the work.
--
-- WHAT CHANGES
--   task_dependencies.match_by_area  -> match_by_team
--   recompute_project_dates          matches on tasks.team_id
--   org_areas, tasks.area_id         DROPPED — nothing live uses them,
--                                    and leaving a dead concept behind
--                                    is how the next person loses a day
--   find_similar_areas, create_org_area  DROPPED with them
--   sample re-seeded with teams, assignees and approvers
--
-- WHAT DOES NOT CHANGE
-- The propagation rules are untouched: push-only, idempotent, locked
-- dates produce a blocked row, cycles are caught. Only the identifier
-- the per-stream matching keys on is different.
-- =====================================================================

\set ON_ERROR_STOP on
set client_min_messages = warning;

begin;

do $$
begin
  if exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose found. This looks like LIVE. Sandbox-only.';
  end if;
  if to_regclass('public.task_dependencies') is null then
    raise exception 'ABORT: block 2 has not been applied.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 1. The dependency column.
-- ---------------------------------------------------------------------
alter table public.task_dependencies
  rename column match_by_area to match_by_team;

comment on column public.task_dependencies.match_by_team is
  'true = the link applies per TEAM: the Riverside team''s plumbing waits on the Riverside team''s rewire, not on Hilltop''s. false = the whole package waits on the whole package, for work with no team split.';

comment on table public.task_dependencies is
  'Package-to-package finish-to-start links, applied per matching team when match_by_team. One drawn link becomes many real constraints. Multiple predecessors permitted; the walk takes the latest.';


-- ---------------------------------------------------------------------
-- 2. Drop the area concept entirely.
--
-- Dropping rather than leaving dormant: a dead table with a plausible
-- name is worse than no table, because the next person has to work out
-- whether it matters. Nothing outside this module ever referenced it.
-- ---------------------------------------------------------------------
drop function if exists public.create_org_area(text,text,uuid,boolean);
drop function if exists public.find_similar_areas(text,text,uuid);

alter table public.tasks drop column if exists area_id;
drop table if exists public.org_areas cascade;


-- ---------------------------------------------------------------------
-- 3. recompute_project_dates — team matching.
--
-- Identical to block 3 except that the grouping key is tasks.team_id
-- rather than tasks.area_id. Every rule is unchanged: completion tested
-- on completed_at, overdue-and-incomplete finishes TODAY, push only,
-- locked dates produce a blocked row, cycles abort with nothing written.
-- ---------------------------------------------------------------------
drop function if exists public.recompute_project_dates(uuid,boolean,text);
drop function if exists public.recompute_project_dates(uuid,boolean,text);
create or replace function public.recompute_project_dates(
  p_project_id uuid,
  p_dry_run    boolean default true,
  p_tz         text    default 'UTC'
)
returns table (
  kind         text,
  task_id      text,
  section_id   uuid,
  team_id      text,
  old_due_date date,
  new_due_date date,
  delta_days   integer,
  note         text
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      text;
  v_run      uuid := gen_random_uuid();
  v_progress boolean;
  v_pending  integer;
  v_pkg      uuid;
  v_today    date := (now() at time zone p_tz)::date;
begin
  select p.org into v_org from public.projects p where p.id = p_project_id;
  if v_org is null then
    raise exception 'recompute_project_dates: project % not found', p_project_id;
  end if;

  drop table if exists _eff;
  create temp table _eff on commit drop as
    select t.id as task_id, t.section_id,
           coalesce(t.team_id,'_') as team_key,
           t.due_date, t.completed_at,
           coalesce(t.due_date_locked,false) as locked
    from public.tasks t
    where t.project_id = p_project_id and t.section_id is not null;
  create index on _eff (section_id);

  drop table if exists _pkg;
  create temp table _pkg on commit drop as
    select s.id as section_id, false as processed
    from public.project_sections s
    where s.project_id = p_project_id and s.parent_id is not null;

  drop table if exists _out;
  create temp table _out (
    kind text, task_id text, section_id uuid, team_key text,
    old_due_date date, new_due_date date, delta_days integer,
    caused_by uuid, note text
  ) on commit drop;

  loop
    select count(*) into v_pending from _pkg where not processed;
    exit when v_pending = 0;
    v_progress := false;

    for v_pkg in
      select k.section_id from _pkg k
      where not k.processed
        and not exists (
          select 1 from public.task_dependencies d
          join _pkg pk on pk.section_id = d.predecessor_section_id
          where d.successor_section_id = k.section_id and not pk.processed)
    loop
      drop table if exists _req;
      create temp table _req on commit drop as
      with pred_finish as (
        select d.gap_days, d.match_by_team, d.predecessor_section_id,
               e.team_key,
               max(case when e.completed_at is not null
                          then (e.completed_at at time zone p_tz)::date
                        when e.due_date < v_today then v_today
                        else e.due_date end) as finish_date
        from public.task_dependencies d
        join _eff e on e.section_id = d.predecessor_section_id
        where d.successor_section_id = v_pkg
        group by d.gap_days, d.match_by_team, d.predecessor_section_id, e.team_key
      ),
      whole_pkg as (
        select pf.predecessor_section_id, pf.gap_days,
               max(pf.finish_date) as finish_date
        from pred_finish pf where not pf.match_by_team
        group by pf.predecessor_section_id, pf.gap_days
      )
      select team_key, max(required_start) as required_start,
             (array_agg(caused_by order by required_start desc))[1] as caused_by
      from (
        select pf.team_key, pf.finish_date + pf.gap_days as required_start,
               pf.predecessor_section_id as caused_by
        from pred_finish pf where pf.match_by_team
        union all
        select se.team_key, w.finish_date + w.gap_days, w.predecessor_section_id
        from whole_pkg w
        cross join lateral (
          select distinct e.team_key from _eff e where e.section_id = v_pkg) se
      ) x
      group by team_key;

      declare
        r record; v_earliest date; v_delta integer;
      begin
        for r in select * from _req loop
          select min(e.due_date) into v_earliest
          from _eff e
          where e.section_id = v_pkg and e.team_key = r.team_key
            and e.completed_at is null;

          continue when v_earliest is null;
          v_delta := r.required_start - v_earliest;
          continue when v_delta <= 0;

          insert into _out
          select case when e.locked then 'blocked' else 'shift' end,
                 e.task_id, e.section_id, e.team_key, e.due_date,
                 case when e.locked then e.due_date else e.due_date + v_delta end,
                 case when e.locked then 0 else v_delta end,
                 r.caused_by,
                 case when e.locked
                      then 'Date is locked. The chain would have pushed it '
                           || v_delta || ' days to '
                           || (e.due_date + v_delta)::text || '. It has not moved.'
                      else null end
          from _eff e
          where e.section_id = v_pkg and e.team_key = r.team_key
            and e.completed_at is null;

          update _eff e set due_date = e.due_date + v_delta
           where e.section_id = v_pkg and e.team_key = r.team_key
             and e.completed_at is null and not e.locked;
        end loop;
      end;

      update _pkg set processed = true where _pkg.section_id = v_pkg;
      v_progress := true;
    end loop;

    if not v_progress then
      insert into _out (kind, note)
      values ('cycle','Dependency loop: '
              || (select count(*) from _pkg where not processed)
              || ' packages can never start. Nothing was changed.');
      return query select o.kind,o.task_id,o.section_id,o.team_key,
                          o.old_due_date,o.new_due_date,o.delta_days,o.note
                   from _out o;
      return;
    end if;
  end loop;

  if not exists (select 1 from _out) then
    insert into _out (kind, note) values ('noop','No dates needed to move.');
  end if;

  if not p_dry_run then
    update public.tasks t set due_date = o.new_due_date
      from _out o where t.id = o.task_id and o.kind = 'shift';

    insert into public.project_schedule_events
      (org, project_id, run_id, kind, task_id, section_id,
       old_due_date, new_due_date, delta_days, caused_by_section_id, note)
    select v_org, p_project_id, v_run, o.kind, o.task_id, o.section_id,
           o.old_due_date, o.new_due_date, o.delta_days, o.caused_by, o.note
    from _out o;
  end if;

  return query select o.kind,o.task_id,o.section_id,o.team_key,
                      o.old_due_date,o.new_due_date,o.delta_days,o.note
               from _out o order by o.kind, o.new_due_date;
end
$fn$;

-- project_schedule_events.area_id goes with the concept.
alter table public.project_schedule_events drop column if exists area_id;

grant execute on function public.recompute_project_dates(uuid,boolean,text) to authenticated;

commit;


-- =====================================================================
-- RE-SEED the sample around teams, with real people on every task.
-- =====================================================================
begin;

delete from public.project_schedule_events
 where project_id in (select id from public.projects where ref='PRJ-SAMPLE-0001');
delete from public.tasks    where id like 'SAMPLE_%';
delete from public.project_milestones
 where project_id in (select id from public.projects where ref='PRJ-SAMPLE-0001');
delete from public.projects where ref='PRJ-SAMPLE-0001';
delete from public.team_members where org='ORG1990000000001' and team_id like 'TEAM_SAMPLE_%';
delete from public.teams       where org='ORG1990000000001' and id like 'TEAM_SAMPLE_%';

do $s$
declare
  v_org text := 'ORG1990000000001';
  v_name text;
  v_p uuid;
  s_doc uuid; s_fac uuid; s_train uuid; s_audit uuid;
  p_policy uuid; p_records uuid; p_elec uuid; p_safety uuid;
  p_mand uuid; p_refresh uuid; p_visit uuid;
  m_docs uuid; m_ready uuid; m_audit uuid;

  t_river text := 'TEAM_SAMPLE_RIVER';
  t_hill  text := 'TEAM_SAMPLE_HILL';
  t_ho    text := 'TEAM_SAMPLE_HO';

  u_admin uuid := '1b7d2efa-4d46-4920-8996-61076de092f3'; -- Margaret Whitfield
  u_mgr   uuid := '17476475-eff6-4a4d-892b-fbf70e30b9e9'; -- David Chen
  u_sup   uuid := '884a5a39-48aa-4ff6-b67a-bc8d6ab8d96b'; -- Priya Raghavan
  u_w1    uuid := 'f1ea0655-8851-4c89-b9ca-65537e335139'; -- Tomas Nowak
  u_w2    uuid := '926b86fb-4703-49fb-8ae2-94f9db87ffa8'; -- Amina Hassan
begin
  select name into v_name from public.organisations where id = v_org;

  insert into public.teams (id,name,type,description,org) values
    (t_river,'Riverside Team','site','Support team based at Riverside House',v_org),
    (t_hill, 'Hilltop Team', 'site','Support team based at Hilltop House',  v_org),
    (t_ho,   'Head Office',  'admin','Quality and compliance',              v_org);

  insert into public.team_members (id,team_id,user_id,user_name,role,org) values
    ('TM_S1',t_river,u_w1, 'Tomas Nowak',       'worker',    v_org),
    ('TM_S2',t_hill, u_w2, 'Amina Hassan',      'worker',    v_org),
    ('TM_S3',t_ho,   u_sup,'Priya Raghavan',    'supervisor',v_org),
    ('TM_S4',t_ho,   u_mgr,'David Chen',        'manager',   v_org);

  insert into public.projects (org,ref,name,description,status,start_date,target_end_date,
                               owner_id,created_by_id)
  values (v_org,'PRJ-SAMPLE-0001','NDIS Practice Standards Audit 2026',
          'Preparation for the scheduled NDIS Practice Standards audit. '
          'The audit date is fixed and does not move for internal delays.',
          'active', current_date - 40, current_date + 35, u_mgr, u_admin)
  returning id into v_p;

  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (v_p,null,'Documentation',1)  returning id into s_doc;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (v_p,null,'Facility works',2) returning id into s_fac;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (v_p,null,'Staff training',3) returning id into s_train;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (v_p,null,'Audit',4)          returning id into s_audit;

  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (v_p,s_doc,'Policy review',1)        returning id into p_policy;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (v_p,s_doc,'Participant records',2)  returning id into p_records;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (v_p,s_fac,'Electrical works',1)     returning id into p_elec;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (v_p,s_fac,'Safety checks',2)        returning id into p_safety;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (v_p,s_train,'Mandatory training',1) returning id into p_mand;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (v_p,s_train,'Refresher sessions',2) returning id into p_refresh;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (v_p,s_audit,'Auditor visit',1)      returning id into p_visit;

  insert into public.project_milestones (org,project_id,section_id,name,due_date,sort_order)
    values (v_org,v_p,s_doc,'Documentation complete',current_date - 5,1)
    returning id into m_docs;
  insert into public.project_milestones (org,project_id,section_id,name,due_date,sort_order)
    values (v_org,v_p,s_fac,'Sites audit-ready',current_date + 20,2)
    returning id into m_ready;
  insert into public.project_milestones
    (org,project_id,section_id,name,due_date,sort_order,date_locked,lock_reason)
    values (v_org,v_p,s_audit,'Audit passed',current_date + 30,3,true,
            'Scheduled NDIS audit date. Set by the Commission and not reschedulable.')
    returning id into m_audit;

  -- Documentation — Head Office, approved by the manager.
  insert into public.tasks
    (id,title,org,status,due_date,completed_at,project_id,section_id,team_id,team_name,
     milestone_id,assigned_user_ids,assigned_user_names,assigned_user_id,assigned_user_name,
     approver_id,approver_name,requires_approval)
  values
   ('SAMPLE_POL_1','Review incident management policy',v_name,'approved',current_date-30,now()-interval '31 days',
    v_p,p_policy,t_ho,'Head Office',m_docs,array[u_sup::text],array['Priya Raghavan'],u_sup::text,'Priya Raghavan',u_mgr::text,'David Chen',true),
   ('SAMPLE_POL_2','Review restrictive practices policy',v_name,'approved',current_date-28,now()-interval '29 days',
    v_p,p_policy,t_ho,'Head Office',m_docs,array[u_sup::text],array['Priya Raghavan'],u_sup::text,'Priya Raghavan',u_mgr::text,'David Chen',true),
   ('SAMPLE_POL_3','Update complaints handling procedure',v_name,'approved',current_date-25,now()-interval '26 days',
    v_p,p_policy,t_ho,'Head Office',m_docs,array[u_sup::text],array['Priya Raghavan'],u_sup::text,'Priya Raghavan',u_mgr::text,'David Chen',true);

  -- Participant records — each site team audits its own files.
  insert into public.tasks
    (id,title,org,status,due_date,completed_at,project_id,section_id,team_id,team_name,
     milestone_id,assigned_user_ids,assigned_user_names,assigned_user_id,assigned_user_name,
     approver_id,approver_name,requires_approval)
  values
   ('SAMPLE_REC_1','Audit participant files',v_name,'approved',current_date-14,now()-interval '15 days',
    v_p,p_records,t_river,'Riverside Team',m_docs,array[u_w1::text],array['Tomas Nowak'],u_w1::text,'Tomas Nowak',u_sup::text,'Priya Raghavan',true),
   ('SAMPLE_REC_2','Audit participant files',v_name,'approved',current_date-12,now()-interval '13 days',
    v_p,p_records,t_hill,'Hilltop Team',m_docs,array[u_w2::text],array['Amina Hassan'],u_w2::text,'Amina Hassan',u_sup::text,'Priya Raghavan',true);

  -- Electrical: Riverside re-scheduled and running; Hilltop finished.
  insert into public.tasks
    (id,title,org,status,due_date,completed_at,project_id,section_id,team_id,team_name,
     milestone_id,assigned_user_ids,assigned_user_names,assigned_user_id,assigned_user_name,
     approver_id,approver_name,requires_approval)
  values
   ('SAMPLE_ELE_1','Switchboard upgrade',v_name,'in_progress',current_date+8,null,
    v_p,p_elec,t_river,'Riverside Team',m_ready,array[u_w1::text],array['Tomas Nowak'],u_w1::text,'Tomas Nowak',u_sup::text,'Priya Raghavan',true),
   ('SAMPLE_ELE_2','Emergency lighting',v_name,'pending',current_date+10,null,
    v_p,p_elec,t_river,'Riverside Team',m_ready,array[u_w1::text],array['Tomas Nowak'],u_w1::text,'Tomas Nowak',u_sup::text,'Priya Raghavan',true),
   ('SAMPLE_ELE_3','Switchboard upgrade',v_name,'approved',current_date-10,now()-interval '11 days',
    v_p,p_elec,t_hill,'Hilltop Team',m_ready,array[u_w2::text],array['Amina Hassan'],u_w2::text,'Amina Hassan',u_sup::text,'Priya Raghavan',true),
   ('SAMPLE_ELE_4','Emergency lighting',v_name,'approved',current_date-8,now()-interval '9 days',
    v_p,p_elec,t_hill,'Hilltop Team',m_ready,array[u_w2::text],array['Amina Hassan'],u_w2::text,'Amina Hassan',u_sup::text,'Priya Raghavan',true);

  -- Safety checks follow electrical, PER TEAM.
  insert into public.tasks
    (id,title,org,status,due_date,project_id,section_id,team_id,team_name,milestone_id,
     assigned_user_ids,assigned_user_names,assigned_user_id,assigned_user_name,
     approver_id,approver_name,requires_approval)
  values
   ('SAMPLE_SAF_1','Fire safety inspection',v_name,'pending',current_date+1,
    v_p,p_safety,t_river,'Riverside Team',m_ready,array[u_w1::text],array['Tomas Nowak'],u_w1::text,'Tomas Nowak',u_sup::text,'Priya Raghavan',true),
   ('SAMPLE_SAF_2','Egress and evacuation check',v_name,'pending',current_date+3,
    v_p,p_safety,t_river,'Riverside Team',m_ready,array[u_w1::text],array['Tomas Nowak'],u_w1::text,'Tomas Nowak',u_sup::text,'Priya Raghavan',true),
   ('SAMPLE_SAF_3','Fire safety inspection',v_name,'awaiting_review',current_date+4,
    v_p,p_safety,t_hill,'Hilltop Team',m_ready,array[u_w2::text],array['Amina Hassan'],u_w2::text,'Amina Hassan',u_sup::text,'Priya Raghavan',true),
   ('SAMPLE_SAF_4','Egress and evacuation check',v_name,'pending',current_date+7,
    v_p,p_safety,t_hill,'Hilltop Team',m_ready,array[u_w2::text],array['Amina Hassan'],u_w2::text,'Amina Hassan',u_sup::text,'Priya Raghavan',true);

  -- Training, Head Office, no dependency on the building work.
  insert into public.tasks
    (id,title,org,status,due_date,completed_at,project_id,section_id,team_id,team_name,
     milestone_id,assigned_user_ids,assigned_user_names,assigned_user_id,assigned_user_name,
     approver_id,approver_name,requires_approval)
  values
   ('SAMPLE_TRN_1','Manual handling — all support workers',v_name,'approved',current_date-3,now()-interval '4 days',
    v_p,p_mand,t_ho,'Head Office',m_ready,array[u_sup::text],array['Priya Raghavan'],u_sup::text,'Priya Raghavan',u_mgr::text,'David Chen',true),
   ('SAMPLE_TRN_2','Safeguarding and reporting refresher',v_name,'pending',current_date+11,null,
    v_p,p_refresh,t_ho,'Head Office',m_ready,array[u_sup::text],array['Priya Raghavan'],u_sup::text,'Priya Raghavan',u_mgr::text,'David Chen',true);

  -- The audit. Locked.
  insert into public.tasks
    (id,title,org,status,due_date,project_id,section_id,team_id,team_name,milestone_id,
     assigned_user_ids,assigned_user_names,assigned_user_id,assigned_user_name,
     approver_id,approver_name,requires_approval,due_date_locked,due_date_lock_reason)
  values
   ('SAMPLE_AUD_1','NDIS auditor site visit',v_name,'pending',current_date+30,
    v_p,p_visit,t_ho,'Head Office',m_audit,array[u_mgr::text],array['David Chen'],u_mgr::text,'David Chen',
    u_admin::text,'Margaret Whitfield',true,true,
    'Audit date set by the NDIS Commission. It does not move for internal delays.');

  -- Attached corrective action from an incident. Blocks the milestone,
  -- joins no chain.
  insert into public.tasks
    (id,title,org,status,due_date,project_id,section_id,team_id,team_name,milestone_id,
     blocks_milestone,assigned_user_ids,assigned_user_names,assigned_user_id,assigned_user_name,
     approver_id,approver_name,requires_approval)
  values
   ('SAMPLE_CAPA_1','Corrective action — medication error INC-0042',v_name,'pending',current_date+3,
    v_p,p_records,t_river,'Riverside Team',m_ready,true,
    array[u_w1::text],array['Tomas Nowak'],u_w1::text,'Tomas Nowak',u_sup::text,'Priya Raghavan',true);

  insert into public.task_dependencies
    (org,project_id,predecessor_section_id,successor_section_id,gap_days,match_by_team)
  values
    (v_org,v_p,p_policy,p_records,0,false),
    (v_org,v_p,p_elec,  p_safety, 1,true),
    (v_org,v_p,p_safety,p_visit,  0,false),
    (v_org,v_p,p_mand,  p_refresh,0,false);

  update public.project_milestones
     set status='met', met_at = now() - interval '5 days',
         met_by_id = u_mgr, met_note='All policies reviewed and participant files audited.'
   where id = m_docs;
end $s$;

commit;


-- =====================================================================
-- PROVE the team matching, on real data.
-- =====================================================================
select 'B9-DRY' as marker, kind, task_id, team_id, old_due_date, new_due_date, delta_days
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-SAMPLE-0001'), true)
order by kind, task_id;

select 'B9-APPLY' as marker, kind, task_id, team_id, old_due_date, new_due_date, delta_days
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-SAMPLE-0001'), false)
order by kind, task_id;

select 'B9-AGAIN' as marker, kind, note
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-SAMPLE-0001'), false);

select 'B9-AFTER' as marker, t.team_name, t.title,
       t.due_date - current_date as days_out, t.status,
       t.assigned_user_names[1] as assignee, t.approver_name
from public.tasks t
where t.id like 'SAMPLE_SAF_%' or t.id like 'SAMPLE_ELE_%'
order by t.team_name, t.due_date;

select 'B9-GONE' as marker,
       to_regclass('public.org_areas')                       as org_areas_should_be_null,
       (select count(*) from information_schema.columns
          where table_schema='public' and table_name='tasks'
            and column_name='area_id')                       as area_id_should_be_0,
       (select count(*) from information_schema.columns
          where table_schema='public' and table_name='task_dependencies'
            and column_name='match_by_team')                 as match_by_team_should_be_1;
