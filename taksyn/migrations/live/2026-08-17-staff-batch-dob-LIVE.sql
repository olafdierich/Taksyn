-- ============================================================
-- [CODESPACE] -> [SANDBOX buqlbmgxevuldahhdbxo]  Sydney
-- stage_staff_batch: accept a date of birth
--
-- Piece 3 of 4. Pieces 1 and 2 are proven: a date of birth passed
-- to invite-user reaches handle_new_user through the invite
-- metadata and lands on profiles.date_of_birth past the guard
-- (verified end to end, CHK-107).
--
-- The value arrives here ALREADY IN ISO. The client parses the
-- spreadsheet's local format before sending, exactly as the
-- client/contractor import does — the format detection and
-- parsing are built and tested in importFields.js. So this
-- validates a date, it does not parse a format.
--
-- SANITY RANGE, and a deliberate inconsistency
-- A staff member born tomorrow, or in 1850, is a typo. This
-- refuses anything outside 1900..today so it is caught in the
-- preview rather than stored and discovered years later.
--
-- org_people.date_of_birth has NO such check: the client register
-- accepts any date. The two imports therefore behave differently,
-- which is a real inconsistency. It is accepted here because a
-- wrong date on a staff record is worse than an odd one on a
-- register entry, and because widening the client rules is a
-- change to a live feature rather than an addition to a new one.
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
  -- INVERTED for LIVE.
  if n < 30 then
    raise exception 'ABORT P1: only % auth users - this looks like SANDBOX. This is the LIVE variant.', n;
  end if;
end $mig$;

do $mig$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='import_staff_rows') then
    raise exception 'ABORT P2: import_staff_rows missing — apply stage 6 first';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='import_staff_rows'
               and column_name='date_of_birth') then
    raise exception 'ABORT P2: import_staff_rows.date_of_birth already exists';
  end if;
  raise notice 'PRE P2 staging table present, column not yet added';
end $mig$;

-- P3  The whole point is that the value can reach profiles.
do $mig$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='profiles'
                   and column_name='date_of_birth') then
    raise exception 'ABORT P3: profiles.date_of_birth missing';
  end if;
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='handle_new_user') not like '%FIX-DOB-FROM-INVITE%' then
    raise exception 'ABORT P3: handle_new_user does not carry a date of birth. Staging one would collect a value nothing can write.';
  end if;
  raise notice 'PRE P3 profiles column present and handle_new_user carries it';
end $mig$;


-- ---------- COLUMN ----------

alter table public.import_staff_rows
  add column if not exists date_of_birth date;

comment on column public.import_staff_rows.date_of_birth is
  'Optional. Passed to invite-user as dateOfBirth and written to profiles by handle_new_user on the INSERT. Cannot be written by updating profiles: profiles_guard pins it and auth.uid() is null on a service-role connection.';


-- ---------- VALIDATION ----------

