-- ============================================================
-- [SANDBOX buqlbmgxevuldahhdbxo]  Sydney
-- Bulk import — STAGE 2: import_people_batch()
--
-- Clients and contractors only. Staff cannot enter org_people
-- (org_people_type_check, proven by Stage 1 Q6).
--
-- Depends on Stage 1 (import_batches, org_people.import_batch_id).
--
-- Duplicate policy, per D3 as revised against real key coverage
-- (2/10 rows have email, 5/10 external_ref, 2/10 DOB):
--   * external_ref exact match  -> ALWAYS skipped, not overridable.
--     A ref collision is a hard identity claim.
--   * name match, both DOBs present and DIFFERENT -> not a
--     duplicate. Two real people. Imported.
--   * name match, DOB agrees or is missing -> skipped, overridable.
--   * duplicate within the same file -> skipped, overridable.
--
-- p_dry_run defaults TRUE. Nothing is written unless the caller
-- explicitly asks for a commit.
--
-- Idempotent (create or replace). Transactional.
-- ============================================================
\pset pager off
\set ON_ERROR_STOP on

begin;

-- ---------- PRE ASSERTIONS ----------

do $$
declare n int;
begin
  select count(*) into n from auth.users;
  raise notice 'PRE P1 auth users = %', n;
  if n > 30 then
    raise exception 'ABORT P1: % auth users looks like LIVE, not SANDBOX', n;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='import_batches'
  ) then
    raise exception 'ABORT P2: import_batches missing — apply Stage 1 first';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='org_people'
      and column_name='import_batch_id'
  ) then
    raise exception 'ABORT P2: org_people.import_batch_id missing — apply Stage 1 first';
  end if;
  raise notice 'PRE P2 Stage 1 objects present';
end $$;

-- P3  org_people_access_log accepts the shape used below.
do $$
declare missing text;
begin
  select string_agg(c, ', ') into missing
  from unnest(array['org','actor_id','action','matched_ids','result_count','person_id']) c
  where not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='org_people_access_log' and column_name=c
  );
  if missing is not null then
    raise exception 'ABORT P3: org_people_access_log missing columns: %', missing;
  end if;
  raise notice 'PRE P3 access log shape matches resolve_org_people_submission';
end $$;

create temporary table _pre2_baseline on commit drop as
select count(*) as org_people_rows from public.org_people;


-- ---------- FUNCTION ----------

