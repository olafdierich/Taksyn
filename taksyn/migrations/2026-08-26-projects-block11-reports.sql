-- =====================================================================
-- Taksyn — Projects module, BLOCK 11: the report record
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
-- Date: 26 August 2026
-- Requires: blocks 1-10 applied.
--
-- WHY A TABLE AND NOT JUST A PRINTOUT
-- Most of a project report is derivable — what was done, what slipped,
-- which gates were met. That part can be regenerated any time and does
-- not need storing.
--
-- Two things cannot be regenerated:
--
--   1. The WRITTEN CONCLUSION. Strengths, weaknesses and how to
--      structure what comes next are judgements, not queries. Typed into
--      a page and printed, they are gone. Stored, they are a record with
--      an author on them.
--
--   2. WHAT WAS REPORTED AT THE TIME. "What did we tell the board in
--      September" is the question that actually gets asked, and a report
--      regenerated in November over the same period will not match — the
--      data has moved. The counts are therefore snapshotted alongside
--      the conclusion.
--
-- The snapshot is deliberately shallow: totals, not a copy of every
-- task. Enough to say what the document claimed, not a second copy of
-- the project that could drift from the first.
-- =====================================================================

\set ON_ERROR_STOP on
set client_min_messages = warning;

begin;

do $$
begin
  if exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose found. This looks like LIVE. Sandbox-only.';
  end if;
  if to_regclass('public.project_milestones') is null then
    raise exception 'ABORT: block 8 has not been applied.';
  end if;
end $$;


create table if not exists public.project_reports (
  id              uuid primary key default gen_random_uuid(),
  org             text not null references public.organisations(id),
  project_id      uuid not null references public.projects(id) on delete cascade,

  -- The window the report covers. Null start means from the beginning of
  -- the project — the common case for a closing report.
  period_from     date,
  period_to       date not null,
  period_label    text not null,

  -- The judgement. Written by a person, never generated.
  conclusion      text,
  strengths       text,
  weaknesses      text,
  next_steps      text,

  -- What the document claimed, at the time it was produced. Totals only.
  snapshot        jsonb not null default '{}'::jsonb,

  created_by_id   uuid not null references auth.users(id),
  created_by_name text,
  created_at      timestamptz not null default now(),

  constraint pr_org_must_be_id check (org like 'ORG%'),
  constraint pr_period_sane
    check (period_from is null or period_to >= period_from)
);

comment on table public.project_reports is
  'One row per report produced. Holds the written judgement, which cannot be regenerated, and a shallow snapshot of what the document claimed — a report rerun months later will not match, because the data has moved.';
comment on column public.project_reports.snapshot is
  'Totals only: task counts, milestone states, slippage days. Not a copy of the tasks — a second copy would drift from the first.';

create index if not exists pr_project_idx
  on public.project_reports (project_id, created_at desc);

alter table public.project_reports enable row level security;

-- Members read; admins write. No UPDATE and no DELETE, deliberately: a
-- report is a statement made on a date. Editing one after the fact, or
-- removing it, is exactly what an audit trail exists to prevent. A
-- correction is a new report that supersedes the old one, and the old
-- one stays.
drop policy if exists project_reports_select on public.project_reports;
create policy project_reports_select on public.project_reports
  for select to authenticated
  using (public.is_org_member(org) or public.is_super_admin());

drop policy if exists project_reports_insert on public.project_reports;
create policy project_reports_insert on public.project_reports
  for insert to authenticated
  with check (public.is_org_admin(org) or public.is_super_admin());

commit;


-- =====================================================================
-- PROOF
-- =====================================================================
set client_min_messages = notice;

begin;
select set_config('request.jwt.claims', json_build_object('sub',
  (select m.user_id::text from public.org_members m
   where m.org='ORG1990000000001' and m.role='client_admin'
     and m.user_id is not null and m.is_active is not false limit 1))::text, true);
set local role authenticated;

do $p1$
declare v_id uuid; v_n integer;
begin
  insert into public.project_reports
    (org, project_id, period_to, period_label, conclusion,
     snapshot, created_by_id, created_by_name)
  select 'ORG1990000000001', p.id, current_date, 'Block 11 test',
         'Test conclusion.',
         jsonb_build_object('tasks_total', 17, 'tasks_done', 8),
         auth.uid(), 'Margaret Whitfield'
  from public.projects p where p.ref='PRJ-SAMPLE-0001'
  returning id into v_id;

  if v_id is null then raise exception 'PRJ-B11-1 FAIL: no row'; end if;
  raise notice 'PRJ-B11-1 PASS: client_admin wrote a report';

  -- A report cannot be edited or removed after the fact.
  update public.project_reports set conclusion = 'tampered' where id = v_id;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'PRJ-B11-2 FAIL: report was editable'; end if;

  delete from public.project_reports where id = v_id;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'PRJ-B11-3 FAIL: report was deletable'; end if;

  raise notice 'PRJ-B11-2/3 PASS: reports are immutable once written';
end $p1$;

reset role;
rollback;

begin;
select set_config('request.jwt.claims', json_build_object('sub',
  (select m.user_id::text from public.org_members m
   where m.org='ORG1990000000001' and m.role='worker'
     and m.user_id is not null and m.is_active is not false limit 1))::text, true);
set local role authenticated;

do $p2$
begin
  begin
    insert into public.project_reports
      (org, project_id, period_to, period_label, created_by_id)
    select 'ORG1990000000001', p.id, current_date, 'worker should not', auth.uid()
    from public.projects p where p.ref='PRJ-SAMPLE-0001';
    raise exception 'PRJ-B11-4 FAIL: worker wrote a report';
  exception when insufficient_privilege then
    raise notice 'PRJ-B11-4 PASS: worker refused by RLS';
  end;
end $p2$;

reset role;
rollback;

select 'PRJ-B11-POL' as marker, policyname, cmd
from pg_policies where schemaname='public' and tablename='project_reports'
order by cmd;
