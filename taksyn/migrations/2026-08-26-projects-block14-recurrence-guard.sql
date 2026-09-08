-- =====================================================================
-- Taksyn — Projects module, BLOCK 14: recurring tasks cannot join a chain
-- RUN ON BOTH: sandbox buqlbmgxevuldahhdbxo AND live yylvtvbhddcepilzwpaw
--
-- WHY
-- A recurring task has no finish. recompute_project_dates asks "when
-- did this stage finish" and answers from completed_at or the due date —
-- neither of which means anything for a daily water check, which is
-- never done, only done again.
--
-- The task form does not offer recurrence, so the UI has been safe. But
-- that is a convention held in one component, and public.tasks has four
-- other write paths plus whatever comes next. A constraint holds it
-- everywhere, including against a bulk import or a hand-written UPDATE.
--
-- THE RULE
-- A task with a section_id must be one-off. Recurring tasks may still
-- carry project_id — belonging to a project for reporting is fine, and
-- a daily check that is part of an audit programme genuinely does. What
-- they cannot do is sit in a STAGE, because stages are what
-- dependencies link and what propagation walks.
--
-- NULL COUNTS AS ONE-OFF. recurrence is nullable and its default is
-- 'once'; treating null as recurring would reject legitimate rows.
--
-- SAFE TO ADD: measured 0 recurring tasks in a stage on sandbox before
-- writing this. The constraint validates existing rows on creation, so
-- it would fail loudly rather than silently if that were wrong — which
-- is the behaviour wanted.
-- =====================================================================

\set ON_ERROR_STOP on
set client_min_messages = warning;

begin;

-- Fail before altering anything if the assumption does not hold here.
-- The ALTER would fail anyway, but this says why.
do $$
declare v_bad integer;
begin
  select count(*) into v_bad from public.tasks
  where section_id is not null and coalesce(recurrence,'once') <> 'once';
  if v_bad > 0 then
    raise exception
      'ABORT: % recurring task(s) already sit in a stage. They must be made one-off or moved out of their stage before this constraint can be added.', v_bad;
  end if;
end $$;

alter table public.tasks
  add constraint tasks_stage_requires_one_off
  check (section_id is null or coalesce(recurrence,'once') = 'once');

comment on constraint tasks_stage_requires_one_off on public.tasks is
  'A recurring task has no finish, so it cannot be a node in a dependency chain. It may still carry project_id — belonging to a project for reporting is fine — but not section_id.';

commit;


-- =====================================================================
-- PROOF — the constraint must REFUSE, and refusing is the pass.
-- =====================================================================
set client_min_messages = notice;

do $p$
declare v_org text; v_sec uuid;
begin
  select org into v_org from public.tasks limit 1;
  select id into v_sec from public.project_sections where parent_id is not null limit 1;

  if v_sec is null then
    raise notice 'B14-01 SKIPPED: no stages exist here to test against';
    return;
  end if;

  begin
    insert into public.tasks (id, title, org, status, due_date, section_id, recurrence)
    values ('B14_TEST', 'should be refused', v_org, 'pending', current_date + 7, v_sec, 'daily');
    delete from public.tasks where id = 'B14_TEST';
    raise exception 'B14-01 FAIL: a daily task was accepted into a stage';
  exception
    when check_violation then
      raise notice 'B14-01 PASS: recurring task refused from a stage';
  end;

  -- A recurring task with no stage is still fine.
  begin
    insert into public.tasks (id, title, org, status, due_date, recurrence)
    values ('B14_TEST2', 'recurring, no stage', v_org, 'pending', current_date + 7, 'daily');
    delete from public.tasks where id = 'B14_TEST2';
    raise notice 'B14-02 PASS: recurring task outside a stage still allowed';
  exception when others then
    raise exception 'B14-02 FAIL: the constraint is too broad — %', sqlerrm;
  end;
end $p$;

select 'B14-POL' as marker, conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid='public.tasks'::regclass and conname='tasks_stage_requires_one_off';
