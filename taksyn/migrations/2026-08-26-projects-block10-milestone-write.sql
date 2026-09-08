-- =====================================================================
-- Taksyn — Projects module, BLOCK 10: milestone write policies
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
-- Date: 26 August 2026
-- Requires: block 8 applied.
--
-- Block 8 gave project_milestones SELECT and UPDATE only, with the note:
-- "milestones are created by admins through a write path that does not
-- exist yet. Adding an INSERT policy before there is a guarded creation
-- path would open a hole ahead of the door."
--
-- The door now exists, so the policy goes in.
--
-- INSERT and DELETE both go to org admins, matching sections. A
-- milestone is structure, not a record of anything, until it is MET —
-- and once met it cannot be deleted, which the delete policy enforces
-- rather than leaving to the UI.
--
-- Deleting a met milestone would erase an attributed compliance
-- assertion: someone stated a stage was finished, with their name and a
-- timestamp on it. That is exactly the kind of thing an audit trail
-- exists to keep.
-- =====================================================================

\set ON_ERROR_STOP on
set client_min_messages = warning;

begin;

do $$
begin
  if exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose found. This looks like LIVE. Sandbox-only.';
  end if;
  if to_regclass('public.project_milestones') is null then
    raise exception 'ABORT: block 8 has not been applied.';
  end if;
end $$;

drop policy if exists project_milestones_insert on public.project_milestones;
create policy project_milestones_insert on public.project_milestones
  for insert to authenticated
  with check (public.is_org_admin(org) or public.is_super_admin());

-- Open milestones only. A met one is an attributed assertion and stays.
drop policy if exists project_milestones_delete on public.project_milestones;
create policy project_milestones_delete on public.project_milestones
  for delete to authenticated
  using (
    status <> 'met'
    and (public.is_org_admin(org) or public.is_super_admin())
  );

commit;


-- =====================================================================
-- PROOF
-- =====================================================================
set client_min_messages = notice;

-- M1 — a client_admin can create a milestone, and CANNOT delete one
-- that has been met. Rolled back.
begin;
select set_config('request.jwt.claims', json_build_object('sub',
  (select m.user_id::text from public.org_members m
   where m.org='ORG1990000000001' and m.role='client_admin'
     and m.user_id is not null and m.is_active is not false limit 1))::text, true);
set local role authenticated;

do $m1$
declare v_proj uuid; v_new uuid; v_met uuid; v_n integer;
begin
  select id into v_proj from public.projects where ref='PRJ-SAMPLE-0001';

  insert into public.project_milestones (org, project_id, name, due_date)
  values ('ORG1990000000001', v_proj, 'Block 10 test gate', current_date + 5)
  returning id into v_new;

  if v_new is null then
    raise exception 'PRJ-B10-M1 FAIL: insert produced no row';
  end if;
  raise notice 'PRJ-B10-M1 PASS: client_admin created a milestone';

  -- An OPEN milestone can be removed.
  delete from public.project_milestones where id = v_new;
  get diagnostics v_n = row_count;
  if v_n = 1 then
    raise notice 'PRJ-B10-M2 PASS: open milestone deleted';
  else
    raise exception 'PRJ-B10-M2 FAIL: expected 1 deleted, got %', v_n;
  end if;

  -- A MET one cannot.
  select id into v_met from public.project_milestones
   where project_id = v_proj and status = 'met' limit 1;
  if v_met is null then
    raise notice 'PRJ-B10-M3 SKIPPED: no met milestone to test against';
  else
    delete from public.project_milestones where id = v_met;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise notice 'PRJ-B10-M3 PASS: met milestone is not deletable';
    else
      raise exception 'PRJ-B10-M3 FAIL: deleted % met milestone(s)', v_n;
    end if;
  end if;
end $m1$;

reset role;
rollback;

-- M4 — a worker cannot create one.
begin;
select set_config('request.jwt.claims', json_build_object('sub',
  (select m.user_id::text from public.org_members m
   where m.org='ORG1990000000001' and m.role='worker'
     and m.user_id is not null and m.is_active is not false limit 1))::text, true);
set local role authenticated;

do $m4$
begin
  begin
    insert into public.project_milestones (org, project_id, name, due_date)
    select 'ORG1990000000001', id, 'worker should not', current_date + 5
    from public.projects where ref='PRJ-SAMPLE-0001';
    raise exception 'PRJ-B10-M4 FAIL: worker created a milestone';
  exception when insufficient_privilege then
    raise notice 'PRJ-B10-M4 PASS: worker refused by RLS';
  end;
end $m4$;

reset role;
rollback;

select 'PRJ-B10-POL' as marker, policyname, cmd
from pg_policies where schemaname='public' and tablename='project_milestones'
order by cmd;
