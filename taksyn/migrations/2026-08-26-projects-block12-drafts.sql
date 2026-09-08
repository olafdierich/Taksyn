-- =====================================================================
-- Taksyn — Projects module, BLOCK 12: report drafts
-- RUN ON BOTH: sandbox buqlbmgxevuldahhdbxo AND live yylvtvbhddcepilzwpaw
--
-- Unlike every other file in this module, this one carries no
-- environment guard. It is purely additive — one new table, nothing
-- existing touched — and it is needed in both places. A guard here
-- would only mean running two files that differ by a comment.
--
-- WHY A SEPARATE TABLE RATHER THAN A DRAFT FLAG ON project_reports
-- project_reports has no UPDATE and no DELETE policy on purpose: a
-- filed report is a statement made on a date, and a correction is a new
-- report while the old one stays. Adding a draft status to that table
-- would mean allowing UPDATE, and then the immutability rests on a
-- status column that a bug could change. Keeping drafts separate means
-- the filed record stays untouchable by construction.
--
-- A draft is the opposite: fully mutable, deletable, and private to its
-- author. One per person per project, so two admins can each work on
-- their own assessment without overwriting each other.
-- =====================================================================

\set ON_ERROR_STOP on
set client_min_messages = warning;

begin;

do $$
begin
  if to_regclass('public.project_reports') is null then
    raise exception 'ABORT: project_reports does not exist. Apply the projects schema first.';
  end if;
end $$;

create table if not exists public.project_report_drafts (
  id           uuid primary key default gen_random_uuid(),
  org          text not null references public.organisations(id),
  project_id   uuid not null references public.projects(id) on delete cascade,
  author_id    uuid not null references auth.users(id) on delete cascade,

  -- The period the draft was being written for, so reopening it does
  -- not silently change what the assessment refers to.
  period_from  date,
  period_to    date,
  period_label text,

  conclusion   text,
  strengths    text,
  weaknesses   text,
  next_steps   text,

  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),

  constraint prd_org_must_be_id check (org like 'ORG%'),
  -- One draft per person per project. Two admins can each work on their
  -- own without overwriting each other, and returning to a project finds
  -- your own words rather than someone else's.
  constraint prd_one_per_author unique (project_id, author_id)
);

comment on table public.project_report_drafts is
  'Work in progress on a report conclusion. Fully mutable and private to its author — the opposite of project_reports, which is immutable once filed.';

create index if not exists prd_project_author_idx
  on public.project_report_drafts (project_id, author_id);

alter table public.project_report_drafts enable row level security;

-- Your own drafts only, in both directions. A half-written assessment
-- of someone's work is not something a colleague should be reading over
-- your shoulder, and it is not a record of anything until it is filed.
drop policy if exists prd_own_select on public.project_report_drafts;
create policy prd_own_select on public.project_report_drafts
  for select to authenticated using (author_id = auth.uid());

drop policy if exists prd_own_insert on public.project_report_drafts;
create policy prd_own_insert on public.project_report_drafts
  for insert to authenticated
  with check (author_id = auth.uid() and public.is_org_admin(org));

drop policy if exists prd_own_update on public.project_report_drafts;
create policy prd_own_update on public.project_report_drafts
  for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists prd_own_delete on public.project_report_drafts;
create policy prd_own_delete on public.project_report_drafts
  for delete to authenticated using (author_id = auth.uid());

commit;


-- =====================================================================
-- VERIFICATION
-- =====================================================================
select 'B12-01' as marker,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='project_report_drafts') as cols,
  (select relrowsecurity from pg_class where relname='project_report_drafts') as rls_on,
  (select count(*) from pg_policies
     where schemaname='public' and tablename='project_report_drafts')      as policies;

-- A draft belongs to one person. Nobody else can read it, including an
-- admin of the same org.
select 'B12-02' as marker, policyname, cmd,
       (qual like '%auth.uid()%' or with_check like '%auth.uid()%') as scoped_to_author
from pg_policies where schemaname='public' and tablename='project_report_drafts'
order by cmd;
