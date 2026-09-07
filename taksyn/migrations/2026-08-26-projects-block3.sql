-- =====================================================================
-- Taksyn — Projects module, BLOCK 3: date propagation
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
-- Date: 26 August 2026
-- Requires: blocks 1 and 2 applied.
--
-- Creates:  project_schedule_events   (the record of what moved and why)
--           recompute_project_dates() (the RPC)
--
-- WHY AN RPC AND NOT A TRIGGER
-- A trigger on tasks could not be bypassed, but it would fire inside
-- every write App.jsx already makes, including the recurrence and
-- miss-writer paths.  Those have a measured history of write storms
-- (~7 upserts per page load, growing unbounded).  A chain walk inside
-- them is not a risk worth taking.  This runs only when called.
--
-- Nothing calls it yet.  That is intended.
-- =====================================================================

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
-- project_schedule_events
--
-- Every date this function moves, and every date it REFUSED to move,
-- lands here.  A plan that silently reschedules itself is not evidence,
-- and "the system moved it" is not an answer an inspector accepts.
--
-- A dedicated table rather than audit_log: this needs run_id grouping
-- so one recompute reads as one event, and inventing columns in a
-- shared table to get that would be worse than a small dedicated one.
-- ---------------------------------------------------------------------
create table if not exists public.project_schedule_events (
  id            uuid primary key default gen_random_uuid(),
  org           text not null,
  project_id    uuid not null references public.projects(id) on delete cascade,
  run_id        uuid not null,

  kind          text not null,

  task_id       text,
  section_id    uuid,
  area_id       uuid,

  old_due_date  date,
  new_due_date  date,
  delta_days    integer,

  caused_by_section_id uuid,
  note          text,

  created_at    timestamptz not null default now(),

  constraint pse_kind_check
    check (kind in ('shift','blocked','cycle','noop'))
);

comment on table public.project_schedule_events is
  'What propagation moved and what it refused to move. kind=blocked is a locked date the chain would have pushed — that row IS the alert.';

create index if not exists pse_project_run_idx
  on public.project_schedule_events (project_id, run_id, created_at);
create index if not exists pse_blocked_idx
  on public.project_schedule_events (project_id, kind, created_at desc);

alter table public.project_schedule_events enable row level security;


