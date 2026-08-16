-- ============================================================
-- !! LIVE VARIANT — yylvtvbhddcepilzwpaw (Tokyo) !!
--
-- Derived from the proven SANDBOX migration by
-- scripts/derive_live_migrations.py. Do not edit by hand:
-- re-run the script so the difference stays auditable.
--
-- Differences from the sandbox original:
--   * environment guard inverted (aborts BELOW 30 auth users)
--
-- Nothing else differs. Verify with diff against the original.
-- ============================================================
-- ============================================================
-- [SANDBOX buqlbmgxevuldahhdbxo]  Sydney
-- Bulk import — STAGE 5: organisations.date_format
--
-- Drives two things:
--   1. Which header the download template carries
--      (DD/MM/YYYY vs MM/DD/YYYY), so a pasted column from the
--      client's own software matches on arrival.
--   2. Date display across the app, which is currently
--      inconsistent (a known post-pilot item).
--
-- Deliberately NULLABLE for now. The design decision is that a
-- null must ASK rather than assume DD/MM — an org that predates
-- this column has never stated a preference, and guessing is the
-- failure this whole design exists to prevent. NOT NULL is
-- enforced later, once the UI collects it at org creation.
--
-- Backfill: United States -> MM/DD/YYYY, every other known
-- country -> DD/MM/YYYY, unknown country -> left NULL.
--
-- Idempotent. Transactional.
-- ============================================================
\pset pager off
\set ON_ERROR_STOP on

begin;

-- ---------- PRE ----------

do $$
declare n int;
begin
  select count(*) into n from auth.users;
  raise notice 'PRE P1 auth users = %', n;
  -- INVERTED for LIVE. The sandbox originals abort ABOVE 30 to
  -- protect production; this copy aborts BELOW 30 so it cannot be
  -- run against sandbox and report success that means nothing.
  if n < 30 then
    raise exception 'ABORT P1: only % auth users — this looks like SANDBOX. This is the LIVE variant.', n;
  end if;
end $$;

-- P2  Show what country values actually exist, rather than
--     assuming the backfill covers them.
do $$
declare r record;
begin
  raise notice 'PRE P2 country values present:';
  for r in
    select coalesce(nullif(btrim(country),''),'(null or blank)') as c, count(*) as n
    from public.organisations group by 1 order by 2 desc
  loop
    raise notice '        % -> % org(s)', r.c, r.n;
  end loop;
end $$;

create temporary table _pre5 on commit drop as
select count(*) as org_count from public.organisations;


-- ---------- DDL ----------

alter table public.organisations
  add column if not exists date_format text;

comment on column public.organisations.date_format is
  'How dates are written for this organisation: DD/MM/YYYY, MM/DD/YYYY, or YYYY-MM-DD. Drives the import template header and app-wide date display. Nullable for now; a null must be asked about, never assumed.';

do $$
begin
  if not exists (
    select 1 from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname='public' and rel.relname='organisations'
      and con.conname='organisations_date_format_check'
  ) then
    alter table public.organisations
      add constraint organisations_date_format_check
      check (date_format is null or date_format in ('DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD'));
    raise notice 'DDL constraint organisations_date_format_check created';
  else
    raise notice 'DDL constraint already present';
  end if;
end $$;


-- ---------- BACKFILL ----------
-- Only fills rows that are still null, so re-running never
-- overwrites a value someone has deliberately set.

with normalised as (
  select id,
         lower(btrim(coalesce(country,''))) as c
  from public.organisations
  where date_format is null
)
update public.organisations o
   set date_format = case
     when n.c in ('us','usa','u.s.','u.s.a.','united states','united states of america')
       then 'MM/DD/YYYY'
     when n.c = '' then null
     else 'DD/MM/YYYY'
   end
from normalised n
where o.id = n.id
  and n.c <> '';


-- ---------- POST ----------

do $$
declare v_total int; v_ddmm int; v_mmdd int; v_iso int; v_null int;
begin
  select count(*),
         count(*) filter (where date_format='DD/MM/YYYY'),
         count(*) filter (where date_format='MM/DD/YYYY'),
         count(*) filter (where date_format='YYYY-MM-DD'),
         count(*) filter (where date_format is null)
    into v_total, v_ddmm, v_mmdd, v_iso, v_null
  from public.organisations;

  raise notice 'POST Q1 % orgs: % DD/MM, % MM/DD, % ISO, % still null',
    v_total, v_ddmm, v_mmdd, v_iso, v_null;

  if v_null > 0 then
    raise notice 'POST Q1 the % null org(s) have no country recorded. The UI must ASK; it must not default.', v_null;
  end if;
end $$;

-- Q2  Column exists with the expected type.
do $$
declare t text;
begin
  select data_type into t from information_schema.columns
  where table_schema='public' and table_name='organisations' and column_name='date_format';
  if t is distinct from 'text' then
    raise exception 'ABORT Q2: date_format is %, expected text', coalesce(t,'MISSING');
  end if;
  raise notice 'POST Q2 organisations.date_format is text';
end $$;

-- Q3  The constraint actually refuses a bad value.
do $$
declare v_id text;
begin
  select id into v_id from public.organisations limit 1;
  begin
    update public.organisations set date_format = 'DD-MMM-YY' where id = v_id;
    raise exception 'ABORT Q3: an invalid date_format was accepted';
  exception
    when check_violation then
      raise notice 'POST Q3 invalid format refused by constraint (expected)';
  end;
end $$;

-- Q4  No organisations were added or lost.
do $$
declare before_n int; after_n int;
begin
  select org_count into before_n from _pre5;
  select count(*) into after_n from public.organisations;
  if before_n <> after_n then
    raise exception 'ABORT Q4: organisations moved % -> %', before_n, after_n;
  end if;
  raise notice 'POST Q4 organisations unchanged at %', after_n;
end $$;

commit;

select 'DONE-01 formats' as marker, id, name, country, date_format
from public.organisations order by name;
