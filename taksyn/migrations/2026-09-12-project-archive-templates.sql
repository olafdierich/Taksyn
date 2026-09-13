-- ===========================================================================
-- Taksyn migration -- project archive, duplicate, and stage templates
-- 12 September 2026
--
-- WHY THE ARCHIVE IS A MARKER, NOT A STATUS
-- The Archive button used to write status = 'cancelled'. A project that finished
-- properly and was archived to tidy the list was then recorded, and printed in
-- reports, as cancelled. archived_at / archived_by_id keep that separate, so the
-- status stays true: active, awaiting_signoff, closed or cancelled.
-- The app treats a project as archived when archived_at is set OR the status is
-- closed/cancelled, so sign-off still lands in the archive by itself, and rows
-- the old button marked cancelled stay where they are.
--
-- TEMPLATE GROUPING
-- checklist_templates gains template_group (the project a template came from)
-- and template_stage. The unique index is what makes "save this stage again"
-- reuse rather than duplicate, and it keys on coalesce(template_stage,'') so a
-- row saved before the stage column existed does not collide with a later one.
-- Both columns are null for ordinary templates, which are untouched.
--
-- THE THREE FUNCTIONS
--   project_tasks_to_templates  every task in a project -> templates. Retained
--                               but NO LONGER CALLED by the app: duplicating a
--                               project quietly creating seventeen templates was
--                               a surprise, not a service. Kept so that decision
--                               is reversible without rebuilding it.
--   stage_tasks_to_templates    one stage -> templates. This is the deliberate
--                               route, from a stage's menu.
--   duplicate_project           structure only: sections, stages, milestones and
--                               the stage dependency links. p_with_templates
--                               defaults TRUE so an un-patched app keeps its old
--                               behaviour; the app passes FALSE.
--
-- All three are SECURITY INVOKER and check is_org_admin, so the existing RLS
-- applies and no new privileged path was created.
--
-- MILESTONES KEEP THEIR SPACING, they are not blanked: project_milestones.due_date
-- is NOT NULL, so a copy without dates is impossible. Each milestone lands the
-- same number of days after the new start date as it was after the old one.
-- Cancelled milestones are not copied.
--
-- SECTIONS BEFORE STAGES: the ordering clause puts parents first (parent_id is
-- null sorts before not-null), because a stage cannot reference a section that
-- has not been created yet. v_map carries old id -> new id for the milestones
-- and links that follow.
--
-- VERIFIED on sandbox (PRJ-DB-04, PRJ-DB-08): an 11-section project copied to
-- exactly 11 sections, 3 milestones, 4 links; a second duplicate created 0
-- templates and reused 17; saving a stage that had already been captured
-- reported 0 new and 4 already there.
--
-- SAFE TO RE-RUN. Columns and index use IF NOT EXISTS; functions are CREATE OR
-- REPLACE; no data is touched.
-- Applied to SANDBOX and LIVE 12 Sep 2026, confirmed on both (PRJ-DB-10,
-- MIG-11): 4 columns, 1 index, 3 functions -- one duplicate_project taking
-- four arguments.
--
-- NO FINGERPRINTS ARE RECORDED FOR THESE THREE. The text here carries
-- explanatory comments the databases do not, so md5(prosrc) differs by
-- design. The behaviour is identical; a recorded fingerprint that cannot
-- match would be worse than none. Verify with MIG-11 instead: three
-- functions, one signature each.
-- ===========================================================================

alter table public.projects
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by_id uuid;

alter table public.checklist_templates
  add column if not exists template_group text,
  add column if not exists template_stage text;

create unique index if not exists checklist_templates_group_stage_name_uq
  on public.checklist_templates (organisation_id, template_group, coalesce(template_stage,''), name)
  where template_group is not null;

create or replace function public.project_tasks_to_templates(p_source uuid)
returns table(created int, reused int)
language plpgsql security invoker set search_path to 'public' as $f$
declare v_p projects; v_by text; r record; v_subs jsonb; v_items jsonb; n_new int := 0; n_old int := 0; v_id uuid;
begin
  select * into v_p from projects where projects.id = p_source;
  if not found then raise exception 'Project not found.'; end if;
  if not is_org_admin(v_p.org) then raise exception 'Only a manager or client admin may do this.' using errcode = '42501'; end if;
  select p.name into v_by from profiles p where p.id = auth.uid();
  for r in select t.title, t.priority, t.subtasks, s.name as stage
             from tasks t left join project_sections s on s.id = t.section_id
            where t.project_id = p_source and coalesce(btrim(t.title),'') <> '' loop
    -- subtasks is jsonb on the table but some rows hold a JSON STRING, so unwrap
    -- before reading it as an array; anything else becomes an empty checklist.
    v_subs := case when jsonb_typeof(r.subtasks) = 'string' then (r.subtasks #>> '{}')::jsonb else coalesce(r.subtasks, '[]'::jsonb) end;
    if jsonb_typeof(v_subs) <> 'array' then v_subs := '[]'::jsonb; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'label', coalesce(it->>'text', it->>'label', ''),
             'required', coalesce(it->>'mandatory', it->>'required') = 'true',
             'requirePhoto', (it->>'requirePhoto') = 'true',
             'requireTimestamp', (it->>'requireTimestamp') = 'true',
             'instruction', coalesce(it->>'instruction', ''))), '[]'::jsonb)
      into v_items from jsonb_array_elements(v_subs) it;
    v_id := null;
    insert into checklist_templates(organisation_id, name, description, priority, items, created_by, template_group, template_stage)
    values (v_p.org, btrim(r.title), 'From ' || v_p.name || coalesce(' · ' || r.stage, ''), r.priority, v_items, v_by, v_p.name, r.stage)
    on conflict (organisation_id, template_group, coalesce(template_stage,''), name) where template_group is not null do nothing
    returning checklist_templates.id into v_id;
    if v_id is null then n_old := n_old + 1; else n_new := n_new + 1; end if;
  end loop;
  return query select n_new, n_old;
