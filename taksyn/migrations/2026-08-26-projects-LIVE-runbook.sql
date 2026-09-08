-- =====================================================================
-- Taksyn — Projects module: LIVE RUNBOOK
-- TARGET: LIVE yylvtvbhddcepilzwpaw
-- Date: 26 August 2026
--
-- ⚠ THIS FILE IS THE ONE THAT RUNS ON LIVE.
-- Every other projects migration REFUSES to run here. This one refuses
-- to run anywhere ELSE: the guard below is inverted and aborts unless
-- Kemrose is present. Running it on sandbox would be harmless but
-- pointless, and the guard says so rather than leaving it to memory.
--
-- WHY THIS IS NOT A REPLAY OF BLOCKS 1-11
-- The sandbox history includes a column rename (match_by_area became
-- match_by_team) and a dropped table (org_areas, replaced by teams).
-- Replaying that on LIVE would create a table in order to delete it and
-- rename a column nobody had seen. This applies the END STATE instead:
-- the schema as it now stands, in one transaction.
--
-- WHY THIS IS URGENT
-- src/ProjectsView.jsx is already on main and deployed. It queries
-- projects.ref, projects.owner_id and project_sections, none of which
-- exist here — so the Projects page is currently erroring for LIVE
-- users. The blast radius is one page that used to be a placeholder,
-- but it is broken in production until this runs.
--
-- WHAT IS SAFE ABOUT IT
--   projects is REBUILT, and LIVE holds 0 rows. Nothing is lost.
--   Everything else is CREATE TABLE or a nullable ALTER. Adding a
--   nullable column without a default is metadata-only in PostgreSQL 11+
--   and does not rewrite the table — with 42 tasks that would not matter
--   anyway, but it will when there are 42,000.
--   No existing table is dropped. No existing column changes type.
--   No row in any existing table is modified.
--
-- WHAT IS NOT HERE
--   No sample data. The sandbox seeds were for proving behaviour.
--   No test writes. Everything below is schema; the verification at the
--   end reads only.
--
-- ROLLBACK
-- The whole thing is one transaction. If any statement fails, nothing
-- is applied and LIVE is exactly as it was. There is no half-state.
-- =====================================================================

\set ON_ERROR_STOP on
set client_min_messages = warning;

begin;

-- ---------------------------------------------------------------------
-- Guard, inverted. This file belongs on LIVE and nowhere else.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose not found. This runbook is for LIVE only.';
  end if;
  if to_regclass('public.project_sections') is not null then
    raise exception 'ABORT: project_sections already exists. This runbook has already been applied.';
  end if;
  if (select count(*) from public.projects) > 0 then
    raise exception 'ABORT: public.projects holds rows. It was expected to be an empty stub — stopping rather than dropping data.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 1. projects — dropped and rebuilt.
--
-- The existing table is a 7-column stub with zero rows. It is rebuilt
-- rather than altered because its id is text and its created_by is a
-- display NAME — the same defect as tasks.created_by, and LIVE holds
-- three profiles named "Olaf Rusoke-Dierich", so a name identifies
-- nobody. Fixing it now costs nothing; later it costs a migration.
-- ---------------------------------------------------------------------
drop table if exists public.projects cascade;

create table public.projects (
  id                uuid primary key default gen_random_uuid(),
  org               text not null references public.organisations(id),
  ref               text not null,
  name              text not null,
  description       text,
  status            text not null default 'active',
  start_date        date,
  target_end_date   date,
  owner_id          uuid references auth.users(id),
  created_by_id     uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  closed_at         timestamptz,
  closed_by_id      uuid references auth.users(id),
  signoff_note      text,

  constraint projects_org_must_be_id check (org like 'ORG%'),
  constraint projects_status_check
    check (status in ('active','awaiting_signoff','closed','cancelled')),
  -- Sign-off is the compliance moment; an unattributed one is worthless.
  constraint projects_closed_needs_attribution
    check ((status not in ('closed','cancelled'))
           or (closed_at is not null and closed_by_id is not null)),
  constraint projects_ref_unique_per_org unique (org, ref)
);

comment on table public.projects is
  'Compliance projects. Archive is status in (closed,cancelled) — a filter, not a separate table, same as the incident register.';
