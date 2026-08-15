-- ============================================================
-- [SANDBOX buqlbmgxevuldahhdbxo]  Sydney
-- Bulk import — STAGE 3 v2: undo_import_batch()
--
-- v1 aborted at P4: org_people_access_log.action permits only
--   search, view, create, update, archive
-- Decision: widen the vocabulary to include 'delete' rather than
-- log a deletion as an archive (which would misdescribe it) or
-- soft-archive mis-imported rows (which would leave permanent
-- ghosts in a privacy register).
--
-- Deletion remains tightly fenced. A row is only removable if:
--   * status still 'active', archived_at null
--   * user_id null (never linked to an auth account)
--   * not referenced by incidents.affected_person_id
--   * not referenced by org_people_submissions.resolved_person_id
--     (CHK-21 proved these are the only two FKs to org_people)
--
-- Default is all-or-nothing. p_leave_referenced removes only the
-- untouched rows. Access log entries are never deleted.
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

-- P3  The FK set must still be exactly the two from CHK-21.
do $$
declare n int; names text;
begin
  select count(*), string_agg(src.relname, ', ')
    into n, names
  from pg_constraint con
  join pg_class tgt on tgt.oid = con.confrelid
  join pg_class src on src.oid = con.conrelid
  join pg_namespace ns on ns.oid = tgt.relnamespace
  where ns.nspname='public' and tgt.relname='org_people' and con.contype='f';

  raise notice 'PRE P3 tables referencing org_people: % (%)', n, coalesce(names,'none');
  if n <> 2 then
    raise exception 'ABORT P3: expected 2 referencing tables, found %: %', n, names;
  end if;
end $$;


-- ---------- WIDEN THE ACCESS LOG VOCABULARY ----------
-- Adds 'delete' to the permitted actions, preserving the five
-- existing values. Constraint name is derived, not assumed.
-- Idempotent: does nothing if 'delete' is already permitted.

do $$
declare
  v_name text;
  v_def  text;
begin
  select con.conname, pg_get_constraintdef(con.oid)
    into v_name, v_def
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname='public'
    and rel.relname='org_people_access_log'
    and con.contype='c'
    and pg_get_constraintdef(con.oid) ilike '%action%';

  if v_name is null then
    raise notice 'WIDEN: no action check constraint found — nothing to widen';
    return;
  end if;

  if v_def ilike '%''delete''%' then
    raise notice 'WIDEN: % already permits delete — no change', v_name;
    return;
  end if;

  raise notice 'WIDEN: replacing % (was: %)', v_name, v_def;

  execute format('alter table public.org_people_access_log drop constraint %I', v_name);

  execute format($sql$
    alter table public.org_people_access_log
      add constraint %I check (action = any (array[
        'search'::text, 'view'::text, 'create'::text,
        'update'::text, 'archive'::text, 'delete'::text
      ]))
  $sql$, v_name);

  raise notice 'WIDEN: % now permits search, view, create, update, archive, delete', v_name;
end $$;

-- P4  Confirm the widening took effect before the function relies on it.
do $$
declare v_def text;
begin
  select pg_get_constraintdef(con.oid) into v_def
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname='public' and rel.relname='org_people_access_log'
    and con.contype='c' and pg_get_constraintdef(con.oid) ilike '%action%';

  if v_def is null then
    raise notice 'POST-WIDEN P4 no constraint on action — any value accepted';
  elsif v_def not ilike '%''delete''%' then
    raise exception 'ABORT P4: action still does not permit delete: %', v_def;
  else
    raise notice 'POST-WIDEN P4 delete now permitted';
  end if;
end $$;

-- P5  Prove it accepts a delete row, then roll that proof back.
do $$
declare v_org text;
begin
  select org into v_org from public.org_people limit 1;
  begin
    insert into public.org_people_access_log
      (org, actor_id, action, matched_ids, result_count, person_id)
    values
      (v_org, gen_random_uuid(), 'delete', array[gen_random_uuid()], 1, gen_random_uuid());
    raise notice 'PRE P5 access log accepted a delete row (about to undo this probe)';
    raise exception 'ROLLBACK_PROBE';
  exception
    when sqlstate 'P0001' then
      if sqlerrm = 'ROLLBACK_PROBE' then
        raise notice 'PRE P5 probe row discarded';
      else
        raise;
      end if;
    when check_violation then
      raise exception 'ABORT P5: access log still refuses action=delete';
  end;
end $$;


-- ---------- FUNCTION ----------