do $mig$
declare
  v_def  text;
  v_new  text;
  v_old1 text; v_rep1 text;
  v_old2 text; v_rep2 text;
  v_old3 text; v_rep3 text;
  v_old4 text; v_rep4 text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='stage_staff_batch';

  if v_def is null then
    raise exception 'ABORT: stage_staff_batch not found';
  end if;
  if v_def like '%date_of_birth%' then
    raise exception 'ABORT: stage_staff_batch already mentions date_of_birth';
  end if;

  -- 1. a variable
  v_old1 := $o1$  v_job       text;$o1$;
  v_rep1 := $r1$  v_job       text;
  v_dob       date;
  v_dob_txt   text;$r1$;

  -- 2. read and validate it
  v_old2 := $o2$    -- name
    if v_name = '' then$o2$;
  v_rep2 := $r2$    -- date of birth. Arrives already in ISO: the client parses the
    -- spreadsheet's local format first, as the client import does.
    v_dob_txt := nullif(btrim(coalesce(v_elem->>'date_of_birth','')), '');
    v_dob := null;

    -- name
    if v_name = '' then$r2$;

  -- 3. the checks, placed after the access-level block so a row
  --    reports its most important problem first
  v_old3 := $o3$    -- job role: checked against the organisation's own list, but$o3$;
  v_rep3 := $r3$    -- A staff member born tomorrow, or in 1850, is a typo. Caught
    -- here rather than stored and found years later. Note org_people
    -- has no equivalent check, so the two imports differ deliberately.
    if v_verdict is null and v_dob_txt is not null then
      begin
        v_dob := v_dob_txt::date;
      exception when others then
        v_verdict := 'error';
        v_reason  := format('date of birth %L could not be read as a date', v_dob_txt);
      end;
      if v_verdict is null and v_dob > current_date then
        v_verdict := 'error';
        v_reason  := format('date of birth %s is in the future', to_char(v_dob,'DD Mon YYYY'));
      end if;
      if v_verdict is null and v_dob < date '1900-01-01' then
        v_verdict := 'error';
        v_reason  := format('date of birth %s is before 1900 — check for a typo', to_char(v_dob,'DD Mon YYYY'));
      end if;
    end if;

    -- job role: checked against the organisation's own list, but$r3$;

  -- 4. stage it
  v_old4 := $o4$          (batch_id, org, row_no, email, full_name, access_role, job_role, created_by)
        values
          (v_batch_id, p_org, v_row_no, v_email, v_name, v_access, v_job, v_uid);$o4$;
  v_rep4 := $r4$          (batch_id, org, row_no, email, full_name, access_role, job_role, date_of_birth, created_by)
        values
          (v_batch_id, p_org, v_row_no, v_email, v_name, v_access, v_job, v_dob, v_uid);$r4$;

  if (length(v_def) - length(replace(v_def, v_old1, ''))) / length(v_old1) <> 1 then
    raise exception 'ABORT: the declare anchor was not found exactly once.';
  end if;
  if (length(v_def) - length(replace(v_def, v_old2, ''))) / length(v_old2) <> 1 then
    raise exception 'ABORT: the name-check anchor was not found exactly once.';
  end if;
  if (length(v_def) - length(replace(v_def, v_old3, ''))) / length(v_old3) <> 1 then
    raise exception 'ABORT: the job-role anchor was not found exactly once.';
  end if;
  if (length(v_def) - length(replace(v_def, v_old4, ''))) / length(v_old4) <> 1 then
    raise exception 'ABORT: the staging insert was not found exactly once.';
  end if;

  v_new := replace(v_def,  v_old1, v_rep1);
  v_new := replace(v_new,  v_old2, v_rep2);
  v_new := replace(v_new,  v_old3, v_rep3);
  v_new := replace(v_new,  v_old4, v_rep4);

  -- Column and value counts must match, or every staged row fails.
  if v_new not like '%v_job, v_dob, v_uid);%' then
    raise exception 'ABORT: the staging insert did not gain v_dob in its VALUES list.';
  end if;

  -- The returned verdict rows should carry it too, for the preview.
  v_new := replace(v_new,
    $o5$      'access_role', v_access, 'job_role', v_job,$o5$,
    $r5$      'access_role', v_access, 'job_role', v_job, 'date_of_birth', v_dob,$r5$);

  execute v_new;
  raise notice 'PATCH applied: date of birth validated, staged and returned in the verdict';
end $mig$;


-- ---------- POST ----------

do $mig$
declare v_def text; t text;
begin
  select data_type into t from information_schema.columns
  where table_schema='public' and table_name='import_staff_rows' and column_name='date_of_birth';
  if t is distinct from 'date' then
    raise exception 'ABORT Q1: import_staff_rows.date_of_birth is %, expected date', coalesce(t,'MISSING');
  end if;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='stage_staff_batch';

  if v_def not like '%is in the future%' then
    raise exception 'ABORT Q1: the future-date check is absent';
  end if;
  if v_def not like '%before 1900%' then
    raise exception 'ABORT Q1: the 1900 check is absent';
  end if;
  if v_def not like '%v_job, v_dob, v_uid);%' then
    raise exception 'ABORT Q1: the staging insert does not carry v_dob';
  end if;
  raise notice 'POST Q1 column added, both range checks and the staging insert present';
end $mig$;

-- Q2  Everything the function already guarded must still be guarded.
do $mig$
declare v_def text; missing text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='stage_staff_batch';

  select string_agg(f, ', ') into missing
  from unnest(array['no authenticated user',
                    'can_bulk_import',
                    'already has a Taksyn account',
                    'at or above your own access level',
                    'refusing to stage']) f
  where position(f in v_def) = 0;
  if missing is not null then
    raise exception 'ABORT Q2: lost from the function: %', missing;
  end if;
  raise notice 'POST Q2 null-uid guard, authorisation, existing-account check, role clamp and whole-file gate intact';
end $mig$;

do $mig$
declare v_sec boolean; v_cfg text[];
begin
  select p.prosecdef, p.proconfig into v_sec, v_cfg
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='stage_staff_batch';
  if not v_sec then raise exception 'ABORT Q3: no longer SECURITY DEFINER'; end if;
  if v_cfg is null or not (v_cfg @> array['search_path=public']) then
    raise exception 'ABORT Q3: search_path changed, got %', v_cfg;
  end if;
  raise notice 'POST Q3 DEFINER and search_path preserved';
end $mig$;

do $mig$
declare n int;
begin
  select count(*) into n from public.import_staff_rows;
  raise notice 'POST Q4 import_staff_rows has % rows (unchanged)', n;
end $mig$;

commit;

select 'DONE-01' as marker,
       (select count(*) from information_schema.columns
        where table_schema='public' and table_name='import_staff_rows' and column_name='date_of_birth') as column_added,
       (select pg_get_functiondef(p.oid) like '%is in the future%'
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='stage_staff_batch') as range_checked;