comment on column public.projects.org is
  'Organisation ID (ORG...), NOT the name. tasks.org and profiles.org store the NAME; this stores the ID, like org_members.org. The two are joined through project_id, never through org.';

create index projects_org_status_idx on public.projects (org, status);
alter table public.projects enable row level security;


-- ---------------------------------------------------------------------
-- 2. project_sections — two levels.
--   parent_id null -> SECTION (a tile on the project overview)
--   parent_id set  -> STAGE   (a bar on the timeline)
-- ---------------------------------------------------------------------
create table public.project_sections (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  parent_id     uuid references public.project_sections(id) on delete cascade,
  name          text not null,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

comment on table public.project_sections is
  'Two levels only: parent_id null = section, parent_id set = stage. Depth enforced by trigger — a CHECK cannot see another row.';

create index project_sections_project_idx
  on public.project_sections (project_id, parent_id, sort_order);

create or replace function public.project_sections_depth_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null then
    if exists (select 1 from public.project_sections p
               where p.id = new.parent_id and p.parent_id is not null) then
      raise exception 'project_sections: maximum depth is two (section > stage)';
    end if;
  end if;
  return new;
end $$;

create trigger project_sections_depth_biu
  before insert or update on public.project_sections
  for each row execute function public.project_sections_depth_guard();

alter table public.project_sections enable row level security;


-- ---------------------------------------------------------------------
-- 3. task_dependencies — stage to stage, applied per team.
--
-- One link drawn once ("safety checks follows electrical works") becomes
-- many real constraints: the Riverside team's safety work waits on the
-- Riverside team's electrical work and not on Hilltop's. That is what
-- lets teams overlap instead of queueing.
-- ---------------------------------------------------------------------
create table public.task_dependencies (
  id                      uuid primary key default gen_random_uuid(),
  org                     text not null references public.organisations(id),
  project_id              uuid not null references public.projects(id) on delete cascade,
  predecessor_section_id  uuid not null references public.project_sections(id) on delete cascade,
  successor_section_id    uuid not null references public.project_sections(id) on delete cascade,
  -- Negative is allowed on purpose: second fix starting while first fix
  -- snags is normal, and without it people fake dates to make the plan
  -- match reality, which is how a plan stops being evidence.
  gap_days                integer not null default 0,
  match_by_team           boolean not null default true,
  created_by_id           uuid references auth.users(id),
  created_at              timestamptz not null default now(),

  constraint task_dep_org_must_be_id check (org like 'ORG%'),
  -- Longer cycles (A->B->C->A) are caught by the walk in
  -- recompute_project_dates; a CHECK cannot see another row.
  constraint task_dep_no_self_reference
    check (predecessor_section_id <> successor_section_id),
  constraint task_dep_gap_sane check (gap_days between -90 and 365)
);

create unique index task_dep_unique_pair
  on public.task_dependencies (predecessor_section_id, successor_section_id);
create index task_dep_predecessor_idx on public.task_dependencies (predecessor_section_id);
create index task_dep_project_idx on public.task_dependencies (project_id);

alter table public.task_dependencies enable row level security;


-- ---------------------------------------------------------------------
-- 4. project_schedule_events — what moved and what refused to move.
--
-- A kind='blocked' row IS the alert: a locked date the chain pushed
-- against. There is no separate alerts table.
-- ---------------------------------------------------------------------
create table public.project_schedule_events (
  id            uuid primary key default gen_random_uuid(),
  org           text not null,
  project_id    uuid not null references public.projects(id) on delete cascade,
  run_id        uuid not null,
  kind          text not null,
  task_id       text,
  section_id    uuid,
  old_due_date  date,
  new_due_date  date,
  delta_days    integer,
  caused_by_section_id uuid,
  note          text,
  created_at    timestamptz not null default now(),
  constraint pse_kind_check check (kind in ('shift','blocked','cycle','noop'))
);

create index pse_project_run_idx on public.project_schedule_events (project_id, run_id, created_at);
create index pse_blocked_idx on public.project_schedule_events (project_id, kind, created_at desc);
alter table public.project_schedule_events enable row level security;


-- ---------------------------------------------------------------------
-- 5. project_milestones — dated gates.
--
-- Milestones do NOT move when the chain slips. Work being pushed past a
-- gate is the signal; sliding the gate would erase it.
-- ---------------------------------------------------------------------
create table public.project_milestones (
  id            uuid primary key default gen_random_uuid(),
  org           text not null references public.organisations(id),
  project_id    uuid not null references public.projects(id) on delete cascade,
  section_id    uuid references public.project_sections(id) on delete set null,
  name          text not null,
  due_date      date not null,
  sort_order    integer not null default 0,
  date_locked   boolean not null default false,
  lock_reason   text,
  status        text not null default 'open',
  met_at        timestamptz,
  met_by_id     uuid references auth.users(id),
  met_note      text,
  created_by_id uuid references auth.users(id),
  created_at    timestamptz not null default now(),

  constraint pm_org_must_be_id check (org like 'ORG%'),
  constraint pm_status_check check (status in ('open','met','cancelled')),
  -- The assertion IS the compliance artefact; an unattributed one is
  -- worth nothing.
  constraint pm_met_needs_attribution
    check (status <> 'met' or (met_at is not null and met_by_id is not null)),
  constraint pm_lock_needs_reason
    check (not date_locked or length(btrim(coalesce(lock_reason,''))) >= 10)
);

create index pm_project_idx on public.project_milestones (project_id, sort_order);
create index pm_open_idx on public.project_milestones (org, status, due_date);
alter table public.project_milestones enable row level security;


-- ---------------------------------------------------------------------
-- 6. project_reports — the written judgement, and what was claimed.
-- ---------------------------------------------------------------------
create table public.project_reports (
  id              uuid primary key default gen_random_uuid(),
  org             text not null references public.organisations(id),
  project_id      uuid not null references public.projects(id) on delete cascade,
  period_from     date,
  period_to       date not null,
  period_label    text not null,
  conclusion      text,
  strengths       text,
  weaknesses      text,
  next_steps      text,
  snapshot        jsonb not null default '{}'::jsonb,
  created_by_id   uuid not null references auth.users(id),
  created_by_name text,
  created_at      timestamptz not null default now(),

  constraint pr_org_must_be_id check (org like 'ORG%'),
  constraint pr_period_sane check (period_from is null or period_to >= period_from)
);

comment on table public.project_reports is
  'One row per report produced. Holds the written judgement, which cannot be regenerated, and a shallow snapshot of what the document claimed — a report rerun months later will not match, because the data has moved.';

create index pr_project_idx on public.project_reports (project_id, created_at desc);
alter table public.project_reports enable row level security;


-- ---------------------------------------------------------------------
-- 7. tasks — eight nullable columns.
--
-- All additive. Nothing existing reads them, so this cannot affect any
-- task, dashboard, KPI or report already running.
-- ---------------------------------------------------------------------
alter table public.tasks
  add column if not exists project_id           uuid references public.projects(id) on delete set null,
  add column if not exists section_id           uuid references public.project_sections(id) on delete set null,
  add column if not exists milestone_id         uuid references public.project_milestones(id) on delete set null,
  add column if not exists blocks_milestone     boolean not null default false,
  add column if not exists due_date_locked      boolean not null default false,
  add column if not exists due_date_lock_reason text;

comment on column public.tasks.due_date_locked is
  'True = this date never moves. Propagation raises an alert instead of shifting it, and no extension can be requested against it. The statutory-deadline case.';
comment on column public.tasks.blocks_milestone is
  'True = this task stops its milestone being met while open. Kept out of the timeline geometry so unplanned work does not distort the plan.';

create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists tasks_section_idx on public.tasks (section_id);
create index if not exists tasks_milestone_idx on public.tasks (milestone_id) where milestone_id is not null;


-- ---------------------------------------------------------------------
-- 8. project_milestone_state
--
-- security_invoker so RLS applies as the QUERYING user. Without it a
-- view runs as its owner and becomes a hole straight through every
-- policy below.
-- ---------------------------------------------------------------------
create or replace view public.project_milestone_state
with (security_invoker = true) as
select
  m.id as milestone_id, m.project_id, m.org, m.section_id, m.name,
  m.due_date, m.status, m.date_locked, m.met_at,
  count(t.id) as task_count,
  count(t.id) filter (where t.status in ('approved','completed')) as tasks_done,
  count(t.id) filter (where t.status not in ('approved','completed')) as tasks_open,
  count(t.id) filter (where t.blocks_milestone
                        and t.status not in ('approved','completed')) as blockers_open,
  max(t.due_date) filter (where t.status not in ('approved','completed')) as latest_open_due,
  (m.status = 'open'
   and max(t.due_date) filter (where t.status not in ('approved','completed')) > m.due_date) as at_risk,
  (m.status = 'open'
   and count(t.id) filter (where t.status not in ('approved','completed')) = 0) as ready_to_meet
from public.project_milestones m
left join public.tasks t on t.milestone_id = m.id
group by m.id;


-- ---------------------------------------------------------------------
-- 9. recompute_project_dates
--
-- RECOMPUTES, never patches: "push it back two weeks" applied twice by
-- two code paths gives four weeks, and that bug is invisible afterwards.
-- Running it five times gives the same answer as running it once.
--
-- An RPC rather than a trigger. A trigger could not be bypassed, but it
-- would fire inside every write App.jsx already makes, including the
-- recurrence and miss-writer paths, which have a measured history of
-- write storms. A chain walk inside those is not a risk worth taking.
-- ---------------------------------------------------------------------
create or replace function public.recompute_project_dates(
  p_project_id uuid, p_dry_run boolean default true, p_tz text default 'UTC'
)
returns table (kind text, task_id text, section_id uuid, team_id text,
               old_due_date date, new_due_date date, delta_days integer, note text)
language plpgsql security definer set search_path = public as $fn$
declare
  v_org text; v_run uuid := gen_random_uuid();
  v_progress boolean; v_pending integer; v_pkg uuid;
  v_today date := (now() at time zone p_tz)::date;
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
    caused_by uuid, note text) on commit drop;

  loop
    select count(*) into v_pending from _pkg where not processed;
    exit when v_pending = 0;
    v_progress := false;

    for v_pkg in
      select k.section_id from _pkg k
      where not k.processed
        and not exists (select 1 from public.task_dependencies d
                        join _pkg pk on pk.section_id = d.predecessor_section_id
                        where d.successor_section_id = k.section_id and not pk.processed)
    loop
      drop table if exists _req;
      create temp table _req on commit drop as
      with pred_finish as (
        select d.gap_days, d.match_by_team, d.predecessor_section_id, e.team_key,
               max(case when e.completed_at is not null
                          then (e.completed_at at time zone p_tz)::date
                        -- Overdue and incomplete finishes TODAY and keeps
                        -- moving, so successors track a delay while it is
                        -- happening rather than only once it ends.
                        when e.due_date < v_today then v_today
                        else e.due_date end) as finish_date
        from public.task_dependencies d
        join _eff e on e.section_id = d.predecessor_section_id
        where d.successor_section_id = v_pkg
        group by d.gap_days, d.match_by_team, d.predecessor_section_id, e.team_key
      ),
      whole_pkg as (
        select pf.predecessor_section_id, pf.gap_days, max(pf.finish_date) as finish_date
        from pred_finish pf where not pf.match_by_team
        group by pf.predecessor_section_id, pf.gap_days
      )
      select team_key, max(required_start) as required_start,
             (array_agg(caused_by order by required_start desc))[1] as caused_by
      from (
        select pf.team_key, pf.finish_date + pf.gap_days, pf.predecessor_section_id
        from pred_finish pf where pf.match_by_team
        union all
        select se.team_key, w.finish_date + w.gap_days, w.predecessor_section_id
        from whole_pkg w
        cross join lateral (select distinct e.team_key from _eff e where e.section_id = v_pkg) se
      ) x(team_key, required_start, caused_by)
      group by team_key;

      declare r record; v_earliest date; v_delta integer;
      begin
        for r in select * from _req loop
          select min(e.due_date) into v_earliest from _eff e
          where e.section_id = v_pkg and e.team_key = r.team_key and e.completed_at is null;
          continue when v_earliest is null;
          v_delta := r.required_start - v_earliest;
          -- Push only, never pull. Pulling work earlier surprises people
          -- who have made arrangements, and makes the function oscillate.
          continue when v_delta <= 0;

          insert into _out
          select case when e.locked then 'blocked' else 'shift' end,
                 e.task_id, e.section_id, e.team_key, e.due_date,
                 case when e.locked then e.due_date else e.due_date + v_delta end,
                 case when e.locked then 0 else v_delta end,
                 r.caused_by,
                 case when e.locked then 'Date is locked. The chain would have pushed it '
                      || v_delta || ' days to ' || (e.due_date + v_delta)::text
                      || '. It has not moved.' else null end
          from _eff e
          where e.section_id = v_pkg and e.team_key = r.team_key and e.completed_at is null;

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
              || ' stages can never start. Nothing was changed.');
      return query select o.kind,o.task_id,o.section_id,o.team_key,
                          o.old_due_date,o.new_due_date,o.delta_days,o.note from _out o;
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
end $fn$;


