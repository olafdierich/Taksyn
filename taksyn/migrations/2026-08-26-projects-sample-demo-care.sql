-- =====================================================================
-- Taksyn — Projects module: SAMPLE PROJECT for Demo Care Services
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
-- Date: 26 August 2026
-- Requires: blocks 1-8 applied.
--
-- Seeds a realistic compliance project so the module can be looked at
-- with something that resembles a customer's actual work rather than a
-- kitchen refurbishment.
--
-- NDIS Practice Standards audit preparation — the exact shape the
-- module is built for: a project that ends in an inspection, on a date
-- that does not move, with evidence attached to every step.
--
-- WHAT THIS DEMONSTRATES (built and working)
--   Milestones and deadlines      3 milestones, one of them date-locked
--   Task grouping by project      4 sections, 7 packages, 18 tasks
--   Project progress tracking     counts roll up section -> project
--   Gantt / cascade data          dependencies + areas, so bars overlap
--
-- WHAT IT CANNOT DEMONSTRATE (not built — see the handover)
--   Project-level reports         no report path exists yet
--   Budget tracking               deliberately deferred; no cost model
--   Multi-team coordination       teams exists, nothing links it here
--   Seeding fake data for these would put a lie in the database.
--
-- THE STORY IN THE DATA
--   Documentation is finished. Facility works ran late in House 1,
--   which pushed House 1's safety checks but NOT House 2's — that is
--   the per-area rule visible in one screen. A corrective action from
--   an incident is open against the readiness milestone. The audit
--   itself is locked: it does not move because a contractor was slow.
--
-- Everything is prefixed SAMPLE_ and removed before re-seeding.
-- =====================================================================

\set ON_ERROR_STOP on
set client_min_messages = warning;

do $$
begin
  if exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose found. This looks like LIVE. Sandbox-only.';
  end if;
  if to_regclass('public.project_milestones') is null then
    raise exception 'ABORT: block 8 has not been applied.';
  end if;
end $$;

begin;

-- Clean previous runs.
delete from public.project_schedule_events
 where project_id in (select id from public.projects where ref='PRJ-SAMPLE-0001');
delete from public.tasks    where id like 'SAMPLE_%';
delete from public.projects where ref='PRJ-SAMPLE-0001';
delete from public.org_areas
 where org='ORG1990000000001' and name in ('Riverside House','Hilltop House','Head Office');

do $s$
declare
  v_org  text := 'ORG1990000000001';
  v_name text;
  v_p uuid;
  s_doc uuid; s_fac uuid; s_train uuid; s_audit uuid;
  p_policy uuid; p_records uuid; p_elec uuid; p_safety uuid;
  p_mand uuid; p_refresh uuid; p_visit uuid;
  a_river uuid; a_hill uuid; a_ho uuid;
  m_docs uuid; m_ready uuid; m_audit uuid;
