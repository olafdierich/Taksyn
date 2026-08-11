-- =====================================================================
-- Taksyn migration: org_custom_roles / org_custom_positions RLS
-- Closes findings F-A (no DELETE policy), F-B (no role clause),
-- F-C (UPDATE has no with_check -> cross-tenant repointing).
--
-- Decisions (Olaf, 11 Aug 2026):
--   * WRITE  = client_admin only (NOT manager -> is_org_admin() is unusable,
--              it grants ('client_admin','manager'); role clause is inline).
--   * DELETE = hard delete. No FKs reference these tables; they are picklist
--              sources consumed as text. Existing assignments keep their
--              string value and keep displaying. Delete = retire from picker.
--   * SELECT = UNCHANGED, bare org membership. Workers must keep reading the
--              picklist or every role/position dropdown in the app goes empty.
--   * is_active is not false (NOT "is true"): NULL means never-set, not
--              deactivated. Failing open on NULL is the correct direction for
--              an admin gate -- "is true" could silently lock out a live
--              client_admin whose row predates the column.
--
-- RUN ORDER: SANDBOX first, prove, then LIVE.
--   SANDBOX: psql ... -v ON_ERROR_STOP=1 -v expected_users=14 \
--                     -v env_label='SANDBOX buqlbmgxevuldahhdbxo' -P pager=off \
--                     -f 2026-08-11-org-custom-rls.sql
--   LIVE:    same, with -v expected_users=49 \
--                       -v env_label='LIVE yylvtvbhddcepilzwpaw'
--
-- The whole thing is ONE transaction. Any failed assertion rolls back
-- everything. Re-running is safe (drop policy if exists on both old and
-- new names).
-- =====================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------
-- PRE-01  Environment guard. Wrong env = abort before any DDL.
-- ---------------------------------------------------------------------
select set_config('taksyn.expected_users', :'expected_users', true);
select set_config('taksyn.env_label',      :'env_label',      true);

do $$
declare
  v_actual int := (select count(*) from auth.users);
  v_expect int := current_setting('taksyn.expected_users')::int;
begin
  if v_actual <> v_expect then
    raise exception
      'PRE-01 ABORT: env mismatch. Expected % auth users for "%", found %.',
      v_expect, current_setting('taksyn.env_label'), v_actual;
  end if;
  raise notice 'PRE-01 PASS | % | auth.users = %',
    current_setting('taksyn.env_label'), v_actual;
end $$;

-- ---------------------------------------------------------------------
-- PRE-02  Both tables exist and RLS is enabled.
-- ---------------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('org_custom_roles','org_custom_positions')
    and c.relrowsecurity;
  if v_n <> 2 then
    raise exception 'PRE-02 ABORT: expected 2 RLS-enabled tables, found %.', v_n;
  end if;
  raise notice 'PRE-02 PASS | RLS enabled on both tables';
end $$;

-- ---------------------------------------------------------------------
-- PRE-03  Row census. Recorded, not asserted -- SANDBOX has 0,
--         LIVE is expected to have 13 (Kemrose 10, Test Org 3).
--         These rows become DELETABLE for the first time after this
--         migration. Back them up on LIVE before running.
-- ---------------------------------------------------------------------
select 'PRE-03' as marker,
       (select count(*) from org_custom_roles)     as roles,
       (select count(*) from org_custom_positions) as positions;

-- ---------------------------------------------------------------------
-- DDL: org_custom_roles
-- SELECT policy is deliberately left in place and untouched.
-- ---------------------------------------------------------------------
drop policy if exists "Users can insert org custom roles in same org" on org_custom_roles;
drop policy if exists "Users can update org custom roles in same org" on org_custom_roles;
drop policy if exists "org_custom_roles_insert_ca" on org_custom_roles;
drop policy if exists "org_custom_roles_update_ca" on org_custom_roles;
drop policy if exists "org_custom_roles_delete_ca" on org_custom_roles;

create policy "org_custom_roles_insert_ca"
  on org_custom_roles
  for insert to authenticated
  with check (
    exists (
      select 1 from org_members om
      where om.user_id = auth.uid()
        and om.org     = org_custom_roles.organisation_id
        and om.is_active is not false
        and om.role    = 'client_admin'
    )
  );

create policy "org_custom_roles_update_ca"
  on org_custom_roles
  for update to authenticated
  using (
    exists (
      select 1 from org_members om
      where om.user_id = auth.uid()
        and om.org     = org_custom_roles.organisation_id
        and om.is_active is not false
        and om.role    = 'client_admin'
    )
  )
  with check (
    exists (
      select 1 from org_members om
      where om.user_id = auth.uid()
        and om.org     = org_custom_roles.organisation_id
        and om.is_active is not false
        and om.role    = 'client_admin'
    )
  );

create policy "org_custom_roles_delete_ca"
  on org_custom_roles
  for delete to authenticated
  using (
    exists (
      select 1 from org_members om
      where om.user_id = auth.uid()
        and om.org     = org_custom_roles.organisation_id
        and om.is_active is not false
        and om.role    = 'client_admin'
    )
  );

-- ---------------------------------------------------------------------
-- DDL: org_custom_positions
-- ---------------------------------------------------------------------
drop policy if exists "Users can insert org custom positions in same org" on org_custom_positions;
drop policy if exists "Users can update org custom positions in same org" on org_custom_positions;
drop policy if exists "org_custom_positions_insert_ca" on org_custom_positions;
drop policy if exists "org_custom_positions_update_ca" on org_custom_positions;
drop policy if exists "org_custom_positions_delete_ca" on org_custom_positions;