-- ---------------------------------------------------------------------
-- recompute_project_dates(project, dry_run, timezone)
--
-- RECOMPUTES, it does not patch.  "Push it back two weeks" applied
-- twice by two code paths gives four weeks, and that bug is invisible
-- afterwards.  Here every run derives dates from scratch, so running it
-- five times in a row gives the same answer as running it once.
--
-- WHEN IS A PACKAGE FINISHED
--   completed_at set        -> that date (the real one)
--   due date already passed -> TODAY, and it keeps moving each day it
--                              slips, so successors track the delay as
--                              it happens rather than only once the
--                              late work finally lands
--   otherwise               -> its due date
--
-- Completion is tested on completed_at being set, not on a status
-- string, because the status vocabulary is not something to guess at.
--
-- PUSH ONLY, NEVER PULL.  If a predecessor finishes early the successor
-- does NOT jump forward.  Automatically pulling work earlier surprises
-- people who have already made arrangements, and it makes the function
-- oscillate.  Slack is allowed to exist.
--
-- AREAS.  A dependency with match_by_area applies per area: plumb-bar
-- waits on rewire-bar and not on rewire-kitchen.  An area present in
-- the successor but absent from the predecessor gets no constraint from
-- that link — a missing predecessor is not a reason to hold work.
--
-- MULTIPLE PREDECESSORS are handled: a package waits for the LATEST of
-- them.  The schema always allowed several and the max() is the same
-- code as one, so there was no reason to restrict it.
--
-- LOCKED DATES never move.  The chain pushing against one writes a
-- 'blocked' row instead.  That is the whole point of the lock.
-- ---------------------------------------------------------------------
create or replace function public.recompute_project_dates(
  p_project_id uuid,
  p_dry_run    boolean default true,
  p_tz         text    default 'UTC'
)
returns table (
  kind         text,
  task_id      text,
  section_id   uuid,
  area_id      uuid,
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
  v_org       text;
  v_run       uuid := gen_random_uuid();
  v_progress  boolean;
  v_pending   integer;
  v_pkg       uuid;
  v_today     date := (now() at time zone p_tz)::date;
begin
  select p.org into v_org from public.projects p where p.id = p_project_id;
  if v_org is null then
    raise exception 'recompute_project_dates: project % not found', p_project_id;
  end if;

  -- Working copy of every due date in the project.  Shifts are applied
  -- here first so that a successor reads its predecessor's NEW date
  -- within the same run.  Nothing touches public.tasks until the end,
  -- and in dry run nothing touches it at all.
  drop table if exists _eff;
  create temp table _eff on commit drop as
    select t.id            as task_id,
           t.section_id    as section_id,
           t.area_id       as area_id,
           t.due_date      as due_date,
           t.completed_at  as completed_at,
           coalesce(t.due_date_locked,false) as locked,
           t.due_date      as orig_due_date
    from public.tasks t
    where t.project_id = p_project_id
      and t.section_id is not null;

  create index on _eff (section_id);

  drop table if exists _pkg;
  create temp table _pkg on commit drop as
    select s.id as section_id, false as processed
    from public.project_sections s
    where s.project_id = p_project_id
      and s.parent_id is not null;

  drop table if exists _out;
  create temp table _out (
    kind text, task_id text, section_id uuid, area_id uuid,
    old_due_date date, new_due_date date, delta_days integer,
    caused_by uuid, note text
  ) on commit drop;

  -- Topological walk.  A package is ready when every package it depends
  -- on has been processed, so a predecessor's shift is always visible
  -- before its successor is computed.
  loop
    select count(*) into v_pending from _pkg where not processed;
    exit when v_pending = 0;

    v_progress := false;

    for v_pkg in
      select k.section_id
      from _pkg k
      where not k.processed
        and not exists (
          select 1
          from public.task_dependencies d
          join _pkg pk on pk.section_id = d.predecessor_section_id
          where d.successor_section_id = k.section_id
            and not pk.processed
        )
    loop
      -- Earliest required start per area for this package, taking the
      -- latest requirement across all incoming links.
      drop table if exists _req;
      create temp table _req on commit drop as
      with pred_finish as (
        -- When each predecessor package finishes, per area.
        select d.successor_section_id,
               d.gap_days,
               d.match_by_area,
               d.predecessor_section_id,
               coalesce(e.area_id,'00000000-0000-0000-0000-000000000000'::uuid) as area_key,
               max(
                 case
                   when e.completed_at is not null
                     then (e.completed_at at time zone p_tz)::date
                   when e.due_date < v_today then v_today
                   else e.due_date
                 end
               ) as finish_date
        from public.task_dependencies d
        join _eff e on e.section_id = d.predecessor_section_id
        where d.successor_section_id = v_pkg
        group by d.successor_section_id, d.gap_days, d.match_by_area,
                 d.predecessor_section_id,
                 coalesce(e.area_id,'00000000-0000-0000-0000-000000000000'::uuid)
      ),
      whole_pkg as (
        -- For links that do NOT match by area, the whole predecessor
        -- package must finish before any of the successor starts.
        select pf.predecessor_section_id, pf.gap_days,
               max(pf.finish_date) as finish_date
        from pred_finish pf
        where not pf.match_by_area
        group by pf.predecessor_section_id, pf.gap_days
      )
      select area_key, max(required_start) as required_start,
             (array_agg(caused_by order by required_start desc))[1] as caused_by
      from (
        -- area-matched links
        select pf.area_key,
               pf.finish_date + pf.gap_days as required_start,
               pf.predecessor_section_id     as caused_by
        from pred_finish pf
        where pf.match_by_area

        union all

        -- whole-package links apply to every area in the successor
        select coalesce(se.area_id,'00000000-0000-0000-0000-000000000000'::uuid) as area_key,
               w.finish_date + w.gap_days as required_start,
               w.predecessor_section_id   as caused_by
        from whole_pkg w
        cross join lateral (
          select distinct e.area_id from _eff e where e.section_id = v_pkg
        ) se
      ) x
      group by area_key;

      -- Apply, one area at a time.
      declare
        r record;
        v_earliest date;
        v_delta    integer;
      begin
        for r in select * from _req loop
          -- The package-area's start proxy: the earliest due date among
          -- its not-yet-completed tasks.  Completed work is not moved —
          -- it already happened.
          select min(e.due_date) into v_earliest
          from _eff e
          where e.section_id = v_pkg
            and coalesce(e.area_id,'00000000-0000-0000-0000-000000000000'::uuid) = r.area_key
            and e.completed_at is null;

          continue when v_earliest is null;

          v_delta := r.required_start - v_earliest;

          -- Push only.  Never pull.
          continue when v_delta <= 0;

          insert into _out
          select case when e.locked then 'blocked' else 'shift' end,
                 e.task_id, e.section_id, e.area_id,
                 e.due_date,
                 case when e.locked then e.due_date else e.due_date + v_delta end,
                 case when e.locked then 0 else v_delta end,
                 r.caused_by,
                 case when e.locked
                      then 'Date is locked. The chain would have pushed it '
                           || v_delta || ' days to '
                           || (e.due_date + v_delta)::text || '. It has not moved.'
                      else null end
          from _eff e
          where e.section_id = v_pkg
            and coalesce(e.area_id,'00000000-0000-0000-0000-000000000000'::uuid) = r.area_key
            and e.completed_at is null;

          -- Unlocked tasks move in the working copy so that this
          -- package's successors see the new dates.
          update _eff e
             set due_date = e.due_date + v_delta
           where e.section_id = v_pkg
             and coalesce(e.area_id,'00000000-0000-0000-0000-000000000000'::uuid) = r.area_key
             and e.completed_at is null
             and not e.locked;
        end loop;
      end;

      update _pkg set processed = true where _pkg.section_id = v_pkg;
      v_progress := true;
    end loop;

    -- No package became ready and some remain: the links form a loop.
    -- A CHECK constraint cannot see this; only a walk can.
    if not v_progress then
      insert into _out (kind, note)
      values ('cycle', 'Dependency loop: '
              || (select count(*) from _pkg where not processed)
              || ' packages can never start. Nothing was changed.');

      return query select o.kind, o.task_id, o.section_id, o.area_id,
                          o.old_due_date, o.new_due_date, o.delta_days, o.note
                   from _out o;
      return;
    end if;
  end loop;

  -- Nothing moved.
  if not exists (select 1 from _out) then
    insert into _out (kind, note) values ('noop','No dates needed to move.');
  end if;

  -- Commit phase.  Skipped entirely on a dry run, which is the default:
  -- you should be able to ask what WOULD happen without it happening.
  if not p_dry_run then
    update public.tasks t
       set due_date = o.new_due_date
      from _out o
     where t.id = o.task_id
       and o.kind = 'shift';

    insert into public.project_schedule_events
      (org, project_id, run_id, kind, task_id, section_id, area_id,
       old_due_date, new_due_date, delta_days, caused_by_section_id, note)
    select v_org, p_project_id, v_run, o.kind, o.task_id, o.section_id,
           o.area_id, o.old_due_date, o.new_due_date, o.delta_days,
           o.caused_by, o.note
    from _out o;
  end if;

  return query select o.kind, o.task_id, o.section_id, o.area_id,
                      o.old_due_date, o.new_due_date, o.delta_days, o.note
               from _out o
               order by o.kind, o.new_due_date;
end
$fn$;

comment on function public.recompute_project_dates(uuid, boolean, text) is
  'Recomputes every due date in a project from its dependency chain. Idempotent. Dry run by default. Push only, never pull. Locked dates produce a blocked row instead of moving.';

revoke all on function public.recompute_project_dates(uuid, boolean, text) from public;

commit;


-- =====================================================================
-- VERIFICATION
-- =====================================================================
select 'PRJ-B3-01' as marker,
       (select count(*) from pg_proc
          where proname = 'recompute_project_dates')              as fn_exists,
       (select count(*) from information_schema.columns
          where table_schema='public'
            and table_name='project_schedule_events')             as pse_cols,
       (select relrowsecurity from pg_class
          where relname='project_schedule_events')                as pse_rls;

-- The recurrence column name, needed before block 4 seeds anything.
-- Recurring tasks must never join a dependency chain: they have no
-- finish. Better to see the real column name than assume one.
select 'PRJ-B3-02' as marker, column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='tasks'
  and (column_name ilike '%recur%' or column_name ilike '%frequen%'
       or column_name ilike '%schedule%' or column_name ilike '%repeat%')
order by column_name;
