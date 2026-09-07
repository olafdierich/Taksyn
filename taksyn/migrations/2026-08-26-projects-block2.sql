-- =====================================================================
-- Taksyn — Projects module, BLOCK 2
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
-- Date: 26 August 2026
-- Requires: 2026-08-26-projects-block1.sql applied.
--
-- Supersedes 2026-08-26-projects-block1b-2.sql, which was ROLLED BACK
-- and must not be run.  That file tried to create
-- task_extension_requests, which already exists and is already wired
-- into App.jsx at six call sites.  Extension requests are DONE; the
-- only surviving gap (occurrence_id for recurring tasks) belongs to the
-- recurrence work, not here.  original_due_date was also dropped:
-- tasks.extended_from already holds that fact.
--
-- This file adds one table: task_dependencies.
--
-- No behaviour.  Propagation is block 3.  RLS enabled, no policies.
-- Safe to re-run.
-- =====================================================================

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
-- task_dependencies
--
-- The link is between PACKAGES (project_sections rows that have a
-- parent), not between tasks.  "Plumbing follows rewire" is drawn once.
--
-- It is then applied PER MATCHING AREA.  Plumb-bar waits on rewire-bar;
-- plumb-kitchen waits on rewire-kitchen; they do not wait on each
-- other.  That single rule is what lets packages overlap the way real
-- work does, and it is why one drawn link becomes many real constraints
-- without anyone having to draw a graph.
--
-- If neither side uses areas it degrades to whole-package-to-whole-
-- package, so simple projects stay simple.
--
-- MULTIPLE PREDECESSORS: permitted by the schema from day one — there
-- is deliberately no unique constraint on successor_section_id.  Block
-- 3 will implement the single-predecessor walk only.  When multiple is
-- wanted the rule is "start after the LATEST predecessor" and no
-- migration is needed.
-- ---------------------------------------------------------------------
create table if not exists public.task_dependencies (
  id                      uuid primary key default gen_random_uuid(),
  org                     text not null references public.organisations(id),
  project_id              uuid not null references public.projects(id) on delete cascade,

  predecessor_section_id  uuid not null references public.project_sections(id) on delete cascade,
  successor_section_id    uuid not null references public.project_sections(id) on delete cascade,

  -- Days between the predecessor finishing and the successor starting.
  -- 0 = straight after.  Negative is allowed on purpose: second fix
  -- starting while first fix snags is normal on site, and without it
  -- people fake dates to make the plan match reality, which is how a
  -- plan stops being evidence.
  gap_days                integer not null default 0,

  -- true  = match on area (the grid case)
  -- false = whole package waits on whole package
  match_by_area           boolean not null default true,

  created_by_id           uuid references auth.users(id),
  created_at              timestamptz not null default now(),

  constraint task_dep_org_must_be_id check (org like 'ORG%'),

  -- A package cannot follow itself.  Longer cycles (A->B->C->A) are
  -- caught in block 3, where the walk can see the whole chain; a CHECK
  -- cannot see another row.
  constraint task_dep_no_self_reference
    check (predecessor_section_id <> successor_section_id),

  constraint task_dep_gap_sane
    check (gap_days between -90 and 365)
);

comment on table public.task_dependencies is
  'Package-to-package finish-to-start links, applied per matching area when match_by_area. One drawn link becomes many real constraints. Multiple predecessors permitted by the schema; block 3 walks single only.';
comment on column public.task_dependencies.match_by_area is
  'true = plumb-bar waits on rewire-bar only. false = whole package waits on whole package, for work with no area breakdown.';
comment on column public.task_dependencies.gap_days is
  'Negative permitted for deliberate overlap. Not a scheduling trick — it is how trades interleave on site.';

-- The same pair drawn twice is a duplicate, not a second constraint.
create unique index if not exists task_dep_unique_pair
  on public.task_dependencies (predecessor_section_id, successor_section_id);

create index if not exists task_dep_predecessor_idx
  on public.task_dependencies (predecessor_section_id);
create index if not exists task_dep_project_idx
  on public.task_dependencies (project_id);

alter table public.task_dependencies enable row level security;

commit;


-- =====================================================================
-- VERIFICATION
-- =====================================================================
select 'PRJ-B2-01' as marker,
       (select count(*) from information_schema.columns
          where table_schema='public' and table_name='task_dependencies') as dep_cols,
       (select relrowsecurity from pg_class where relname='task_dependencies') as rls_on,
       (select count(*) from pg_indexes
          where schemaname='public' and indexname='task_dep_unique_pair')  as unique_pair_idx;

select 'PRJ-B2-02' as marker, conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.task_dependencies'::regclass and contype = 'c'
order by conname;

-- What already exists on the extension side, for the record.  This
-- block adds nothing here; it is confirming the shape block 3 must
-- respect.  ter_one_open_per_task is an INDEX, not a constraint, which
-- is why an earlier constraint query did not show it.
select 'PRJ-B2-03' as marker, indexname, indexdef
from pg_indexes
where schemaname='public' and tablename='task_extension_requests'
order by indexname;

-- Does tasks already carry the extension stamps?  If these exist,
-- original_due_date was correctly dropped and block 3 reads these.
select 'PRJ-B2-04' as marker, column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='tasks'
  and column_name in ('extended_from','extended_at','extended_by',
                      'completed_at','status')
order by column_name;