begin
  select name into v_name from public.organisations where id = v_org;
  if v_name is null then
    raise exception 'ABORT: Demo Care Services (%) not found.', v_org;
  end if;

  -- Areas. Two houses and a head office — the real axis a care provider
  -- schedules along, and what makes packages overlap.
  insert into public.org_areas (org,name) values (v_org,'Riverside House') returning id into a_river;
  insert into public.org_areas (org,name) values (v_org,'Hilltop House')   returning id into a_hill;
  insert into public.org_areas (org,name) values (v_org,'Head Office')     returning id into a_ho;

  insert into public.projects (org,ref,name,description,status,start_date,target_end_date)
  values (v_org,'PRJ-SAMPLE-0001','NDIS Practice Standards Audit 2026',
          'Preparation for the scheduled NDIS Practice Standards audit. '
          'The audit date is fixed and does not move for internal delays.',
          'active', current_date - 40, current_date + 35)
  returning id into v_p;

  -- Sections (tiles) --------------------------------------------------
  insert into public.project_sections (project_id,parent_id,name,sort_order) values
    (v_p,null,'Documentation',1)  returning id into s_doc;
  insert into public.project_sections (project_id,parent_id,name,sort_order) values
    (v_p,null,'Facility works',2) returning id into s_fac;
  insert into public.project_sections (project_id,parent_id,name,sort_order) values
    (v_p,null,'Staff training',3) returning id into s_train;
  insert into public.project_sections (project_id,parent_id,name,sort_order) values
    (v_p,null,'Audit',4)          returning id into s_audit;

  -- Packages (bars) ---------------------------------------------------
  insert into public.project_sections (project_id,parent_id,name,sort_order) values
    (v_p,s_doc,'Policy review',1)        returning id into p_policy;
  insert into public.project_sections (project_id,parent_id,name,sort_order) values
    (v_p,s_doc,'Participant records',2)  returning id into p_records;
  insert into public.project_sections (project_id,parent_id,name,sort_order) values
    (v_p,s_fac,'Electrical works',1)     returning id into p_elec;
  insert into public.project_sections (project_id,parent_id,name,sort_order) values
    (v_p,s_fac,'Safety checks',2)        returning id into p_safety;
  insert into public.project_sections (project_id,parent_id,name,sort_order) values
    (v_p,s_train,'Mandatory training',1) returning id into p_mand;
  insert into public.project_sections (project_id,parent_id,name,sort_order) values
    (v_p,s_train,'Refresher sessions',2) returning id into p_refresh;
  insert into public.project_sections (project_id,parent_id,name,sort_order) values
    (v_p,s_audit,'Auditor visit',1)      returning id into p_visit;

  -- Milestones --------------------------------------------------------
  insert into public.project_milestones (org,project_id,section_id,name,due_date,sort_order)
  values (v_org,v_p,s_doc,'Documentation complete',current_date - 5,1)
  returning id into m_docs;

  insert into public.project_milestones (org,project_id,section_id,name,due_date,sort_order)
  values (v_org,v_p,s_fac,'Sites audit-ready',current_date + 20,2)
  returning id into m_ready;

  insert into public.project_milestones
    (org,project_id,section_id,name,due_date,sort_order,date_locked,lock_reason)
  values (v_org,v_p,s_audit,'Audit passed',current_date + 30,3,
          true,'Scheduled NDIS audit date. Set by the Commission and not reschedulable.')
  returning id into m_audit;

  -- Documentation: DONE. -----------------------------------------------
  insert into public.tasks (id,title,org,status,due_date,completed_at,project_id,
                            section_id,area_id,milestone_id)
  values
   ('SAMPLE_POL_1','Review incident management policy',       v_name,'approved',current_date-30,now()-interval '31 days',v_p,p_policy, a_ho,   m_docs),
   ('SAMPLE_POL_2','Review restrictive practices policy',     v_name,'approved',current_date-28,now()-interval '29 days',v_p,p_policy, a_ho,   m_docs),
   ('SAMPLE_POL_3','Update complaints handling procedure',    v_name,'approved',current_date-25,now()-interval '26 days',v_p,p_policy, a_ho,   m_docs),
   ('SAMPLE_REC_1','Audit participant files — Riverside',     v_name,'approved',current_date-14,now()-interval '15 days',v_p,p_records,a_river,m_docs),
   ('SAMPLE_REC_2','Audit participant files — Hilltop',       v_name,'approved',current_date-12,now()-interval '13 days',v_p,p_records,a_hill, m_docs);

  -- Electrical works: Riverside ran LATE and is still open. Hilltop is
  -- done. This is the delay that drives the whole picture.
  insert into public.tasks (id,title,org,status,due_date,completed_at,project_id,
                            section_id,area_id,milestone_id)
  values
   ('SAMPLE_ELE_1','Switchboard upgrade — Riverside',         v_name,'in_progress',current_date-6, null,                        v_p,p_elec,a_river,m_ready),
   ('SAMPLE_ELE_2','Emergency lighting — Riverside',          v_name,'pending',    current_date-2, null,                        v_p,p_elec,a_river,m_ready),
   ('SAMPLE_ELE_3','Switchboard upgrade — Hilltop',           v_name,'approved',   current_date-10,now()-interval '11 days',    v_p,p_elec,a_hill, m_ready),
   ('SAMPLE_ELE_4','Emergency lighting — Hilltop',            v_name,'approved',   current_date-8, now()-interval '9 days',     v_p,p_elec,a_hill, m_ready);

  -- Safety checks follow electrical, PER AREA. Hilltop can proceed;
  -- Riverside cannot, because its electrical work is not finished.
  insert into public.tasks (id,title,org,status,due_date,project_id,section_id,area_id,milestone_id)
  values
   ('SAMPLE_SAF_1','Fire safety inspection — Riverside',      v_name,'pending',current_date+6, v_p,p_safety,a_river,m_ready),
   ('SAMPLE_SAF_2','Egress and evacuation check — Riverside', v_name,'pending',current_date+9, v_p,p_safety,a_river,m_ready),
   ('SAMPLE_SAF_3','Fire safety inspection — Hilltop',        v_name,'pending',current_date+4, v_p,p_safety,a_hill, m_ready),
   ('SAMPLE_SAF_4','Egress and evacuation check — Hilltop',   v_name,'pending',current_date+7, v_p,p_safety,a_hill, m_ready);

  -- Training runs in parallel — no dependency on the building work.
  insert into public.tasks (id,title,org,status,due_date,completed_at,project_id,
                            section_id,area_id,milestone_id)
  values
   ('SAMPLE_TRN_1','Manual handling — all support workers',   v_name,'approved',current_date-3,now()-interval '4 days',v_p,p_mand,   a_ho,m_ready),
   ('SAMPLE_TRN_2','Safeguarding and reporting refresher',    v_name,'pending', current_date+11,null,                  v_p,p_refresh,a_ho,m_ready);

  -- The audit itself. LOCKED.
  insert into public.tasks (id,title,org,status,due_date,project_id,section_id,
                            milestone_id,due_date_locked,due_date_lock_reason)
  values
   ('SAMPLE_AUD_1','NDIS auditor site visit',                 v_name,'pending',current_date+30,v_p,p_visit,m_audit,
    true,'Audit date set by the NDIS Commission. It does not move for internal delays.');

  -- An attached corrective action from an incident. It BLOCKS the
  -- readiness milestone and joins no chain — the spine-and-attachments
  -- rule in one row.
  insert into public.tasks (id,title,org,status,due_date,project_id,section_id,
                            area_id,milestone_id,blocks_milestone)
  values
   ('SAMPLE_CAPA_1','Corrective action — medication error INC-0042',
    v_name,'pending',current_date+3,v_p,p_records,a_river,m_ready,true);

  -- Dependencies. Four links, applied per area, become many real
  -- constraints without anyone drawing a graph.
  insert into public.task_dependencies
    (org,project_id,predecessor_section_id,successor_section_id,gap_days,match_by_area)
  values
    (v_org,v_p,p_policy, p_records,0,false),   -- records follow the policy rewrite
    (v_org,v_p,p_elec,   p_safety, 1,true),    -- PER AREA, with a day to make good
    (v_org,v_p,p_safety, p_visit,  0,false),   -- the auditor comes after both sites pass
    (v_org,v_p,p_mand,   p_refresh,0,false);   -- refreshers follow mandatory training

  raise notice 'SAMPLE seeded: project=%', v_p;