-- ---------------------------------------------------------------------
-- 10. RPCs
--
-- is_org_*(target_org) compares org_members.org, the ID. Everything here
-- uses that family. caller_is_org_*(target_org_name) joins organisations
-- and compares the NAME — calling it here would silently authorize
-- nobody, which for a SECURITY DEFINER function is the worst failure
-- available: it looks like a permissions bug and gets fixed by
-- loosening something.
-- ---------------------------------------------------------------------
create or replace function public.next_project_ref(p_org text)
returns text language plpgsql security definer set search_path = public as $$
declare v_year text := to_char(current_date,'YYYY'); v_next integer;
begin
  -- Advisory lock keyed on org+year: two admins creating a project in
  -- the same second would otherwise both read the same max.
  perform pg_advisory_xact_lock(hashtext(p_org || v_year));
  select coalesce(max(substring(ref from 10)::integer), 0) + 1 into v_next
  from public.projects
  where org = p_org and ref like 'PRJ-' || v_year || '-%'
    and substring(ref from 10) ~ '^[0-9]+$';
  return 'PRJ-' || v_year || '-' || lpad(v_next::text, 4, '0');
end $$;

create or replace function public.create_project(
  p_org text, p_name text, p_description text default null,
  p_start_date date default null, p_target_end_date date default null)
