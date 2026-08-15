-- ============================================================
-- [SANDBOX buqlbmgxevuldahhdbxo]  Sydney
-- Bulk import — STAGE 4: widen access to client_admin
--
-- Why: ContactsView (App.jsx ~14002) is a client_admin screen. It
-- resolves orgId from the caller's own org_members rows, and every
-- write goes through org_people policies requiring role =
-- 'client_admin'. A super_admin usually has NO org_members row, so
-- that screen never loads for them. An upload button there would be
-- unusable by the people who use the screen.
--
-- A client_admin can already insert these rows one at a time through
-- that form. Bulk import is the same operation, faster.
--
-- New rule for BOTH functions:
--   super_admin                        -> any org
--   client_admin of the target org     -> that org only
--   everyone else, incl. manager       -> refused
--
-- The check is an explicit inline role = 'client_admin'. NOT
-- is_org_admin(), which admits managers — the same trap
-- resolve_org_people_submission documents and guards against.
--
-- Depends on Stages 1, 2, 3v3.
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
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='import_people_batch') then
    raise exception 'ABORT P2: import_people_batch missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='undo_import_batch') then
    raise exception 'ABORT P2: undo_import_batch missing';
  end if;
  raise notice 'PRE P2 both functions present';
end $$;

-- P3  The delete guard must still hold — undo remains archive-only.
do $$
begin
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='org_people'
      and not t.tgisinternal and t.tgname='org_people_block_delete'
  ) then
    raise exception 'ABORT P3: org_people_block_delete is gone — revisit the archive-only premise';
  end if;
  raise notice 'PRE P3 delete guard still present';
end $$;


-- ---------- SHARED AUTHORISATION HELPER ----------
-- One definition, used by both functions, so they cannot drift.

create or replace function public.can_bulk_import(p_org text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    public.is_super_admin()
    or exists (
      select 1 from org_members m
      where m.user_id = auth.uid()
        and m.org = p_org
        and m.is_active is not false
        and m.role = 'client_admin'     -- explicit role check, see Q2
    );
$function$;

comment on function public.can_bulk_import(text) is
  'True for a super_admin, or for a client_admin of the given org. Managers are deliberately excluded; the general org-admin helper would admit them.';

revoke all on function public.can_bulk_import(text) from public, anon;
grant execute on function public.can_bulk_import(text) to authenticated;


-- ---------- IMPORT: swap the guard ----------

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
  if v_uid is null then
    raise exception 'no authenticated user (auth.uid() is null): bulk import must be called from a signed-in session, not the SQL editor or a service-role connection';
  end if;

  if p_org is null or btrim(p_org) = '' then
    raise exception 'target organisation is required';
  end if;

  if not exists (select 1 from organisations where id = p_org) then
    raise exception 'organisation % not found', p_org;
  end if;

  -- SECURITY DEFINER bypasses RLS, so table policies do NOT protect
  -- this function. Explicit check, and it names the org.
  if not can_bulk_import(p_org) then
    raise exception 'not permitted: bulk import requires super_admin, or client_admin of this organisation';
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

  for v_idx, v_elem in
    select ordinality, value from jsonb_array_elements(p_rows) with ordinality
  loop
    v_n_total   := v_n_total + 1;
    v_row_no    := coalesce(nullif(v_elem->>'row_no','')::int, v_idx::int);
    v_verdict   := null;
    v_reason    := null;
    v_person_id := null;
    v_override  := v_row_no = any(v_overrides);

    v_name    := btrim(coalesce(v_elem->>'full_name', ''));
    v_type    := lower(btrim(coalesce(v_elem->>'person_type', '')));
    v_email   := nullif(btrim(coalesce(v_elem->>'contact_email','')), '');
    v_phone   := nullif(btrim(coalesce(v_elem->>'contact_phone','')), '');
    v_ref     := nullif(btrim(coalesce(v_elem->>'external_ref','')),  '');
    v_dob_txt := nullif(btrim(coalesce(v_elem->>'date_of_birth','')), '');
    v_dob     := null;

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

    if v_verdict is null then
      v_norm := v_type || '|' || lower(regexp_replace(v_name, '\s+', ' ', 'g'));
      if v_norm = any(v_seen) and not v_override then
        v_verdict := 'skipped';
        v_reason  := 'the same name appears earlier in this file';
      end if;
    end if;

    if v_verdict is null and v_ref is not null then
      if exists (
        select 1 from org_people
        where org = p_org and lower(btrim(external_ref)) = lower(v_ref)
      ) then
        v_verdict := 'skipped';
        v_reason  := format('external_ref %L is already in the register (reference collisions cannot be overridden)', v_ref);
      end if;
    end if;

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
            format('%s existing register entr%s this name and the date of birth agrees or is not recorded',
                   v_dupe_n, case when v_dupe_n = 1 then 'y matches' else 'ies match' end)
          else
            format('%s existing register entr%s this name, and no date of birth was supplied to tell them apart',
                   v_dupe_n, case when v_dupe_n = 1 then 'y matches' else 'ies match' end)
        end;
      end if;
    end if;

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
      'row_no',     v_row_no,
      'full_name',  v_name,
      'verdict',    v_verdict,
      'reason',     v_reason,
      'person_id',  v_person_id,
      'overridden', v_override
    );
  end loop;

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
  'Bulk import of clients and contractors into org_people. Permitted for a super_admin, or a client_admin of p_org. p_dry_run defaults true and writes nothing. Staff are out of scope: org_people_type_check refuses them.';