create or replace function public.import_people_batch(
  p_org       text,
  p_rows      jsonb,
  p_filename  text    default null,
  p_sha256    text    default null,
  p_dry_run   boolean default true,
  p_overrides jsonb   default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid        uuid := auth.uid();
  v_batch_id   uuid;
  v_elem       jsonb;
  v_idx        bigint;
  v_row_no     int;
  v_type       text;
  v_name       text;
  v_email      text;
  v_phone      text;
  v_ref        text;
  v_dob        date;
  v_dob_txt    text;
  v_norm       text;
  v_verdict    text;
  v_reason     text;
  v_person_id  uuid;
  v_seen       text[] := '{}';
  v_overrides  int[]  := '{}';
  v_results    jsonb  := '[]'::jsonb;
  v_override   boolean;
  v_dupe_n     int;
  v_n_total    int := 0;
  v_n_import   int := 0;
  v_n_skip     int := 0;
  v_n_error    int := 0;
begin
  -- ---- guards ----

  -- auth.uid() is null under the SQL editor and service-role
  -- connections. Same class of silent failure as profiles_guard:
  -- fail loudly rather than write rows attributed to nobody.
  if v_uid is null then
    raise exception 'no authenticated user (auth.uid() is null): bulk import must be called from a signed-in session, not the SQL editor or a service-role connection';
  end if;

  -- SECURITY DEFINER bypasses RLS, so the table policies do NOT
  -- protect this function. Explicit inline check.
  if not is_super_admin() then
    raise exception 'only a super_admin may run a bulk import';
  end if;

  if p_org is null or btrim(p_org) = '' then
    raise exception 'target organisation is required';
  end if;

  if not exists (select 1 from organisations where id = p_org) then
    raise exception 'organisation % not found', p_org;
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a json array';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    raise exception 'p_rows is empty: nothing to import';
  end if;

  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'too many rows (%): split the file, the limit is 2000',
      jsonb_array_length(p_rows);
  end if;

  if p_overrides is not null and jsonb_typeof(p_overrides) = 'array' then
    select coalesce(array_agg(e::int), '{}') into v_overrides
    from jsonb_array_elements_text(p_overrides) e;
  end if;

  -- ---- per-row pass ----

  for v_idx, v_elem in
    select ordinality, value from jsonb_array_elements(p_rows) with ordinality
  loop
    v_n_total  := v_n_total + 1;
    v_row_no   := coalesce(nullif(v_elem->>'row_no','')::int, v_idx::int);
    v_verdict  := null;
    v_reason   := null;
    v_person_id := null;
    v_override := v_row_no = any(v_overrides);

    v_name    := btrim(coalesce(v_elem->>'full_name', ''));
    v_type    := lower(btrim(coalesce(v_elem->>'person_type', '')));
    v_email   := nullif(btrim(coalesce(v_elem->>'contact_email','')), '');
    v_phone   := nullif(btrim(coalesce(v_elem->>'contact_phone','')), '');
    v_ref     := nullif(btrim(coalesce(v_elem->>'external_ref','')),  '');
    v_dob_txt := nullif(btrim(coalesce(v_elem->>'date_of_birth','')), '');
    v_dob     := null;

    -- validation
    if v_name = '' then
      v_verdict := 'error';
      v_reason  := 'full_name is blank';
    elsif v_type not in ('client','contractor') then
      v_verdict := 'error';
      v_reason  := format('person_type must be client or contractor, got %L', v_type);
    end if;

    if v_verdict is null and v_dob_txt is not null then
      begin
        v_dob := v_dob_txt::date;
      exception when others then
        v_verdict := 'error';
        v_reason  := format('date_of_birth %L is not a valid date (use YYYY-MM-DD)', v_dob_txt);
      end;
    end if;

    if v_verdict is null and v_email is not null
       and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_verdict := 'error';
      v_reason  := format('contact_email %L is not a valid address', v_email);
    end if;

    -- duplicate within this same file
    if v_verdict is null then
      v_norm := v_type || '|' || lower(regexp_replace(v_name, '\s+', ' ', 'g'));
      if v_norm = any(v_seen) and not v_override then
        v_verdict := 'skipped';
        v_reason  := 'the same name appears earlier in this file';
      end if;
    end if;

    -- external_ref collision: never overridable
    if v_verdict is null and v_ref is not null then
      if exists (
        select 1 from org_people
        where org = p_org
          and lower(btrim(external_ref)) = lower(v_ref)
      ) then
        v_verdict := 'skipped';
        v_reason  := format('external_ref %L is already in the register (reference collisions cannot be overridden)', v_ref);
      end if;
    end if;

    -- soft match on normalised name.
    -- Rows where both DOBs are present and differ are excluded:
    -- those are two different people and should import.
    if v_verdict is null then
      select count(*) into v_dupe_n
      from org_people
      where org = p_org
        and person_type = v_type
        and lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g'))
          = lower(regexp_replace(v_name, '\s+', ' ', 'g'))
        and (v_dob is null or date_of_birth is null or date_of_birth = v_dob);

      if v_dupe_n > 0 and not v_override then
        v_verdict := 'skipped';
        v_reason  := case
          when v_dob is not null then
            format('%s existing register entr%s match this name and the date of birth agrees or is not recorded',
                   v_dupe_n, case when v_dupe_n = 1 then 'y' else 'ies' end)
          else
            format('%s existing register entr%s match this name, and no date of birth was supplied to tell them apart',
                   v_dupe_n, case when v_dupe_n = 1 then 'y' else 'ies' end)
        end;
      end if;
    end if;

    -- commit the row
    if v_verdict is null then
      v_verdict := 'import';

      if not p_dry_run then
        if v_batch_id is null then
          insert into import_batches
            (org, kind, filename, file_sha256, rows_total, uploaded_by)
          values
            (p_org, 'people', p_filename, p_sha256, jsonb_array_length(p_rows), v_uid)
          returning id into v_batch_id;
        end if;

        insert into org_people
          (org, person_type, full_name, contact_email, contact_phone,
           external_ref, date_of_birth, status, created_by, import_batch_id)
        values
          (p_org, v_type, v_name, v_email, v_phone,
           v_ref, v_dob, 'active', v_uid, v_batch_id)
        returning id into v_person_id;

        insert into org_people_access_log
          (org, actor_id, action, matched_ids, result_count, person_id)
        values
          (p_org, v_uid, 'create', array[v_person_id], 1, v_person_id);
      end if;

      v_seen     := v_seen || v_norm;
      v_n_import := v_n_import + 1;

    elsif v_verdict = 'error' then
      v_n_error := v_n_error + 1;
    else
      v_n_skip := v_n_skip + 1;
    end if;

    v_results := v_results || jsonb_build_object(
      'row_no',    v_row_no,
      'full_name', v_name,
      'verdict',   v_verdict,
      'reason',    v_reason,
      'person_id', v_person_id,
      'overridden', v_override
    );
  end loop;

  -- Whole-file gate: a commit with any invalid row lands nothing.
  -- The inserts above roll back with this exception.
  if not p_dry_run and v_n_error > 0 then
    raise exception 'refusing to import: % of % rows are invalid. Run with p_dry_run => true to see each one.',
      v_n_error, v_n_total;
  end if;

  if not p_dry_run and v_batch_id is not null then
    update import_batches
       set rows_imported = v_n_import,
           rows_skipped  = v_n_skip + v_n_error
     where id = v_batch_id;
  end if;

  return jsonb_build_object(
    'ok',       true,
    'dry_run',  p_dry_run,
    'org',      p_org,
    'batch_id', v_batch_id,
    'counts',   jsonb_build_object(
                  'total',    v_n_total,
                  'imported', v_n_import,
                  'skipped',  v_n_skip,
                  'errors',   v_n_error
                ),
    'rows',     v_results
  );
end;
$function$;

comment on function public.import_people_batch(text, jsonb, text, text, boolean, jsonb) is
  'Bulk import of clients and contractors into org_people. super_admin only, inline-checked. p_dry_run defaults true and writes nothing. Staff are out of scope: org_people_type_check refuses them.';

revoke all on function public.import_people_batch(text, jsonb, text, text, boolean, jsonb) from public, anon;
grant execute on function public.import_people_batch(text, jsonb, text, text, boolean, jsonb) to authenticated;


-- ---------- POST ASSERTIONS ----------

do $$
declare v_sec boolean; v_cfg text[];
begin
  select p.prosecdef, p.proconfig into v_sec, v_cfg
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='import_people_batch';

  if v_sec is null then
    raise exception 'ABORT Q1: import_people_batch not created';
  end if;
  if not v_sec then
    raise exception 'ABORT Q1: function is not SECURITY DEFINER';
  end if;
  if v_cfg is null or not (v_cfg @> array['search_path=public']) then
    raise exception 'ABORT Q1: search_path not pinned, got %', v_cfg;
  end if;
  raise notice 'POST Q1 function present, DEFINER, search_path pinned';
end $$;

-- Q2  NEGATIVE CONTROL. auth.uid() is null here in psql, so the
--     function must refuse. If this ever succeeds, the guard is broken.
do $$
begin
  begin
    perform import_people_batch(
      'ORG_DOES_NOT_EXIST',
      '[{"row_no":1,"person_type":"client","full_name":"Probe Row"}]'::jsonb
    );
    raise exception 'ABORT Q2: function ran with a null auth.uid() — guard is broken';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like '%ABORT Q2%' then
        raise;
      end if;
      raise notice 'POST Q2 refused as expected: %', sqlerrm;
  end;
end $$;

-- Q3  Nothing was written by any of the above.
do $$
declare before_n int; after_n int; batch_n int;
begin
  select org_people_rows into before_n from _pre2_baseline;
  select count(*) into after_n  from public.org_people;
  select count(*) into batch_n  from public.import_batches;
  if before_n <> after_n then
    raise exception 'ABORT Q3: org_people moved % -> %', before_n, after_n;
  end if;
  if batch_n <> 0 then
    raise exception 'ABORT Q3: import_batches has % rows, expected 0', batch_n;
  end if;
  raise notice 'POST Q3 no data written (org_people % rows, batches 0)', after_n;
end $$;

-- Q4  Execute privileges are correctly scoped.
do $$
begin
  if has_function_privilege('anon',
       'public.import_people_batch(text, jsonb, text, text, boolean, jsonb)', 'execute') then
    raise exception 'ABORT Q4: anon can execute the import function';
  end if;
  if not has_function_privilege('authenticated',
       'public.import_people_batch(text, jsonb, text, text, boolean, jsonb)', 'execute') then
    raise exception 'ABORT Q4: authenticated cannot execute the import function';
  end if;
  raise notice 'POST Q4 execute: authenticated yes, anon no';
end $$;

commit;

select 'DONE-01 fn' as marker, proname,
       case when prosecdef then 'DEFINER' else 'INVOKER' end as security,
       pg_get_function_identity_arguments(oid) as args
from pg_proc where proname = 'import_people_batch';

select 'DONE-02 untouched' as marker,
       (select count(*) from public.org_people)     as org_people_rows,
       (select count(*) from public.import_batches) as batch_rows;