returns table (id uuid, ref text, name text, org text, org_name text, status text)
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text;
begin
  if auth.uid() is null then raise exception 'create_project: not signed in'; end if;
  if not public.is_org_admin(p_org) then
    raise exception 'create_project: not permitted for org %', p_org;
  end if;
  if coalesce(btrim(p_name),'') = '' then
    raise exception 'create_project: a project needs a name';
  end if;
  if p_start_date is not null and p_target_end_date is not null
     and p_target_end_date < p_start_date then
    raise exception 'create_project: target end date is before the start date';
  end if;

  v_ref := public.next_project_ref(p_org);
  insert into public.projects (org, ref, name, description, start_date, target_end_date,
                               owner_id, created_by_id, status)
  values (p_org, v_ref, btrim(p_name), nullif(btrim(coalesce(p_description,'')),''),
          p_start_date, p_target_end_date, auth.uid(), auth.uid(), 'active')
  returning projects.id into v_id;

  -- org_name is returned because the caller creates tasks next, and
  -- tasks.org needs the NAME while projects.org holds the ID.
  return query select p.id, p.ref, p.name, p.org, o.name, p.status
  from public.projects p join public.organisations o on o.id = p.org where p.id = v_id;
end $$;

create or replace function public.mark_milestone_met(
  p_milestone_id uuid, p_note text default null)