create policy "org_custom_positions_insert_ca"
  on org_custom_positions
  for insert to authenticated
  with check (
    exists (
      select 1 from org_members om
      where om.user_id = auth.uid()
        and om.org     = org_custom_positions.organisation_id
        and om.is_active is not false
        and om.role    = 'client_admin'
    )
  );

create policy "org_custom_positions_update_ca"
  on org_custom_positions
  for update to authenticated
  using (
    exists (
      select 1 from org_members om
      where om.user_id = auth.uid()
        and om.org     = org_custom_positions.organisation_id
        and om.is_active is not false
        and om.role    = 'client_admin'
    )
  )
  with check (
    exists (
      select 1 from org_members om
      where om.user_id = auth.uid()
        and om.org     = org_custom_positions.organisation_id
        and om.is_active is not false
        and om.role    = 'client_admin'
    )
  );

create policy "org_custom_positions_delete_ca"
  on org_custom_positions
  for delete to authenticated
  using (
    exists (
      select 1 from org_members om
      where om.user_id = auth.uid()
        and om.org     = org_custom_positions.organisation_id
        and om.is_active is not false
        and om.role    = 'client_admin'
    )
  );

-- ---------------------------------------------------------------------
-- POST-01  Exactly 4 policies per table: SELECT, INSERT, UPDATE, DELETE.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  v_n int;
begin
  foreach t in array array['org_custom_roles','org_custom_positions'] loop
    select count(*) into v_n from pg_policies
    where schemaname='public' and tablename=t;
    if v_n <> 4 then
      raise exception 'POST-01 ABORT: % has % policies, expected 4.', t, v_n;
    end if;
  end loop;
  raise notice 'POST-01 PASS | 4 policies on each table';
end $$;

-- ---------------------------------------------------------------------
-- POST-02  F-A closed: a DELETE policy now exists on both tables.
-- ---------------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_policies
  where schemaname='public'
    and tablename in ('org_custom_roles','org_custom_positions')
    and cmd = 'DELETE';
  if v_n <> 2 then
    raise exception 'POST-02 ABORT (F-A): expected 2 DELETE policies, found %.', v_n;
  end if;
  raise notice 'POST-02 PASS | F-A closed: DELETE policy present on both';
end $$;

-- ---------------------------------------------------------------------
-- POST-03  F-B closed: every write policy names client_admin.
--          SELECT is excluded on purpose -- it must stay open to members.
-- ---------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(tablename||'.'||policyname||' ('||cmd||')', ', ')
    into v_bad
  from pg_policies
  where schemaname='public'
    and tablename in ('org_custom_roles','org_custom_positions')
    and cmd <> 'SELECT'
    and coalesce(qual,'') || coalesce(with_check,'') not like '%client_admin%';
  if v_bad is not null then
    raise exception 'POST-03 ABORT (F-B): write policies without a role clause: %', v_bad;
  end if;
  raise notice 'POST-03 PASS | F-B closed: all write policies gated on client_admin';
end $$;

-- ---------------------------------------------------------------------
-- POST-04  F-C closed: both UPDATE policies carry a with_check.
-- ---------------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_policies
  where schemaname='public'
    and tablename in ('org_custom_roles','org_custom_positions')
    and cmd = 'UPDATE'
    and with_check is not null;
  if v_n <> 2 then
    raise exception 'POST-04 ABORT (F-C): expected 2 UPDATE policies with with_check, found %.', v_n;
  end if;
  raise notice 'POST-04 PASS | F-C closed: with_check present on both UPDATEs';
end $$;

-- ---------------------------------------------------------------------
-- POST-05  SELECT survived untouched -- guards against the failure mode
--          where tightening writes accidentally empties every dropdown.
-- ---------------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_policies
  where schemaname='public'
    and tablename in ('org_custom_roles','org_custom_positions')
    and cmd='SELECT'
    and qual like '%org_members%'
    and qual not like '%client_admin%';
  if v_n <> 2 then
    raise exception 'POST-05 ABORT: SELECT policies altered or missing (found %). Read access must stay open to all org members.', v_n;
  end if;
  raise notice 'POST-05 PASS | SELECT unchanged, read access intact';
end $$;

-- ---------------------------------------------------------------------
-- POST-06  Final visible state.
-- ---------------------------------------------------------------------
select 'POST-06' as marker, tablename, cmd, policyname,
       (with_check is not null) as has_with_check,
       (coalesce(qual,'')||coalesce(with_check,'') like '%client_admin%') as gated
from pg_policies
where schemaname='public'
  and tablename in ('org_custom_roles','org_custom_positions')
order by tablename, cmd, policyname;

commit;

-- =====================================================================
-- NOT CLOSED BY THIS MIGRATION -- app-side work still outstanding:
--   * Handlers at App.jsx ~9506 / 9511 / 9534 / 9539 discard the
--     PostgREST result. RLS denial returns 200 with error: null and a
--     ZERO-ROW body. Until those call sites use .select() and check the
--     returned rows, a denied write STILL reports success in the UI --
--     the same silent-write pattern, now failing for non-admins.
--   * An in-use warning before delete (name may be carried as text by
--     staff, tasks, checklist_templates, invite_links) is a UX nicety,
--     not a data-integrity requirement.
-- =====================================================================
