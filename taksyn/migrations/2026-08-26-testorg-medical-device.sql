-- =====================================================================
-- Taksyn — Test Org as a digital medical device company
-- TARGET: LIVE yylvtvbhddcepilzwpaw
-- Date: 26 August 2026
--
-- Test Org (ORG1783849351837) already carries 8 tasks and 48 incidents.
-- None of them are touched. Everything added here is new and carries a
-- distinguishing prefix, so it can be removed cleanly.
--
-- THE ORGANISATION IS NOT RENAMED.
-- tasks.org and profiles.org store the NAME, and the tasks RLS policy
-- compares against it: org IN (select p.org from profiles p where
-- p.id = auth.uid()). Renaming would orphan every task and profile in
-- the org until all three tables were updated in the same transaction.
-- The logo carries the identity instead — it is the safe half of the
-- change and does the same job on screen.
--
-- WHAT IS ADDED
--   a logo
--   3 teams, with the sensible member accounts on them
--   2 projects, structured the way a device company actually works:
--     design controls (21 CFR 820.30 / ISO 13485) for development, and
--     process validation (IQ/OQ/PQ) for the transfer to manufacturing
--
-- Regulatory dates are LOCKED. A notified body audit does not move
-- because a supplier was late, which is the whole reason the lock
-- exists.
-- =====================================================================

\set ON_ERROR_STOP on
set client_min_messages = warning;

begin;

do $$
begin
  if not exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose not found. This is for LIVE only.';
  end if;
  if not exists (select 1 from public.organisations where id = 'ORG1783849351837') then
    raise exception 'ABORT: Test Org not found.';
  end if;
  if to_regclass('public.project_sections') is null then
    raise exception 'ABORT: the projects runbook has not been applied.';
  end if;
end $$;

-- Clean any previous run of this file. Nothing else matches these
-- prefixes, so the existing 8 tasks and 48 incidents are untouched.
delete from public.project_schedule_events
 where project_id in (select id from public.projects
                      where org='ORG1783849351837' and ref like 'PRJ-MD-%');
delete from public.tasks where id like 'MD_%';
delete from public.project_milestones
 where project_id in (select id from public.projects
                      where org='ORG1783849351837' and ref like 'PRJ-MD-%');
delete from public.projects where org='ORG1783849351837' and ref like 'PRJ-MD-%';
delete from public.team_members where team_id like 'TM_MD_%';
delete from public.teams where id like 'TM_MD_%';

update public.organisations
   set logo = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzODAgOTYiIHdpZHRoPSIzODAiIGhlaWdodD0iOTYiPgogIDxyZWN0IHg9IjYiIHk9IjE0IiB3aWR0aD0iNjgiIGhlaWdodD0iNjgiIHJ4PSIyMCIgZmlsbD0iIzBCMkE0QSIvPgogIDxjaXJjbGUgY3g9IjQwIiBjeT0iNDgiIHI9IjIzIiBmaWxsPSJub25lIiBzdHJva2U9IiMxRTVGOEMiIHN0cm9rZS13aWR0aD0iMS42IiBvcGFjaXR5PSIwLjU1Ii8+CiAgPHBhdGggZD0iTTIwIDQ4IGg3IGw0LjUgLTEyIGw2IDI1IGw1IC0xNyBsNCA4IGgxMy41IgogICAgICAgIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzIyRDNDNSIgc3Ryb2tlLXdpZHRoPSIzLjQiCiAgICAgICAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CiAgPGNpcmNsZSBjeD0iNjAiIGN5PSI0OCIgcj0iMy42IiBmaWxsPSIjMjJEM0M1Ii8+CiAgPGNpcmNsZSBjeD0iNjAiIGN5PSI0OCIgcj0iNy41IiBmaWxsPSJub25lIiBzdHJva2U9IiMyMkQzQzUiIHN0cm9rZS13aWR0aD0iMS4zIiBvcGFjaXR5PSIwLjQ1Ii8+CiAgPHRleHQgeD0iOTAiIHk9IjQ1IiBmb250LWZhbWlseT0iSGVsdmV0aWNhIE5ldWUsIEhlbHZldGljYSwgQXJpYWwsIHNhbnMtc2VyaWYiCiAgICAgICAgZm9udC1zaXplPSIyNyIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iIzBCMkE0QSIgbGV0dGVyLXNwYWNpbmc9Ii0wLjYiPlRlc3QgT3JnPC90ZXh0PgogIDx0ZXh0IHg9IjkxIiB5PSI3MCIgZm9udC1mYW1pbHk9IkhlbHZldGljYSBOZXVlLCBIZWx2ZXRpY2EsIEFyaWFsLCBzYW5zLXNlcmlmIgogICAgICAgIGZvbnQtc2l6ZT0iMTEiIGZvbnQtd2VpZ2h0PSI1MDAiIGZpbGw9IiMxRTVGOEMiIGxldHRlci1zcGFjaW5nPSIzLjQiPkRJR0lUQUwgTUVESUNBTCBERVZJQ0VTPC90ZXh0Pgo8L3N2Zz4K'
 where id = 'ORG1783849351837';