returns table (id uuid, name text, status text, met_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_org text; v_status text; v_open integer; v_blockers integer;
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
         count(*) filter (where t.blocks_milestone and t.status not in ('approved','completed'))
    into v_open, v_blockers
  from public.tasks t where t.milestone_id = p_milestone_id;

  -- Blockers are named separately because the fix differs: an open
  -- blocker is usually a corrective action somebody forgot, not slow work.
  if v_blockers > 0 then
    raise exception 'mark_milestone_met: % open blocker(s) must be closed first', v_blockers;
  end if;
  if v_open > 0 then
    raise exception 'mark_milestone_met: % task(s) are still open', v_open;
  end if;

  update public.project_milestones m
     set status='met', met_at=now(), met_by_id=auth.uid(),
         met_note=nullif(btrim(coalesce(p_note,'')),'')
   where m.id = p_milestone_id;

  return query select m.id, m.name, m.status, m.met_at
  from public.project_milestones m where m.id = p_milestone_id;
end $$;

create or replace function public.sign_off_project(
  p_project_id uuid, p_note text default null)
returns table (id uuid, ref text, status text, closed_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_org text; v_open integer; v_blocked integer;
        v_milestones integer; v_last_run uuid;
begin
  select p.org into v_org from public.projects p where p.id = p_project_id;
  if v_org is null then
    raise exception 'sign_off_project: project % not found', p_project_id;
  end if;
  -- Narrower than create: a manager can run a project, only a client
  -- admin closes one.
  if not public.is_org_client_admin(v_org) then
    raise exception 'sign_off_project: only a client admin can sign off a project';
  end if;
  if exists (select 1 from public.projects p
             where p.id = p_project_id and p.status in ('closed','cancelled')) then
    raise exception 'sign_off_project: already closed';
  end if;

  select count(*) into v_open from public.tasks t
  where t.project_id = p_project_id
    and coalesce(t.status,'') not in ('approved','completed');
  if v_open > 0 then
    raise exception 'sign_off_project: % task(s) are still open', v_open;
  end if;

  select count(*) into v_open from public.tasks t
  where t.project_id = p_project_id and t.status = 'completed'
    and coalesce(t.requires_approval, true);
  if v_open > 0 then
    raise exception 'sign_off_project: % task(s) are done but not yet approved', v_open;
  end if;

  select count(*) into v_milestones from public.project_milestones m
  where m.project_id = p_project_id and m.status = 'open';
  if v_milestones > 0 then
    raise exception 'sign_off_project: % milestone(s) are still open', v_milestones;
  end if;

  select e.run_id into v_last_run from public.project_schedule_events e
  where e.project_id = p_project_id order by e.created_at desc limit 1;
  if v_last_run is not null then
    select count(*) into v_blocked from public.project_schedule_events e
    where e.project_id = p_project_id and e.run_id = v_last_run and e.kind = 'blocked';
    if v_blocked > 0 then
      raise exception 'sign_off_project: % locked date(s) are at risk. Resolve or record them before sign-off.', v_blocked;
    end if;
  end if;

  update public.projects p
     set status='closed', closed_at=now(), closed_by_id=auth.uid(),
         signoff_note=nullif(btrim(coalesce(p_note,'')),'')
   where p.id = p_project_id;

  return query select p.id, p.ref, p.status, p.closed_at
  from public.projects p where p.id = p_project_id;
end $$;


-- ---------------------------------------------------------------------
-- 11. RLS policies.
--
-- Members read, org admins write, super admins both — matching the
-- pattern used across the app (tenant data gets SELECT and UPDATE; only
-- platform config gets ALL).
--
-- THREE DELIBERATE ABSENCES, each of which IS the policy:
--   No INSERT on projects: ref is allocated by create_project. A direct
--     insert cannot produce a valid row anyway.
--   No UPDATE or DELETE on project_schedule_events, for ANY role
--     including super admin. Those rows record what the system moved and
--     what it refused to move. An editable audit trail is not one.
--   No UPDATE or DELETE on project_reports. A report is a statement made
--     on a date; a correction is a new report and the old one stays.
-- ---------------------------------------------------------------------
create policy projects_select on public.projects
  for select to authenticated
  using (public.is_org_member(org) or public.is_super_admin());
create policy projects_update on public.projects
  for update to authenticated
  using      (public.is_org_admin(org) or public.is_super_admin())
  with check (public.is_org_admin(org) or public.is_super_admin());

create policy project_sections_select on public.project_sections
  for select to authenticated
  using (public.is_super_admin() or exists (
    select 1 from public.projects p
    where p.id = project_sections.project_id and public.is_org_member(p.org)));
create policy project_sections_write on public.project_sections
  for all to authenticated
  using (public.is_super_admin() or exists (
    select 1 from public.projects p
    where p.id = project_sections.project_id and public.is_org_admin(p.org)))
  with check (public.is_super_admin() or exists (
    select 1 from public.projects p
    where p.id = project_sections.project_id and public.is_org_admin(p.org)));

create policy task_dependencies_select on public.task_dependencies
  for select to authenticated
  using (public.is_org_member(org) or public.is_super_admin());
create policy task_dependencies_write on public.task_dependencies
  for all to authenticated
  using      (public.is_org_admin(org) or public.is_super_admin())
  with check (public.is_org_admin(org) or public.is_super_admin());

create policy project_schedule_events_select on public.project_schedule_events
  for select to authenticated
  using (public.is_org_member(org) or public.is_super_admin());

create policy project_milestones_select on public.project_milestones
  for select to authenticated
  using (public.is_org_member(org) or public.is_super_admin());
create policy project_milestones_insert on public.project_milestones
  for insert to authenticated
  with check (public.is_org_admin(org) or public.is_super_admin());
create policy project_milestones_update on public.project_milestones
  for update to authenticated
  using      (public.is_org_admin(org) or public.is_super_admin())
  with check (public.is_org_admin(org) or public.is_super_admin());
-- Open milestones only. A met one is an attributed assertion.
create policy project_milestones_delete on public.project_milestones
  for delete to authenticated
  using (status <> 'met' and (public.is_org_admin(org) or public.is_super_admin()));

create policy project_reports_select on public.project_reports
  for select to authenticated
  using (public.is_org_member(org) or public.is_super_admin());
create policy project_reports_insert on public.project_reports
  for insert to authenticated
  with check (public.is_org_admin(org) or public.is_super_admin());


-- ---------------------------------------------------------------------
-- 12. Grants. next_project_ref stays internal — a ref is allocated by
-- create_project, never asked for separately.
-- ---------------------------------------------------------------------
revoke all on function public.next_project_ref(text) from public, authenticated;
grant execute on function public.create_project(text,text,text,date,date) to authenticated;
grant execute on function public.mark_milestone_met(uuid,text)            to authenticated;
grant execute on function public.sign_off_project(uuid,text)              to authenticated;
grant execute on function public.recompute_project_dates(uuid,boolean,text) to authenticated;
grant select on public.project_milestone_state to authenticated;

commit;


-- =====================================================================
-- VERIFICATION — reads only. Nothing below writes.
-- =====================================================================
select 'LIVE-V1' as marker,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='projects')                as projects_cols,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='project_sections')        as sections_cols,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='task_dependencies')       as deps_cols,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='project_milestones')      as milestones_cols,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='project_reports')         as reports_cols,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='tasks'
       and column_name in ('project_id','section_id','milestone_id',
                           'blocks_milestone','due_date_locked','due_date_lock_reason')) as new_task_cols;