end $f$;

create or replace function public.stage_tasks_to_templates(p_stage uuid)
returns table(created int, reused int, project_name text, stage_name text)
language plpgsql security invoker set search_path to 'public' as $f$
declare v_s project_sections; v_p projects; v_by text; r record; v_subs jsonb; v_items jsonb;
        n_new int := 0; n_old int := 0; v_id uuid;
begin
  select * into v_s from project_sections where project_sections.id = p_stage;
  if not found then raise exception 'Stage not found.'; end if;
  select * into v_p from projects where projects.id = v_s.project_id;
  if not is_org_admin(v_p.org) then raise exception 'Only a manager or client admin may do this.' using errcode = '42501'; end if;
  select p.name into v_by from profiles p where p.id = auth.uid();
  for r in select t.title, t.priority, t.subtasks from tasks t
            where t.section_id = p_stage and coalesce(btrim(t.title),'') <> '' loop
    v_subs := case when jsonb_typeof(r.subtasks) = 'string' then (r.subtasks #>> '{}')::jsonb else coalesce(r.subtasks, '[]'::jsonb) end;
    if jsonb_typeof(v_subs) <> 'array' then v_subs := '[]'::jsonb; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'label', coalesce(it->>'text', it->>'label', ''),
             'required', coalesce(it->>'mandatory', it->>'required') = 'true',
             'requirePhoto', (it->>'requirePhoto') = 'true',
             'requireTimestamp', (it->>'requireTimestamp') = 'true',
             'instruction', coalesce(it->>'instruction', ''))), '[]'::jsonb)
      into v_items from jsonb_array_elements(v_subs) it;
    v_id := null;
    insert into checklist_templates(organisation_id, name, description, priority, items, created_by, template_group, template_stage)
    values (v_p.org, btrim(r.title), 'From ' || v_p.name || ' · ' || v_s.name, r.priority, v_items, v_by, v_p.name, v_s.name)
    on conflict (organisation_id, template_group, coalesce(template_stage,''), name) where template_group is not null do nothing
    returning checklist_templates.id into v_id;
    if v_id is null then n_old := n_old + 1; else n_new := n_new + 1; end if;
  end loop;
  return query select n_new, n_old, v_p.name, v_s.name;
end $f$;

-- Remove the superseded three-argument version before creating the new one, so a
-- rebuilt database never holds both. Harmless if it was never there.
drop function if exists public.duplicate_project(uuid, text, date);

create or replace function public.duplicate_project(p_source uuid, p_name text, p_start_date date default current_date, p_with_templates boolean default true)
returns table(id uuid, ref text, sections int, milestones int, links int, templates_created int, templates_reused int)
language plpgsql security invoker set search_path to 'public' as $f$
declare v_p projects; v_new uuid; v_ref text; v_map jsonb := '{}'; r record; v_sid uuid;
        n_s int := 0; n_m int := 0; n_l int := 0; t_new int := 0; t_old int := 0;
begin
  select * into v_p from projects where projects.id = p_source;
  if not found then raise exception 'Project not found.'; end if;
  -- through create_project, so the reference numbering, the name check and the
  -- is_org_admin gate all stay in one place.
  select c.id, c.ref into v_new, v_ref from create_project(v_p.org, p_name, v_p.description, p_start_date, null) c;
  for r in select * from project_sections s where s.project_id = p_source order by (s.parent_id is not null), s.sort_order loop
    insert into project_sections(project_id, parent_id, name, sort_order)
    values (v_new, (v_map ->> r.parent_id::text)::uuid, r.name, r.sort_order)
    returning project_sections.id into v_sid;
    v_map := v_map || jsonb_build_object(r.id::text, v_sid); n_s := n_s + 1;
  end loop;
  insert into project_milestones(org, project_id, section_id, name, due_date, sort_order, created_by_id)
  select v_p.org, v_new, (v_map ->> m.section_id::text)::uuid, m.name,
         p_start_date + (m.due_date - coalesce(v_p.start_date, m.due_date)), m.sort_order, auth.uid()
    from project_milestones m where m.project_id = p_source and m.status <> 'cancelled';
  get diagnostics n_m = row_count;
  insert into task_dependencies(org, project_id, predecessor_section_id, successor_section_id, gap_days, match_by_team, created_by_id)
  select v_p.org, v_new, (v_map ->> d.predecessor_section_id::text)::uuid, (v_map ->> d.successor_section_id::text)::uuid,
         d.gap_days, d.match_by_team, auth.uid()
    from task_dependencies d where d.project_id = p_source;
  get diagnostics n_l = row_count;
  if p_with_templates then
    select c.created, c.reused into t_new, t_old from project_tasks_to_templates(p_source) c;
  end if;
  return query select v_new, v_ref, n_s, n_m, n_l, t_new, t_old;
end $f$;