do $seed$
declare
  v_org  text := 'ORG1783849351837';
  v_name text;
  t_eng  text := 'TM_MD_ENG';
  t_qa   text := 'TM_MD_QA';
  t_ops  text := 'TM_MD_OPS';

  -- The readable accounts from the 22 in this org. The rest are
  -- invite-flow test artefacts ("Dupe 2", "cant invite") and are left
  -- out rather than dressed up as staff.
  u_admin uuid := 'c81df44d-4dbf-4bd0-8cac-8f523250cdc4'; -- Olaf Admin
  u_mgr   uuid := '13ea5f63-737b-438e-af5d-48e70a08fb37'; -- Olaf Manager
  u_sup   uuid := '1a6eda2d-d24e-41b3-b587-d81aec599b58'; -- act 14
  u_w1    uuid := '5866aec4-9796-4daf-83b5-fcc6e58697f2'; -- Olaf Worker1
  u_w2    uuid := 'c14643bd-e5fd-45a0-a3ad-133b31f47672'; -- Olaf Worker2

  p1 uuid; p2 uuid;
  s_in uuid; s_dev uuid; s_vv uuid; s_tr uuid;
  s_sup uuid; s_pv uuid; s_reg uuid; s_pilot uuid;
  k_req uuid; k_risk uuid; k_hw uuid; k_fw uuid; k_app uuid;
  k_bench uuid; k_clin uuid; k_cyber uuid; k_dhf uuid; k_pkg uuid;
  k_qual uuid; k_inc uuid; k_iq uuid; k_oq uuid; k_pq uuid;
  k_tga uuid; k_mdr uuid; k_build uuid; k_batch uuid;
  m_freeze uuid; m_vv uuid; m_transfer uuid;
  m_valid uuid; m_clear uuid; m_release uuid;