create or replace function public.undo_import_batch(
  p_batch_id          uuid,
  p_leave_referenced  boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_batch     import_batches%rowtype;
  v_total     int;
  v_blocked   int;
  v_deleted   int := 0;
  v_blockers  jsonb := '[]'::jsonb;
  v_rec       record;
  v_id        uuid;
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

  create temporary table _undo_rows on commit drop as
  select
    p.id,
    p.full_name,
    case
      when p.status <> 'active'        then 'archived or inactive'
      when p.archived_at is not null   then 'archived'
      when p.user_id is not null       then 'linked to a user account'
      when exists (select 1 from incidents i where i.affected_person_id = p.id)
        then 'named on an incident'
      when exists (select 1 from org_people_submissions s where s.resolved_person_id = p.id)
        then 'linked to a register submission'
      else null
    end as blocker
  from org_people p
  where p.import_batch_id = p_batch_id;

  select count(*), count(*) filter (where blocker is not null)
    into v_total, v_blocked
  from _undo_rows;

  if v_total = 0 then
    raise exception 'batch % has no remaining rows to undo', p_batch_id;
  end if;

  if v_blocked > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'person_id', id, 'full_name', full_name, 'reason', blocker)), '[]'::jsonb)
      into v_blockers
    from _undo_rows where blocker is not null;

    if not p_leave_referenced then
      raise exception 'refusing to undo: % of % imported rows are in use (%). Review them, or call again with p_leave_referenced => true to remove only the untouched rows.',
        v_blocked, v_total,
        (select string_agg(distinct blocker, '; ') from _undo_rows where blocker is not null);
    end if;
  end if;

  for v_rec in select id, full_name from _undo_rows where blocker is null
  loop
    delete from org_people where id = v_rec.id returning id into v_id;
    if v_id is not null then
      v_deleted := v_deleted + 1;
      insert into org_people_access_log
        (org, actor_id, action, matched_ids, result_count, person_id)
      values
        (v_batch.org, v_uid, 'delete', array[v_rec.id], 1, v_rec.id);
    end if;
  end loop;

  update import_batches
     set status    = 'undone',
         undone_by = v_uid,
         undone_at = now(),
         notes     = case
                       when v_blocked > 0
                       then format('undone %s of %s rows; %s left in place because they were in use',
                                   v_deleted, v_total, v_blocked)
                       else format('undone all %s rows', v_deleted)
                     end
   where id = p_batch_id;

  return jsonb_build_object(
    'ok',           true,
    'batch_id',     p_batch_id,
    'rows_total',   v_total,
    'rows_deleted', v_deleted,
    'rows_left',    v_blocked,
    'blockers',     v_blockers
  );
end;
$function$;

comment on function public.undo_import_batch(uuid, boolean) is
  'Reverses a bulk import by deleting its org_people rows. super_admin only. Refuses if any row is archived, linked to a user, named on an incident, or linked to a submission, unless p_leave_referenced is passed. Deletions are recorded in org_people_access_log with action=delete; log entries are never removed.';

revoke all on function public.undo_import_batch(uuid, boolean) from public, anon;
grant execute on function public.undo_import_batch(uuid, boolean) to authenticated;


-- ---------- POST ASSERTIONS ----------

do $$
declare v_sec boolean; v_cfg text[];
begin
  select p.prosecdef, p.proconfig into v_sec, v_cfg
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='undo_import_batch';

  if v_sec is null then
    raise exception 'ABORT Q1: undo_import_batch not created';
  end if;
  if not v_sec then
    raise exception 'ABORT Q1: not SECURITY DEFINER';
  end if;
  if v_cfg is null or not (v_cfg @> array['search_path=public']) then
    raise exception 'ABORT Q1: search_path not pinned, got %', v_cfg;
  end if;
  raise notice 'POST Q1 function present, DEFINER, search_path pinned';
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

do $$
begin
  if has_function_privilege('anon',
       'public.undo_import_batch(uuid, boolean)', 'execute') then
    raise exception 'ABORT Q3: anon can execute undo';
  end if;
  if not has_function_privilege('authenticated',
       'public.undo_import_batch(uuid, boolean)', 'execute') then
    raise exception 'ABORT Q3: authenticated cannot execute undo';
  end if;
  raise notice 'POST Q3 execute: authenticated yes, anon no';
end $$;

-- Q4  Nothing was deleted or logged by the assertions above.
do $$
declare n int; b int; l int;
begin
  select count(*) into n from public.org_people;
  select count(*) into b from public.import_batches where status = 'committed';
  select count(*) into l from public.org_people_access_log where action = 'delete';
  if l <> 0 then
    raise exception 'ABORT Q4: % delete rows already in the access log, expected 0', l;
  end if;
  raise notice 'POST Q4 org_people % rows, % committed batches, 0 delete log entries', n, b;
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
       (select count(*) from public.org_people where import_batch_id is not null) as imported_rows,
       (select count(*) from public.import_batches where status='committed') as committed_batches;