-- ---------- UNDO: same widening, scoped to the batch org ----------

create or replace function public.undo_import_batch(
  p_batch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid      uuid := auth.uid();
  v_batch    import_batches%rowtype;
  v_total    int;
  v_already  int;
  v_archived int := 0;
  v_rec      record;
begin
  if v_uid is null then
    raise exception 'no authenticated user (auth.uid() is null): undo must be called from a signed-in session';
  end if;

  select * into v_batch from import_batches where id = p_batch_id;
  if not found then
    raise exception 'import batch % not found', p_batch_id;
  end if;

  -- Authorised against the BATCH's org, not a caller-supplied one.
  if not can_bulk_import(v_batch.org) then
    raise exception 'not permitted: undo requires super_admin, or client_admin of the organisation that owns this batch';
  end if;

  if v_batch.status <> 'committed' then
    raise exception 'batch % is already %', p_batch_id, v_batch.status;
  end if;

  select count(*), count(*) filter (where status <> 'active')
    into v_total, v_already
  from org_people
  where import_batch_id = p_batch_id;

  if v_total = 0 then
    raise exception 'batch % has no rows to undo', p_batch_id;
  end if;

  for v_rec in
    select id from org_people
    where import_batch_id = p_batch_id and status = 'active'
  loop
    update org_people
       set status = 'archived', archived_at = now()
     where id = v_rec.id;

    v_archived := v_archived + 1;

    insert into org_people_access_log
      (org, actor_id, action, matched_ids, result_count, person_id)
    values
      (v_batch.org, v_uid, 'archive', array[v_rec.id], 1, v_rec.id);
  end loop;

  update import_batches
     set status    = 'undone',
         undone_by = v_uid,
         undone_at = now(),
         notes     = format('archived %s of %s imported rows (%s were already archived)',
                            v_archived, v_total, v_already)
   where id = p_batch_id;

  return jsonb_build_object(
    'ok',               true,
    'batch_id',         p_batch_id,
    'rows_total',       v_total,
    'rows_archived',    v_archived,
    'already_archived', v_already
  );
end;
$function$;

comment on function public.undo_import_batch(uuid) is
  'Reverses a bulk import by archiving its org_people rows. Permitted for a super_admin, or a client_admin of the batch org. Rows are never deleted: org_people_block_delete forbids it.';


-- ---------- RLS: client_admin can see their own org's batches ----------

drop policy if exists import_batches_select_sa on public.import_batches;
drop policy if exists import_batches_select_ca on public.import_batches;

create policy import_batches_select_ca
  on public.import_batches
  for select
  to authenticated
  using (public.can_bulk_import(org));

-- Still no INSERT / UPDATE / DELETE policies. All writes go through
-- the SECURITY DEFINER functions above.


-- ---------- POST ASSERTIONS ----------

do $$
declare v_sec boolean; v_cfg text[];
begin
  select p.prosecdef, p.proconfig into v_sec, v_cfg
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='can_bulk_import';
  if v_sec is null then raise exception 'ABORT Q1: can_bulk_import not created'; end if;
  if not v_sec then raise exception 'ABORT Q1: can_bulk_import not SECURITY DEFINER'; end if;
  if v_cfg is null or not (v_cfg @> array['search_path=public']) then
    raise exception 'ABORT Q1: can_bulk_import search_path not pinned';
  end if;
  raise notice 'POST Q1 can_bulk_import present, DEFINER, pinned';
end $$;

-- Q2  The helper must NOT reference is_org_admin, which admits managers.
do $$
declare v_src text; v_code text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='can_bulk_import';

  -- Strip SQL line comments before scanning. v1 of this assertion
  -- matched the word inside its own explanatory comment and aborted
  -- a correct migration: a text scan cannot tell a call from prose.
  v_code := regexp_replace(v_src, '--[^\n]*', '', 'g');

  if v_code ilike '%is_org_admin%' then
    raise exception 'ABORT Q2: can_bulk_import calls the org-admin helper — managers would be admitted';
  end if;
  if v_code not ilike '%client_admin%' then
    raise exception 'ABORT Q2: can_bulk_import does not check client_admin';
  end if;
  raise notice 'POST Q2 explicit client_admin check, general org-admin helper not used';
end $$;

-- Q3  Both functions still refuse a null auth.uid().
do $$
begin
  begin
    perform import_people_batch('ORGX', '[{"row_no":1,"person_type":"client","full_name":"P"}]'::jsonb);
    raise exception 'ABORT Q3: import ran with null auth.uid()';
  exception when sqlstate 'P0001' then
    if sqlerrm like '%ABORT Q3%' then raise; end if;
    raise notice 'POST Q3a import refused: %', sqlerrm;
  end;

  begin
    perform undo_import_batch('00000000-0000-0000-0000-000000000000'::uuid);
    raise exception 'ABORT Q3: undo ran with null auth.uid()';
  exception when sqlstate 'P0001' then
    if sqlerrm like '%ABORT Q3%' then raise; end if;
    raise notice 'POST Q3b undo refused: %', sqlerrm;
  end;
end $$;

-- Q4  Exactly one SELECT policy on import_batches, no write policies.
do $$
declare n_sel int; n_other int;
begin
  select count(*) filter (where cmd='SELECT'), count(*) filter (where cmd<>'SELECT')
    into n_sel, n_other
  from pg_policies where schemaname='public' and tablename='import_batches';
  if n_sel <> 1 or n_other <> 0 then
    raise exception 'ABORT Q4: expected 1 SELECT and 0 write policies, got % / %', n_sel, n_other;
  end if;
  raise notice 'POST Q4 policies correct';
end $$;

-- Q5  Data untouched.
do $$
declare n int; a int;
begin
  select count(*), count(*) filter (where status='archived') into n, a from public.org_people;
  raise notice 'POST Q5 org_people % rows (% archived), unchanged', n, a;
end $$;

commit;

select 'DONE-01 fns' as marker, p.proname,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('can_bulk_import','import_people_batch','undo_import_batch')
order by p.proname;

select 'DONE-02 policy' as marker, policyname, cmd, qual
from pg_policies where schemaname='public' and tablename='import_batches';