end $s$;

commit;


-- =====================================================================
-- Mark the documentation milestone as met, so the sample shows a gate
-- that has genuinely closed rather than everything sitting open.
-- Done directly rather than through the RPC: psql has no auth.uid(),
-- and the constraint requires an attributed met_by_id.
-- =====================================================================
update public.project_milestones m
   set status='met', met_at = now() - interval '5 days',
       met_by_id = (select user_id from public.org_members
                     where org='ORG1990000000001' and role='client_admin'
                       and user_id is not null limit 1),
       met_note='All policies reviewed and participant files audited.'
 where m.name='Documentation complete'
   and m.project_id = (select id from public.projects where ref='PRJ-SAMPLE-0001');


-- =====================================================================
-- Run propagation for real, so the cascade in the data reflects the
-- Riverside delay. This is what makes the bars step and overlap.
-- =====================================================================
select 'SAMPLE-PROP' as marker, kind, task_id, old_due_date, new_due_date, delta_days, note
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-SAMPLE-0001'), false)
order by kind, new_due_date;


-- =====================================================================
-- What the screens would show.
-- =====================================================================
select 'SAMPLE-SECTIONS' as marker,
       s.name as section,
       count(t.id) as tasks,
       count(t.id) filter (where t.status in ('approved','completed')) as done
from public.project_sections s
join public.project_sections pk on pk.parent_id = s.id
left join public.tasks t on t.section_id = pk.id
where s.project_id = (select id from public.projects where ref='PRJ-SAMPLE-0001')
  and s.parent_id is null
group by s.name, s.sort_order
order by s.sort_order;

select 'SAMPLE-MILESTONES' as marker, name, due_date - current_date as days_out,
       status, date_locked, task_count, tasks_open, blockers_open, at_risk
from public.project_milestone_state
where project_id = (select id from public.projects where ref='PRJ-SAMPLE-0001')
order by due_date;

select 'SAMPLE-AREAS' as marker,
       coalesce(a.name,'(no area)') as area,
       pk.name as package,
       min(t.due_date) as starts,
       max(t.due_date) as ends,
       count(*) filter (where t.status not in ('approved','completed')) as open
from public.tasks t
join public.project_sections pk on pk.id = t.section_id
left join public.org_areas a on a.id = t.area_id
where t.project_id = (select id from public.projects where ref='PRJ-SAMPLE-0001')
group by a.name, pk.name, pk.sort_order
order by pk.sort_order, a.name;