begin
  select name into v_name from public.organisations where id = v_org;

  insert into public.teams (id,name,type,description,org) values
    (t_eng,'Design & Engineering','function','Hardware, firmware and app development',v_org),
    (t_qa, 'Quality & Regulatory','function','Design controls, risk, submissions',v_org),
    (t_ops,'Manufacturing Operations','function','Process validation and production',v_org);

  insert into public.team_members (id,team_id,user_id,user_name,role,org) values
    ('TMM_MD_1',t_eng,u_w1, 'Olaf Worker1','worker',    v_org),
    ('TMM_MD_2',t_qa, u_sup,'act 14',      'supervisor',v_org),
    ('TMM_MD_3',t_ops,u_w2, 'Olaf Worker2','worker',    v_org),
    ('TMM_MD_4',t_qa, u_mgr,'Olaf Manager','manager',   v_org);

  -- ===================================================================
  -- Project 1 — product development, structured as design controls.
  -- ===================================================================
  insert into public.projects (org,ref,name,description,status,start_date,target_end_date,
                               owner_id,created_by_id)
  values (v_org,'PRJ-MD-0001','CardioSense Wearable — Product Development',
          'Design and development of a continuous cardiac monitoring wearable and its '
          'companion application, under ISO 13485 design controls. Design freeze gates '
          'verification; verification gates design transfer.',
          'active', current_date - 120, current_date + 90, u_mgr, u_admin)
  returning id into p1;

  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p1,null,'Design inputs',1) returning id into s_in;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p1,null,'Development',2) returning id into s_dev;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p1,null,'Verification & validation',3) returning id into s_vv;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p1,null,'Design transfer',4) returning id into s_tr;

  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p1,s_in,'User needs & requirements',1) returning id into k_req;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p1,s_in,'Risk analysis',2) returning id into k_risk;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p1,s_dev,'Hardware design',1) returning id into k_hw;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p1,s_dev,'Firmware',2) returning id into k_fw;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p1,s_dev,'Companion app',3) returning id into k_app;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p1,s_vv,'Bench verification',1) returning id into k_bench;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p1,s_vv,'Clinical validation',2) returning id into k_clin;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p1,s_vv,'Cybersecurity assessment',3) returning id into k_cyber;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p1,s_tr,'Design history file',1) returning id into k_dhf;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p1,s_tr,'Transfer package',2) returning id into k_pkg;

  insert into public.project_milestones (org,project_id,section_id,name,due_date,sort_order)
    values (v_org,p1,s_dev,'Design freeze',current_date - 10,1) returning id into m_freeze;
  insert into public.project_milestones (org,project_id,section_id,name,due_date,sort_order)
    values (v_org,p1,s_vv,'Verification complete',current_date + 35,2) returning id into m_vv;
  insert into public.project_milestones (org,project_id,section_id,name,due_date,sort_order)
    values (v_org,p1,s_tr,'Design transfer approved',current_date + 80,3) returning id into m_transfer;

  -- Design inputs: complete.
  insert into public.tasks (id,title,org,status,due_date,completed_at,project_id,section_id,
    team_id,team_name,milestone_id,assigned_user_ids,assigned_user_names,assigned_user_id,
    assigned_user_name,approver_id,approver_name,requires_approval,recurrence)
  values
   ('MD_REQ_1','Capture user needs from clinical advisory panel',v_name,'approved',current_date-100,now()-interval '101 days',
    p1,k_req,t_qa,'Quality & Regulatory',m_freeze,array[u_sup::text],array['act 14'],u_sup::text,'act 14',u_mgr::text,'Olaf Manager',true,'once'),
   ('MD_REQ_2','Translate user needs into design inputs',v_name,'approved',current_date-92,now()-interval '93 days',
    p1,k_req,t_eng,'Design & Engineering',m_freeze,array[u_w1::text],array['Olaf Worker1'],u_w1::text,'Olaf Worker1',u_mgr::text,'Olaf Manager',true,'once'),
   ('MD_RSK_1','Hazard analysis and risk evaluation (ISO 14971)',v_name,'approved',current_date-85,now()-interval '86 days',
    p1,k_risk,t_qa,'Quality & Regulatory',m_freeze,array[u_sup::text],array['act 14'],u_sup::text,'act 14',u_mgr::text,'Olaf Manager',true,'once'),
   ('MD_RSK_2','Define risk control measures',v_name,'approved',current_date-78,now()-interval '79 days',
    p1,k_risk,t_qa,'Quality & Regulatory',m_freeze,array[u_sup::text],array['act 14'],u_sup::text,'act 14',u_mgr::text,'Olaf Manager',true,'once');

  -- Development: hardware and firmware done, app running late.
  insert into public.tasks (id,title,org,status,due_date,completed_at,project_id,section_id,
    team_id,team_name,milestone_id,assigned_user_ids,assigned_user_names,assigned_user_id,
    assigned_user_name,approver_id,approver_name,requires_approval,recurrence)
  values
   ('MD_HW_1','Sensor front-end schematic and layout',v_name,'approved',current_date-60,now()-interval '61 days',
    p1,k_hw,t_eng,'Design & Engineering',m_freeze,array[u_w1::text],array['Olaf Worker1'],u_w1::text,'Olaf Worker1',u_mgr::text,'Olaf Manager',true,'once'),
   ('MD_HW_2','Enclosure design and biocompatibility review',v_name,'approved',current_date-45,now()-interval '46 days',
    p1,k_hw,t_eng,'Design & Engineering',m_freeze,array[u_w1::text],array['Olaf Worker1'],u_w1::text,'Olaf Worker1',u_mgr::text,'Olaf Manager',true,'once'),
   ('MD_FW_1','Signal acquisition firmware (IEC 62304 class B)',v_name,'approved',current_date-30,now()-interval '31 days',
    p1,k_fw,t_eng,'Design & Engineering',m_freeze,array[u_w1::text],array['Olaf Worker1'],u_w1::text,'Olaf Worker1',u_mgr::text,'Olaf Manager',true,'once'),
   ('MD_FW_2','Arrhythmia detection algorithm',v_name,'in_progress',current_date+6,null,
    p1,k_fw,t_eng,'Design & Engineering',m_vv,array[u_w1::text],array['Olaf Worker1'],u_w1::text,'Olaf Worker1',u_mgr::text,'Olaf Manager',true,'once'),
   ('MD_APP_1','Companion app — pairing and data sync',v_name,'in_progress',current_date+12,null,
    p1,k_app,t_eng,'Design & Engineering',m_vv,array[u_w2::text],array['Olaf Worker2'],u_w2::text,'Olaf Worker2',u_mgr::text,'Olaf Manager',true,'once'),
   ('MD_APP_2','Companion app — clinician dashboard',v_name,'pending',current_date+20,null,
    p1,k_app,t_eng,'Design & Engineering',m_vv,array[u_w2::text],array['Olaf Worker2'],u_w2::text,'Olaf Worker2',u_mgr::text,'Olaf Manager',true,'once');

  -- Verification and validation: not started, waiting on development.
  insert into public.tasks (id,title,org,status,due_date,project_id,section_id,
    team_id,team_name,milestone_id,assigned_user_ids,assigned_user_names,assigned_user_id,
    assigned_user_name,approver_id,approver_name,requires_approval,recurrence)
  values
   ('MD_BEN_1','Electrical safety testing (IEC 60601-1)',v_name,'pending',current_date+22,
    p1,k_bench,t_qa,'Quality & Regulatory',m_vv,array[u_sup::text],array['act 14'],u_sup::text,'act 14',u_mgr::text,'Olaf Manager',true,'once'),
   ('MD_BEN_2','Signal accuracy against reference ECG',v_name,'pending',current_date+28,
    p1,k_bench,t_eng,'Design & Engineering',m_vv,array[u_w1::text],array['Olaf Worker1'],u_w1::text,'Olaf Worker1',u_mgr::text,'Olaf Manager',true,'once'),
   ('MD_CLI_1','Clinical validation protocol and ethics approval',v_name,'pending',current_date+30,
    p1,k_clin,t_qa,'Quality & Regulatory',m_vv,array[u_sup::text],array['act 14'],u_sup::text,'act 14',u_admin::text,'Olaf Admin',true,'once'),
   ('MD_CYB_1','Threat model and penetration test',v_name,'pending',current_date+26,
    p1,k_cyber,t_eng,'Design & Engineering',m_vv,array[u_w2::text],array['Olaf Worker2'],u_w2::text,'Olaf Worker2',u_mgr::text,'Olaf Manager',true,'once');

  -- Design transfer.
  insert into public.tasks (id,title,org,status,due_date,project_id,section_id,
    team_id,team_name,milestone_id,assigned_user_ids,assigned_user_names,assigned_user_id,
    assigned_user_name,approver_id,approver_name,requires_approval,recurrence)
  values
   ('MD_DHF_1','Compile design history file',v_name,'pending',current_date+62,
    p1,k_dhf,t_qa,'Quality & Regulatory',m_transfer,array[u_sup::text],array['act 14'],u_sup::text,'act 14',u_admin::text,'Olaf Admin',true,'once'),
   ('MD_PKG_1','Manufacturing drawings and work instructions',v_name,'pending',current_date+70,
    p1,k_pkg,t_eng,'Design & Engineering',m_transfer,array[u_w1::text],array['Olaf Worker1'],u_w1::text,'Olaf Worker1',u_mgr::text,'Olaf Manager',true,'once'),
   ('MD_PKG_2','Design transfer review and sign-off',v_name,'pending',current_date+78,
    p1,k_pkg,t_qa,'Quality & Regulatory',m_transfer,array[u_mgr::text],array['Olaf Manager'],u_mgr::text,'Olaf Manager',u_admin::text,'Olaf Admin',true,'once');

  -- An attached corrective action from an existing incident. It blocks
  -- the verification gate and joins no chain.
  insert into public.tasks (id,title,org,status,due_date,project_id,section_id,
    team_id,team_name,milestone_id,blocks_milestone,assigned_user_ids,assigned_user_names,
    assigned_user_id,assigned_user_name,approver_id,approver_name,requires_approval,recurrence)
  values
   ('MD_CAPA_1','Corrective action — sensor drift observed in pre-production units',
    v_name,'pending',current_date+14,p1,k_bench,t_eng,'Design & Engineering',m_vv,true,
    array[u_w1::text],array['Olaf Worker1'],u_w1::text,'Olaf Worker1',u_sup::text,'act 14',true,'once');

  insert into public.task_dependencies
    (org,project_id,predecessor_section_id,successor_section_id,gap_days,match_by_team)
  values
    (v_org,p1,k_req,  k_risk, 0,false),
    (v_org,p1,k_risk, k_hw,   0,false),
    (v_org,p1,k_hw,   k_fw,   0,false),
    (v_org,p1,k_fw,   k_bench,2,false),
    (v_org,p1,k_app,  k_cyber,2,false),
    (v_org,p1,k_bench,k_clin, 5,false),
    (v_org,p1,k_clin, k_dhf,  0,false),
    (v_org,p1,k_dhf,  k_pkg,  0,false);

  update public.project_milestones
     set status='met', met_at=now()-interval '10 days', met_by_id=u_admin,
         met_note='Design inputs approved and hardware baselined.'
   where id = m_freeze;

  -- ===================================================================
  -- Project 2 — transition to manufacturing.
  -- ===================================================================
  insert into public.projects (org,ref,name,description,status,start_date,target_end_date,
                               owner_id,created_by_id)
  values (v_org,'PRJ-MD-0002','CardioSense — Transition to Manufacturing',
          'Moving the wearable from validated design into routine production: supplier '
          'qualification, process validation (IQ/OQ/PQ), regulatory clearance and pilot '
          'build. The notified body audit date is fixed.',
          'active', current_date - 30, current_date + 150, u_mgr, u_admin)
  returning id into p2;

  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p2,null,'Supplier readiness',1) returning id into s_sup;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p2,null,'Process validation',2) returning id into s_pv;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p2,null,'Regulatory',3) returning id into s_reg;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p2,null,'Pilot production',4) returning id into s_pilot;

  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p2,s_sup,'Supplier qualification',1) returning id into k_qual;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p2,s_sup,'Incoming inspection',2) returning id into k_inc;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p2,s_pv,'Installation qualification',1) returning id into k_iq;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p2,s_pv,'Operational qualification',2) returning id into k_oq;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p2,s_pv,'Performance qualification',3) returning id into k_pq;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p2,s_reg,'TGA submission',1) returning id into k_tga;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p2,s_reg,'EU MDR technical file',2) returning id into k_mdr;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p2,s_pilot,'Pilot build',1) returning id into k_build;
  insert into public.project_sections (project_id,parent_id,name,sort_order)
    values (p2,s_pilot,'Batch record review',2) returning id into k_batch;

  insert into public.project_milestones (org,project_id,section_id,name,due_date,sort_order)
    values (v_org,p2,s_pv,'Process validated',current_date+70,1) returning id into m_valid;
  insert into public.project_milestones
    (org,project_id,section_id,name,due_date,sort_order,date_locked,lock_reason)
    values (v_org,p2,s_reg,'Notified body audit',current_date+95,2,true,
            'Audit date set by the notified body. It does not move for internal delays.')
    returning id into m_clear;
  insert into public.project_milestones (org,project_id,section_id,name,due_date,sort_order)
    values (v_org,p2,s_pilot,'First batch released',current_date+140,3) returning id into m_release;

  insert into public.tasks (id,title,org,status,due_date,completed_at,project_id,section_id,
    team_id,team_name,milestone_id,assigned_user_ids,assigned_user_names,assigned_user_id,
    assigned_user_name,approver_id,approver_name,requires_approval,recurrence)
  values
   ('MD_SUP_1','Audit contract manufacturer quality system',v_name,'approved',current_date-20,now()-interval '21 days',
    p2,k_qual,t_qa,'Quality & Regulatory',m_valid,array[u_sup::text],array['act 14'],u_sup::text,'act 14',u_mgr::text,'Olaf Manager',true,'once'),
   ('MD_SUP_2','Qualify sensor component supplier',v_name,'in_progress',current_date+3,null,
    p2,k_qual,t_ops,'Manufacturing Operations',m_valid,array[u_w2::text],array['Olaf Worker2'],u_w2::text,'Olaf Worker2',u_sup::text,'act 14',true,'once'),
   ('MD_INC_1','Define incoming inspection criteria',v_name,'pending',current_date+15,null,
    p2,k_inc,t_qa,'Quality & Regulatory',m_valid,array[u_sup::text],array['act 14'],u_sup::text,'act 14',u_mgr::text,'Olaf Manager',true,'once');

  insert into public.tasks (id,title,org,status,due_date,project_id,section_id,
    team_id,team_name,milestone_id,assigned_user_ids,assigned_user_names,assigned_user_id,
    assigned_user_name,approver_id,approver_name,requires_approval,recurrence)
  values
   ('MD_IQ_1','Install and qualify assembly line equipment',v_name,'pending',current_date+25,
    p2,k_iq,t_ops,'Manufacturing Operations',m_valid,array[u_w2::text],array['Olaf Worker2'],u_w2::text,'Olaf Worker2',u_sup::text,'act 14',true,'once'),
   ('MD_IQ_2','Calibrate test fixtures',v_name,'pending',current_date+30,
    p2,k_iq,t_ops,'Manufacturing Operations',m_valid,array[u_w2::text],array['Olaf Worker2'],u_w2::text,'Olaf Worker2',u_sup::text,'act 14',true,'once'),
   ('MD_OQ_1','Operational qualification runs at process limits',v_name,'pending',current_date+42,
    p2,k_oq,t_ops,'Manufacturing Operations',m_valid,array[u_w2::text],array['Olaf Worker2'],u_w2::text,'Olaf Worker2',u_sup::text,'act 14',true,'once'),
   ('MD_PQ_1','Three consecutive validation batches',v_name,'pending',current_date+60,
    p2,k_pq,t_ops,'Manufacturing Operations',m_valid,array[u_w2::text],array['Olaf Worker2'],u_w2::text,'Olaf Worker2',u_mgr::text,'Olaf Manager',true,'once'),
   ('MD_PQ_2','Process capability analysis',v_name,'pending',current_date+66,
    p2,k_pq,t_qa,'Quality & Regulatory',m_valid,array[u_sup::text],array['act 14'],u_sup::text,'act 14',u_mgr::text,'Olaf Manager',true,'once');

  insert into public.tasks (id,title,org,status,due_date,project_id,section_id,
    team_id,team_name,milestone_id,due_date_locked,due_date_lock_reason,
    assigned_user_ids,assigned_user_names,assigned_user_id,assigned_user_name,
    approver_id,approver_name,requires_approval,recurrence)
  values
   ('MD_TGA_1','TGA conformity assessment submission',v_name,'pending',current_date+88,
    p2,k_tga,t_qa,'Quality & Regulatory',m_clear,true,
    'Submission window set by the TGA. Missing it defers clearance by a full cycle.',
    array[u_sup::text],array['act 14'],u_sup::text,'act 14',u_admin::text,'Olaf Admin',true,'once'),
   ('MD_MDR_1','Notified body audit — EU MDR technical file',v_name,'pending',current_date+95,
    p2,k_mdr,t_qa,'Quality & Regulatory',m_clear,true,
    'Audit date fixed by the notified body. It does not move for internal delays.',
    array[u_mgr::text],array['Olaf Manager'],u_mgr::text,'Olaf Manager',u_admin::text,'Olaf Admin',true,'once');

  insert into public.tasks (id,title,org,status,due_date,project_id,section_id,
    team_id,team_name,milestone_id,assigned_user_ids,assigned_user_names,assigned_user_id,
    assigned_user_name,approver_id,approver_name,requires_approval,recurrence)
  values
   ('MD_BLD_1','Pilot build of 200 units',v_name,'pending',current_date+115,
    p2,k_build,t_ops,'Manufacturing Operations',m_release,array[u_w2::text],array['Olaf Worker2'],u_w2::text,'Olaf Worker2',u_mgr::text,'Olaf Manager',true,'once'),
   ('MD_BAT_1','Device history record review and batch release',v_name,'pending',current_date+135,
    p2,k_batch,t_qa,'Quality & Regulatory',m_release,array[u_sup::text],array['act 14'],u_sup::text,'act 14',u_admin::text,'Olaf Admin',true,'once');

  insert into public.task_dependencies
    (org,project_id,predecessor_section_id,successor_section_id,gap_days,match_by_team)
  values
    (v_org,p2,k_qual, k_inc,  0,false),
    (v_org,p2,k_inc,  k_iq,   0,false),
    (v_org,p2,k_iq,   k_oq,   2,false),
    (v_org,p2,k_oq,   k_pq,   3,false),
    (v_org,p2,k_pq,   k_tga,  5,false),
    (v_org,p2,k_tga,  k_mdr,  0,false),
    (v_org,p2,k_pq,   k_build,7,false),
    (v_org,p2,k_build,k_batch,5,false);
