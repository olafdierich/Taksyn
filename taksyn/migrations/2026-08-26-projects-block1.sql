-- =====================================================================
-- Taksyn — Projects module, BLOCK 1 (schema only)
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
-- Date: 26 August 2026
--
-- Creates:   projects (rebuilt), project_sections, org_areas
-- Alters:    tasks  (+project_id, +section_id, +area_id,
--                    +due_date_locked, +due_date_lock_reason)
--
-- NOT in this block: task_dependencies, extension requests,
-- the propagation function, RLS policies.  RLS is ENABLED on every new
-- table with NO policies, so the tables are deny-all to the anon and
-- authenticated roles until block 6 writes the policies deliberately.
-- psql connects as postgres, which bypasses RLS, so seeding still works.
-- This is on purpose: the 2 August parity audit found 17 sandbox tables
-- with RLS switched off, and the cost of that was every "proven on
-- sandbox" result touching them.
--
-- Safe to re-run.  Every statement is guarded.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Guard: refuse to run anywhere that looks like LIVE.
-- Kemrose exists only on LIVE.  If it is here, we are in the wrong place.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose found. This looks like LIVE. Block 1 is sandbox-only.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 1. projects — dropped and rebuilt.
--
-- The existing table is a 7-column stub with zero rows on both
-- environments, so there is nothing to migrate.  It is rebuilt rather
-- than altered because its id is text and its created_by is a display
-- NAME — the same defect as tasks.created_by, which the 28 July session
-- recorded as the blocker on the task hierarchy rule.  LIVE holds three
-- profiles named "Olaf Rusoke-Dierich", so a name can never identify a
-- person.  Fixing it now costs nothing; later it costs a migration.
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

  constraint projects_org_must_be_id
    check (org like 'ORG%'),

  constraint projects_status_check
    check (status in ('active','awaiting_signoff','closed','cancelled')),

  -- A closed project must record who closed it and when.  Sign-off is
  -- the compliance moment; an unattributed one is worthless.
  constraint projects_closed_needs_attribution
    check (
      (status not in ('closed','cancelled'))
      or (closed_at is not null and closed_by_id is not null)
    ),

  constraint projects_ref_unique_per_org unique (org, ref)
);

comment on table public.projects is
  'Compliance projects. Archive is status in (closed,cancelled) — a filter, not a separate table, same as the incident register.';
comment on column public.projects.org is
  'Organisation ID (ORG...), NOT the org name. tasks.org and profiles.org store the NAME; this side of the gremlin stores the ID, like org_members.org.';
comment on column public.projects.ref is
  'Human reference, PRJ-2026-0001. Tasks have no ref (epoch ids) and the register design hit that wall — projects get one from day one.';

create index projects_org_status_idx on public.projects (org, status);

alter table public.projects enable row level security;


-- ---------------------------------------------------------------------
-- 2. project_sections — TWO levels via parent_id.
--
--   parent_id is null  -> a SECTION   (tile on the project overview)
--   parent_id is set   -> a PACKAGE   (bar in the section cascade)
--
-- One table, one idea, capped at two levels by a trigger below.  A
-- package is what carries dependencies; tasks live inside a package.
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
  'Two levels only: parent_id null = section (overview tile), parent_id set = work package (cascade bar). Depth enforced by trigger.';

create index project_sections_project_idx on public.project_sections (project_id, parent_id, sort_order);

-- Depth cap.  A CHECK constraint cannot see another row, so this needs
-- a trigger: a section whose parent already has a parent would be a
-- third level, and the whole readability argument rests on there not
-- being one.
create or replace function public.project_sections_depth_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_id is not null then
    if exists (
      select 1 from public.project_sections p
      where p.id = new.parent_id and p.parent_id is not null
    ) then
      raise exception 'project_sections: maximum depth is two (section > package)';
    end if;
  end if;
  return new;
end $$;

create trigger project_sections_depth_biu
  before insert or update on public.project_sections
  for each row execute function public.project_sections_depth_guard();

alter table public.project_sections enable row level security;


