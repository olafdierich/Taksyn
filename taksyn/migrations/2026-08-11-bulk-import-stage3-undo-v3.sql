-- ============================================================
-- [SANDBOX buqlbmgxevuldahhdbxo]  Sydney
-- Bulk import — STAGE 3 v3: undo_import_batch(), archive-based
--
-- SUPERSEDES v2. Apply this instead of, or after, v2.
--
-- Why v2 was wrong:
--   CHK-27/28 found org_people_block_delete, a BEFORE DELETE
--   trigger raising 'org_people rows cannot be deleted; set
--   status = archived instead'. Matching guards exist on
--   org_people_submissions and org_people_access_log ('the
--   access log is immutable'). The register subsystem is
--   deliberately append-only. v2 was designed against a foreign
--   key survey that never looked at triggers.
--
-- This migration therefore:
--   1. Reverts org_people_access_log.action to its original five
--      values, since nothing writes 'delete' any more.
--   2. Replaces undo_import_batch with an archive operation:
--      status = 'archived', archived_at = now(), logged as
--      action = 'archive' — a word the vocabulary already has,
--      describing exactly what occurs.
--
-- The delete trigger is NOT disabled or worked around. It is a
-- deliberate compliance guard and this function respects it.
--
-- Every row in the batch is archived, including rows referenced
-- by incidents: archiving cannot break referential integrity,
-- and a partial undo leaves a worse mess than none.
--
-- Depends on Stage 1 and Stage 2.
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
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='import_people_batch'
  ) then
    raise exception 'ABORT P2: import_people_batch missing — apply Stage 2 first';
  end if;
  raise notice 'PRE P2 Stage 2 present';
end $$;

-- P3  The delete guard must still be in place. If it has been
--     removed, someone changed the register's design and this
--     function's premise needs rechecking.
do $$
declare v_def text;
begin
  select pg_get_triggerdef(t.oid) into v_def
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relname='org_people'
    and not t.tgisinternal and t.tgname = 'org_people_block_delete';

  if v_def is null then
    raise exception 'ABORT P3: org_people_block_delete is gone — the archive-only premise no longer holds, revisit this design';
  end if;
  raise notice 'PRE P3 delete guard present and respected';
end $$;

-- P4  No access log rows use 'delete', so the revert is safe.
do $$
declare n int;
begin
  select count(*) into n from public.org_people_access_log where action = 'delete';
  if n > 0 then
    raise exception 'ABORT P4: % access log rows use action=delete; the log is immutable so they cannot be corrected. Revisit before reverting the constraint.', n;
  end if;
  raise notice 'PRE P4 no delete entries in the access log, revert is safe';
end $$;


-- ---------- REVERT THE VOCABULARY ----------
-- Idempotent: no-op where 'delete' was never added (eg. LIVE).

do $$
declare v_name text; v_def text;
begin
  select con.conname, pg_get_constraintdef(con.oid)
    into v_name, v_def
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname='public' and rel.relname='org_people_access_log'
    and con.contype='c' and pg_get_constraintdef(con.oid) ilike '%action%';

  if v_name is null then
    raise notice 'REVERT: no action check constraint — nothing to revert';
    return;
  end if;

  if v_def not ilike '%''delete''%' then
    raise notice 'REVERT: % already excludes delete — no change', v_name;
    return;
  end if;

  execute format('alter table public.org_people_access_log drop constraint %I', v_name);
  execute format($sql$
    alter table public.org_people_access_log
      add constraint %I check (action = any (array[
        'search'::text, 'view'::text, 'create'::text,
        'update'::text, 'archive'::text
      ]))
  $sql$, v_name);

  raise notice 'REVERT: % restored to search, view, create, update, archive', v_name;
end $$;


-- ---------- FUNCTION ----------

-- v2 had signature (uuid, boolean). Drop it so no stale overload
-- survives alongside the new one.
drop function if exists public.undo_import_batch(uuid, boolean);