end $seed$;

commit;


-- =====================================================================
-- Propagation runs for real, so the plans reflect the delays in them.
-- =====================================================================
select 'MD-PROP-1' as marker, kind, task_id, old_due_date, new_due_date, delta_days, note
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-MD-0001'), false)
order by kind, new_due_date;

select 'MD-PROP-2' as marker, kind, task_id, old_due_date, new_due_date, delta_days, note
from public.recompute_project_dates(
  (select id from public.projects where ref='PRJ-MD-0002'), false)
order by kind, new_due_date;

select 'MD-SUMMARY' as marker, p.ref, p.name,
       count(t.id) as tasks,
       count(t.id) filter (where t.status in ('approved','completed')) as done,
       (select count(*) from public.project_sections s
         where s.project_id=p.id and s.parent_id is not null) as stages,
       (select count(*) from public.project_milestones m where m.project_id=p.id) as gates
from public.projects p
left join public.tasks t on t.project_id = p.id
where p.org='ORG1783849351837'
group by p.ref, p.name, p.id order by p.ref;

-- Nothing that was there before was touched.
select 'MD-UNTOUCHED' as marker,
  (select count(*) from public.tasks
    where org='Test Org' and id not like 'MD_%') as pre_existing_tasks_should_be_8,
  (select count(*) from public.incidents
    where org='ORG1783849351837') as incidents_should_be_48;
