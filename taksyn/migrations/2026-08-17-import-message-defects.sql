-- ============================================================
-- [CODESPACE] -> [SANDBOX buqlbmgxevuldahhdbxo]  Sydney
-- import_people_batch: two message defects found in the browser
--
-- DEFECT 1 — the wrong reason wins
-- A row whose external_ref already exists AND which is also a
-- duplicate within the file reports the in-file reason and is
-- offered an override tick box. Ticking it changes nothing: the
-- server still refuses on the reference. The UI offers something
-- it cannot deliver, and names the wrong cause.
--
-- The in-file check runs first and claims the verdict. Rather
-- than reorder two blocks — fragile against whitespace when
-- patching a stored definition — the reference check is widened
-- to override an existing 'skipped' verdict. An 'error' verdict
-- is left alone: a broken value outranks a duplicate.
--
-- DEFECT 2 — the date message contradicts the template
-- It says "use YYYY-MM-DD" while the organisation is set to
-- DD/MM/YYYY and the template header says exactly that. The
-- function cannot know the organisation's format, so it should
-- stop prescribing one and point at the template instead.
--
-- METHOD: the body is read from the catalogue, two blocks are
-- replaced, and the result is executed. The 250 lines around
-- them are never retyped, so they cannot be mistyped.
-- ============================================================
\pset pager off
\set ON_ERROR_STOP on

begin;

-- ---------- PRE ----------

do $mig$
declare n int;
begin
  select count(*) into n from auth.users;
  raise notice 'PRE P1 auth users = %', n;
  if n > 30 then
    raise exception 'ABORT P1: % auth users looks like LIVE, not SANDBOX', n;
  end if;
end $mig$;

do $mig$
declare v_hash text;
begin
  select md5(pg_get_functiondef(p.oid)) into v_hash
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='import_people_batch';
  if v_hash is null then
    raise exception 'ABORT P2: import_people_batch not found';
  end if;
  raise notice 'PRE P2 current import_people_batch md5 = %', v_hash;
end $mig$;


-- ---------- PATCH ----------

do $mig$
declare
  v_def  text;
  v_new  text;
  v_old1 text;
  v_rep1 text;
  v_old2 text;
  v_rep2 text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='import_people_batch';

  -- ---- defect 1: let the reference reason win ----
  v_old1 := $old1$    if v_verdict is null and v_ref is not null then$old1$;
  v_rep1 := $rep1$    -- A reference collision outranks an in-file duplicate: it is
    -- the non-overridable one, so it must be the reason shown. An
    -- 'error' verdict still wins over both.
    if v_ref is not null and (v_verdict is null or v_verdict = 'skipped') then$rep1$;

  -- Plain substring count: exact, and obvious to read. An escaped
  -- regex here would be one more thing to get subtly wrong.
  if (length(v_def) - length(replace(v_def, v_old1, ''))) / length(v_old1) <> 1 then
    raise exception 'ABORT: the reference-check guard was not found exactly once. Do not proceed blind.';
  end if;

  -- ---- defect 2: stop prescribing a format the org does not use ----
  v_old2 := $old2$is not a valid date (use YYYY-MM-DD)$old2$;
  v_rep2 := $rep2$could not be read as a date. Check it matches the format in the template header$rep2$;

  if position(v_old2 in v_def) = 0 then
    raise exception 'ABORT: the date message was not found.';
  end if;

  v_new := replace(v_def, v_old1, v_rep1);
  v_new := replace(v_new, v_old2, v_rep2);

  if v_new = v_def then
    raise exception 'ABORT: replacement produced no change';
  end if;

  execute v_new;
  raise notice 'PATCH applied: reference reason now outranks in-file duplicate; date message no longer prescribes a format';
end $mig$;


-- ---------- POST ----------

do $mig$
declare v_def text; v_hash text;
begin
  select pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid))
    into v_def, v_hash
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='import_people_batch';

  if v_def like '%is not a valid date (use YYYY-MM-DD)%' then
    raise exception 'ABORT Q1: the old date message survives';
  end if;
  if v_def not like '%template header%' then
    raise exception 'ABORT Q1: the new date message is absent';
  end if;
  if v_def not like '%A reference collision outranks an in-file duplicate%' then
    raise exception 'ABORT Q1: the reference precedence comment is absent';
  end if;
  raise notice 'POST Q1 both changes present, new md5 = %', v_hash;
end $mig$;

-- Q2  The guards that matter must be untouched.
do $mig$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='import_people_batch';

  if v_def not like '%reference collisions cannot be overridden%' then
    raise exception 'ABORT Q2: the non-overridable reference message is gone';
  end if;
  if v_def not like '%no authenticated user%' then
    raise exception 'ABORT Q2: the null-uid guard is gone';
  end if;
  if v_def not like '%can_bulk_import%' then
    raise exception 'ABORT Q2: the authorisation check is gone';
  end if;
  if v_def not like '%refusing to import%' then
    raise exception 'ABORT Q2: the whole-file gate is gone';
  end if;
  raise notice 'POST Q2 null-uid guard, authorisation and whole-file gate intact';
end $mig$;

-- Q3  Still SECURITY DEFINER with a pinned search_path.
do $mig$
declare v_sec boolean; v_cfg text[];
begin
  select p.prosecdef, p.proconfig into v_sec, v_cfg
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='import_people_batch';
  if not v_sec then
    raise exception 'ABORT Q3: no longer SECURITY DEFINER';
  end if;
  if v_cfg is null or not (v_cfg @> array['search_path=public']) then
    raise exception 'ABORT Q3: search_path changed, got %', v_cfg;
  end if;
  raise notice 'POST Q3 DEFINER and search_path preserved';
end $mig$;

-- Q4  Nothing was written to any table.
do $mig$
declare n int; b int;
begin
  select count(*) into n from public.org_people;
  select count(*) into b from public.import_batches;
  raise notice 'POST Q4 org_people % rows, import_batches % rows (unchanged)', n, b;
end $mig$;

commit;

select 'DONE-01' as marker,
       md5(pg_get_functiondef(p.oid)) as new_hash,
       pg_get_functiondef(p.oid) like '%template header%' as date_msg_fixed,
       pg_get_functiondef(p.oid) like '%outranks an in-file duplicate%' as ref_precedence_fixed
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='import_people_batch';