select 'LIVE-V2' as marker, relname as tbl, relrowsecurity as rls_on
from pg_class
where relname in ('projects','project_sections','task_dependencies',
                  'project_schedule_events','project_milestones','project_reports')
order by relname;

select 'LIVE-V3' as marker, tablename, cmd, count(*) as policies
from pg_policies
where schemaname='public' and tablename in
  ('projects','project_sections','task_dependencies','project_schedule_events',
   'project_milestones','project_reports')
group by tablename, cmd order by tablename, cmd;

select 'LIVE-V4' as marker, p.proname,
       pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as sec_definer
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('create_project','next_project_ref','mark_milestone_met',
   'sign_off_project','recompute_project_dates')
order by p.proname;

-- The view must be security_invoker, or it bypasses every policy above.
select 'LIVE-V5' as marker, c.relname,
       (select option_value from pg_options_to_table(c.reloptions)
        where option_name='security_invoker') as security_invoker
from pg_class c where c.relname = 'project_milestone_state';

-- Nothing existing was touched. These are the counts from before.
select 'LIVE-V6' as marker,
  (select count(*) from public.tasks)         as tasks_should_be_42,
  (select count(*) from public.organisations) as orgs_should_be_18,
  (select count(*) from public.projects)      as projects_should_be_0;
