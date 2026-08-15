-- ============================================================
-- [SANDBOX buqlbmgxevuldahhdbxo]  Sydney
-- Bulk import — STAGE 1 DDL
--   * import_batches            (audit + undo handle)
--   * org_people.import_batch_id
--   * lookup index for the duplicate guard
--   * RLS: super_admin may READ batches; writes only via a
--     SECURITY DEFINER function (added in the next step)
--
-- Clients and contractors ONLY. Staff are excluded by
-- org_people_type_check and get their own migration.
--
-- Idempotent. Transactional. Aborts on any failed assertion.
-- ============================================================
\pset pager off
\set ON_ERROR_STOP on

begin;

-- ---------- PRE ASSERTIONS ----------

-- P1  Right database. SANDBOX ~14 auth users, LIVE ~49.
do $$
declare n int;
begin
  select count(*) into n from auth.users;
  raise notice 'PRE P1 auth users = %', n;
  if n > 30 then
    raise exception 'ABORT P1: % auth users looks like LIVE, not SANDBOX', n;
  end if;
end $$;

-- P2  is_super_admin() exists and is SECURITY DEFINER.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='is_super_admin' and p.prosecdef
  ) then
    raise exception 'ABORT P2: is_super_admin() missing or not SECURITY DEFINER';
  end if;
  raise notice 'PRE P2 is_super_admin() present, DEFINER';
end $$;

-- P3  organisations.id is text — the FK target.
do $$
declare t text;
begin
  select data_type into t from information_schema.columns
  where table_schema='public' and table_name='organisations' and column_name='id';
  if t is distinct from 'text' then
    raise exception 'ABORT P3: organisations.id is %, expected text', coalesce(t,'MISSING');
  end if;
  raise notice 'PRE P3 organisations.id = text';
end $$;

-- P4  No pre-existing duplicates on the soft key.
do $$
declare n int;
begin
  select count(*) into n from (
    select 1 from public.org_people
    group by org, person_type,
             lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g'))
    having count(*) > 1
  ) d;
  raise notice 'PRE P4 existing soft-key duplicates = %', n;
end $$;

-- P5  Baseline row count, for the POST comparison.
create temporary table _pre_baseline on commit drop as
select count(*) as org_people_rows from public.org_people;


-- ---------- DDL ----------

create table if not exists public.import_batches (
  id             uuid primary key default gen_random_uuid(),
  org            text not null references public.organisations(id),
  kind           text not null default 'people'
                   check (kind in ('people','staff')),
  filename       text,
  file_sha256    text,
  rows_total     integer not null default 0,
  rows_imported  integer not null default 0,
  rows_skipped   integer not null default 0,
  status         text not null default 'committed'
                   check (status in ('committed','undone')),
  uploaded_by    uuid not null,
  uploaded_at    timestamptz not null default now(),
  undone_by      uuid,
  undone_at      timestamptz,
  notes          text
);

comment on table public.import_batches is
  'One row per committed bulk import. org_people.import_batch_id points here. Written only by the import function (SECURITY DEFINER); there is deliberately no INSERT policy.';

alter table public.org_people
  add column if not exists import_batch_id uuid references public.import_batches(id);

comment on column public.org_people.import_batch_id is
  'Set by bulk import. Null for rows created through the UI or the submissions pipe. Undo deletes by this handle.';

-- Duplicate-guard lookup. Same normalisation as
-- resolve_org_people_submission so both paths agree.
-- NOT unique: two real people may share a name.
create index if not exists org_people_org_normname_idx
  on public.org_people (
    org,
    lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g'))
  );

-- Undo path.
create index if not exists org_people_import_batch_idx
  on public.org_people (import_batch_id)
  where import_batch_id is not null;

create index if not exists import_batches_org_idx
  on public.import_batches (org, uploaded_at desc);


-- ---------- RLS ----------

alter table public.import_batches enable row level security;

drop policy if exists import_batches_select_sa on public.import_batches;
create policy import_batches_select_sa
  on public.import_batches
  for select
  to authenticated
  using (public.is_super_admin());