-- ---------------------------------------------------------------------
-- 3. org_areas — org-level, two levels, normalised uniqueness.
--
-- Areas are org-level rather than per-project so that "everything that
-- happened at Ntinda" is answerable across projects, tasks and (later)
-- incidents.  organisations.industry was free text with no FK and that
-- cost a migration plus a backfill to repair; the same mistake is not
-- being repeated for locations.
--
-- name_key is generated, not application-supplied, so nothing can write
-- around it.  lower() and regexp_replace() are both immutable, which is
-- what a generated column requires.
-- ---------------------------------------------------------------------
create table public.org_areas (
  id          uuid primary key default gen_random_uuid(),
  org         text not null references public.organisations(id),
  parent_id   uuid references public.org_areas(id) on delete cascade,
  name        text not null,

  name_key    text generated always as
                (regexp_replace(lower(name), '[^a-z0-9]', '', 'g')) stored,

  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),

  constraint org_areas_org_must_be_id check (org like 'ORG%'),
  constraint org_areas_name_not_blank
    check (regexp_replace(lower(name), '[^a-z0-9]', '', 'g') <> '')
);

comment on column public.org_areas.name_key is
  'Normalised: lowercased, everything non-alphanumeric stripped. "Main Kitchen", "main kitchen" and "Main  Kitchen" all collapse to mainkitchen and collide on the unique index below. Generated, so no write path can bypass it.';

-- The hard guard.  coalesce is needed because null parent_id would
-- otherwise make every top-level row distinct from every other.
create unique index org_areas_unique_name
  on public.org_areas (
    org,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    name_key
  );

create index org_areas_org_idx on public.org_areas (org, parent_id);

-- Same two-level cap as sections, same reasoning.
create or replace function public.org_areas_depth_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_id is not null then
    if exists (
      select 1 from public.org_areas p
      where p.id = new.parent_id and p.parent_id is not null
    ) then
      raise exception 'org_areas: maximum depth is two (venue > area)';
    end if;
  end if;
  return new;
end $$;

create trigger org_areas_depth_biu
  before insert or update on public.org_areas
  for each row execute function public.org_areas_depth_guard();

alter table public.org_areas enable row level security;


-- ---------------------------------------------------------------------
-- 4. tasks — five new columns, all nullable, all additive.
--
-- Nothing existing reads them, so this cannot affect the pilot.  Adding
-- a nullable column with no default is a metadata-only change in
-- PostgreSQL 11+ and does not rewrite the table.
--
-- Deliberately NOT here: original_due_date and the extension-request
-- table.  Both need to match the type of tasks.due_date, which the
-- verification block at the end of this file reports.  Guessing the
-- type is how a date silently becomes text.
-- ---------------------------------------------------------------------
alter table public.tasks
  add column if not exists project_id           uuid references public.projects(id) on delete set null,
  add column if not exists section_id           uuid references public.project_sections(id) on delete set null,
  add column if not exists area_id              uuid references public.org_areas(id) on delete set null,
  add column if not exists due_date_locked      boolean not null default false,
  add column if not exists due_date_lock_reason text;

comment on column public.tasks.section_id is
  'The work PACKAGE (project_sections row with a parent). The scoped register filters on this.';
comment on column public.tasks.area_id is
  'Which area this task is in. One package-to-package dependency applied per matching area is what lets packages overlap — plumb-bar waits on rewire-bar, not on rewire-kitchen.';
comment on column public.tasks.due_date_locked is
  'True = this date never moves. Propagation raises an alert instead of shifting it, and no extension can be requested against it. This is the statutory-deadline case.';

create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists tasks_section_idx on public.tasks (section_id);

commit;


-- =====================================================================
-- VERIFICATION — read after commit.  Every row carries a marker.
-- =====================================================================
select 'PRJ-B1-01' as marker,
       (select count(*) from information_schema.columns
          where table_schema='public' and table_name='projects')          as projects_cols,
       (select count(*) from information_schema.columns
          where table_schema='public' and table_name='project_sections')  as sections_cols,
       (select count(*) from information_schema.columns
          where table_schema='public' and table_name='org_areas')         as areas_cols,
       (select count(*) from information_schema.columns
          where table_schema='public' and table_name='tasks'
            and column_name in ('project_id','section_id','area_id',
                                'due_date_locked','due_date_lock_reason')) as new_task_cols;

select 'PRJ-B1-02' as marker, relname as tbl, relrowsecurity as rls_on
from pg_class
where relname in ('projects','project_sections','org_areas')
order by relname;

select 'PRJ-B1-03' as marker, conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid in ('public.projects'::regclass,
                   'public.org_areas'::regclass)
  and contype = 'c'
order by conname;

-- The type block 1b needs.  Do not guess it.
select 'PRJ-B1-04' as marker, column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='tasks'
  and column_name in ('id','due_date','org')
order by column_name;