create or replace function public.undo_import_batch(
  p_batch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_batch     import_batches%rowtype;
  v_total     int;
  v_already   int;
  v_archived  int := 0;
  v_rec       record;
begin
  if v_uid is null then
    raise exception 'no authenticated user (auth.uid() is null): undo must be called from a signed-in session';
  end if;

  if not is_super_admin() then
    raise exception 'only a super_admin may undo an import';
  end if;

  select * into v_batch from import_batches where id = p_batch_id;
  if not found then
    raise exception 'import batch % not found', p_batch_id;
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

  -- Archive, never delete: org_people_block_delete forbids
  -- deletion and this function does not attempt to bypass it.
  for v_rec in
    select id, full_name from org_people
    where import_batch_id = p_batch_id and status = 'active'
  loop
    update org_people
       set status      = 'archived',
           archived_at = now()
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
    'ok',                true,
    'batch_id',          p_batch_id,
    'rows_total',        v_total,
    'rows_archived',     v_archived,
    'already_archived',  v_already
  );
end;
$function$;

comment on function public.undo_import_batch(uuid) is
  'Reverses a bulk import by archiving its org_people rows (status=archived, archived_at set). Rows are never deleted: org_people_block_delete forbids it and the register is deliberately append-only. super_admin only. Each archive is recorded in org_people_access_log.';

revoke all on function public.undo_import_batch(uuid) from public, anon;
grant execute on function public.undo_import_batch(uuid) to authenticated;


-- ---------- POST ASSERTIONS ----------

do $$
declare v_sec boolean; v_cfg text[]; v_n int;
begin
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='undo_import_batch';
  if v_n <> 1 then
    raise exception 'ABORT Q1: expected exactly 1 undo_import_batch, found %', v_n;
  end if;

  select p.prosecdef, p.proconfig into v_sec, v_cfg
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='undo_import_batch';

  if not v_sec then
    raise exception 'ABORT Q1: not SECURITY DEFINER';
  end if;
  if v_cfg is null or not (v_cfg @> array['search_path=public']) then
    raise exception 'ABORT Q1: search_path not pinned, got %', v_cfg;
  end if;
  raise notice 'POST Q1 single function, DEFINER, search_path pinned';
end $$;

-- Q2  NEGATIVE CONTROL: null auth.uid() in psql must be refused.
do $$
begin
  begin
    perform undo_import_batch('00000000-0000-0000-0000-000000000000'::uuid);
    raise exception 'ABORT Q2: ran with a null auth.uid() — guard is broken';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like '%ABORT Q2%' then raise; end if;
      raise notice 'POST Q2 refused as expected: %', sqlerrm;
  end;
end $$;

-- Q3  Vocabulary is back to five values.
do $$
declare v_def text;
begin
  select pg_get_constraintdef(con.oid) into v_def
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname='public' and rel.relname='org_people_access_log'
    and con.contype='c' and pg_get_constraintdef(con.oid) ilike '%action%';

  if v_def ilike '%''delete''%' then
    raise exception 'ABORT Q3: action still permits delete: %', v_def;
  end if;
  raise notice 'POST Q3 vocabulary reverted';
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.undo_import_batch(uuid)', 'execute') then
    raise exception 'ABORT Q4: anon can execute undo';
  end if;
  if not has_function_privilege('authenticated', 'public.undo_import_batch(uuid)', 'execute') then
    raise exception 'ABORT Q4: authenticated cannot execute undo';
  end if;
  raise notice 'POST Q4 execute: authenticated yes, anon no';
end $$;

-- Q5  Nothing changed in the data.
do $$
declare n int; a int; b int;
begin
  select count(*) into n from public.org_people;
  select count(*) into a from public.org_people where status = 'archived';
  select count(*) into b from public.import_batches where status = 'committed';
  raise notice 'POST Q5 org_people % rows (% archived), % committed batches', n, a, b;
end $$;

commit;

select 'DONE-01 fn' as marker, proname,
       case when prosecdef then 'DEFINER' else 'INVOKER' end as security,
       pg_get_function_identity_arguments(oid) as args
from pg_proc where proname = 'undo_import_batch';

select 'DONE-02 vocabulary' as marker, pg_get_constraintdef(con.oid) as action_check
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname='public' and rel.relname='org_people_access_log'
  and con.contype='c' and pg_get_constraintdef(con.oid) ilike '%action%';

select 'DONE-03 state' as marker,
       (select count(*) from public.org_people) as org_people_rows,
       (select count(*) from public.org_people where status='archived') as archived_rows,
       (select count(*) from public.import_batches where status='committed') as committed_batches;