-- No INSERT / UPDATE / DELETE policies, by design. Every write
-- goes through the SECURITY DEFINER import function, which does
-- its own inline is_super_admin() check.

grant select on public.import_batches to authenticated;


-- ---------- POST ASSERTIONS ----------

-- Q1  Table exists with the expected column set.
do $$
declare missing text;
begin
  select string_agg(c, ', ') into missing
  from unnest(array['id','org','kind','filename','file_sha256','rows_total',
                    'rows_imported','rows_skipped','status','uploaded_by',
                    'uploaded_at','undone_by','undone_at','notes']) c
  where not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='import_batches' and column_name=c
  );
  if missing is not null then
    raise exception 'ABORT Q1: import_batches missing columns: %', missing;
  end if;
  raise notice 'POST Q1 import_batches column set complete';
end $$;

-- Q2  org_people gained the column, and nothing else changed.
do $$
declare n int;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='org_people'
      and column_name='import_batch_id'
  ) then
    raise exception 'ABORT Q2: org_people.import_batch_id not created';
  end if;
  select count(*) into n from information_schema.columns
  where table_schema='public' and table_name='org_people';
  if n <> 14 then
    raise exception 'ABORT Q2: org_people has % columns, expected 14 (13 + import_batch_id)', n;
  end if;
  raise notice 'POST Q2 org_people = 14 columns';
end $$;

-- Q3  RLS on, exactly one policy, and it is SELECT-only.
do $$
declare n_sel int; n_other int; rls boolean;
begin
  select relrowsecurity into rls from pg_class
  where oid = 'public.import_batches'::regclass;
  if not rls then
    raise exception 'ABORT Q3: RLS not enabled on import_batches';
  end if;
  select count(*) filter (where cmd='SELECT'),
         count(*) filter (where cmd<>'SELECT')
    into n_sel, n_other
  from pg_policies where schemaname='public' and tablename='import_batches';
  if n_sel <> 1 or n_other <> 0 then
    raise exception 'ABORT Q3: expected 1 SELECT policy and 0 others, got % / %', n_sel, n_other;
  end if;
  raise notice 'POST Q3 RLS on, 1 SELECT policy, no write policies';
end $$;

-- Q4  Indexes present.
do $$
declare missing text;
begin
  select string_agg(i, ', ') into missing
  from unnest(array['org_people_org_normname_idx','org_people_import_batch_idx']) i
  where not exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='org_people' and indexname=i
  );
  if missing is not null then
    raise exception 'ABORT Q4: missing indexes: %', missing;
  end if;
  raise notice 'POST Q4 indexes present';
end $$;

-- Q5  No data was touched.
do $$
declare before_n int; after_n int;
begin
  select org_people_rows into before_n from _pre_baseline;
  select count(*) into after_n from public.org_people;
  if before_n <> after_n then
    raise exception 'ABORT Q5: org_people row count moved % -> %', before_n, after_n;
  end if;
  raise notice 'POST Q5 org_people unchanged at % rows', after_n;
end $$;

-- Q6  The type check still refuses staff. If this ever passes,
--     someone widened the constraint and the staff design changed.
do $$
begin
  begin
    insert into public.org_people (org, person_type, full_name, created_by)
    values ('__probe__', 'staff', '__probe__', gen_random_uuid());
    raise exception 'ABORT Q6: a staff row was accepted — constraint has changed';
  exception
    when check_violation then
      raise notice 'POST Q6 staff still refused by org_people_type_check (expected)';
    when foreign_key_violation then
      raise notice 'POST Q6 blocked by FK before the check — inconclusive, verify manually';
  end;
end $$;

commit;

-- ---------- VISUAL CONFIRMATION ----------
select 'DONE-01 batches' as marker, count(*) as batch_rows from public.import_batches;
select 'DONE-02 org_people' as marker, count(*) as rows,
       count(*) filter (where import_batch_id is not null) as imported_rows
from public.org_people;
select 'DONE-03 policy' as marker, policyname, cmd
from pg_policies where schemaname='public' and tablename='import_batches';
