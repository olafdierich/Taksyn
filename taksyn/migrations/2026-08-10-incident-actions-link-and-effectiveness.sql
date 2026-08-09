-- migrations/2026-08-10-incident-actions-link-and-effectiveness.sql
--
-- Step 6. Two things the design calls for and the schema does not have:
--
--   1. incident_actions.task_id is text and nullable with NO FOREIGN KEY. The
--      decision of 8 Aug is that corrective actions ARE real rows in tasks, so
--      the link should be enforced rather than conventional.
--
--   2. Per-action effectiveness assessment (decision (c), 9 Aug): effectiveness
--      belongs on incident_actions, NOT as a third section of incident_findings.
--      A finding is a question with a state; an effectiveness assessment is a
--      judgement about a specific action that already has a row and a task link.
--
-- RECONCILED AGAINST THE REAL SCHEMA FIRST:
--   tasks.id      is TEXT ('T1784253311504'), same convention as ORG ids.
--   task_id       is TEXT. No cast needed.
--   LIVE:    5 actions, 3 linked, ALL THREE RESOLVE (in_progress/approved/pending).
--   SANDBOX: 1 action,  1 linked, 0 orphans.
-- The FK will validate cleanly on both. Had any link not resolved, that row
-- would have needed a decision, not a fix.
--
-- ON DELETE SET NULL (Olaf, 10 Aug). Not CASCADE -- deleting a task must never
-- silently erase a corrective action, which is a compliance record. Not RESTRICT
-- -- that makes task deletion fail somewhere the user cannot see why. SET NULL
-- leaves the action present with a visible gap where its task used to be.
--
-- Note incident_evidence uses CASCADE against incidents, which is correct there:
-- evidence is a CHILD of the incident. tasks is a PEER of incident_actions, not
-- a parent, so the same rule does not apply.

begin;

-- ---------------------------------------------------------------------------
-- 1. The foreign key
-- ---------------------------------------------------------------------------
-- Index first. An FK without one makes every task delete a sequential scan of
-- incident_actions to check the constraint.

create index if not exists incident_actions_task_id_idx
  on public.incident_actions (task_id);

alter table public.incident_actions
  drop constraint if exists incident_actions_task_id_fkey;

alter table public.incident_actions
  add constraint incident_actions_task_id_fkey
  foreign key (task_id) references public.tasks(id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Effectiveness assessment
-- ---------------------------------------------------------------------------
-- Design section 5: step 4 is complete when every linked task is closed AND
-- effectiveness has been assessed. The first half is already derivable from
-- task status via the existing CAPA reconcile; this is the second half.
--
-- Nullable throughout: an action that has not yet been assessed is a normal
-- state, not an error.

alter table public.incident_actions
  add column if not exists effectiveness         text,
  add column if not exists effectiveness_at      timestamptz,
  add column if not exists effectiveness_by      uuid,
  add column if not exists effectiveness_by_name text;

-- ---------------------------------------------------------------------------
-- 3. Attribution -- DELIBERATELY NARROW
-- ---------------------------------------------------------------------------
-- THIS TRIGGER MUST NOT TOUCH verified_by OR verified_at.
--
-- Those are written by the CAPA reconcile (App.jsx ~15848) from the LINKED
-- TASK'S APPROVER -- t.approver_id and t.reviewed_at -- not from the session
-- user. That is correct and deliberate: the person who approved the task is the
-- person who verified the action. A blanket attribution trigger of the kind
-- used on incident_evidence and incident_findings would overwrite them with
-- auth.uid() and destroy that meaning.
--
-- So this trigger fires on the effectiveness columns ONLY, and only when the
-- effectiveness text actually changes. When it is untouched, the prior
-- attribution is carried forward verbatim -- otherwise a client could blank the
-- author while leaving the assessment text in place.
--
-- Clearing the text clears the attribution with it, so a blanked assessment
-- cannot leave a stale author behind.

create or replace function public.incident_actions_effectiveness_attribution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid;
  v_name text;
  v_set  boolean;
begin
  if TG_OP = 'INSERT' then
    v_set := new.effectiveness is not null and btrim(new.effectiveness) <> '';
  else
    -- Untouched: carry the existing attribution forward and return early.
    if new.effectiveness is not distinct from old.effectiveness then
      new.effectiveness_by      := old.effectiveness_by;
      new.effectiveness_at      := old.effectiveness_at;
      new.effectiveness_by_name := old.effectiveness_by_name;
      return new;
    end if;
    v_set := new.effectiveness is not null and btrim(new.effectiveness) <> '';
  end if;

  if not v_set then
    new.effectiveness         := null;
    new.effectiveness_by      := null;
    new.effectiveness_at      := null;
    new.effectiveness_by_name := null;
    return new;
  end if;

  v_uid := auth.uid();
  new.effectiveness_by := v_uid;
  new.effectiveness_at := now();

  -- Best-effort name, consistent with the other attribution triggers: an
  -- unresolvable actor leaves the name null rather than blocking the write.
  if v_uid is not null then
    select p.name into v_name from public.profiles p where p.id = v_uid;
  end if;
  new.effectiveness_by_name := v_name;

  return new;
end;
$$;

drop trigger if exists incident_actions_effectiveness_biu on public.incident_actions;

create trigger incident_actions_effectiveness_biu
  before insert or update on public.incident_actions
  for each row
  execute function public.incident_actions_effectiveness_attribution();

commit;

-- ===========================================================================
-- VERIFICATION (run separately, after commit):
--
-- select 'CHK-T5' as marker, (select count(*) from auth.users) as env,
--        (select count(*) from pg_constraint
--          where conname = 'incident_actions_task_id_fkey') as fk,
--        (select confdeltype from pg_constraint
--          where conname = 'incident_actions_task_id_fkey') as on_delete,
--        (select count(*) from information_schema.columns
--          where table_name='incident_actions' and column_name like 'effectiveness%') as eff_cols,
--        (select count(*) from pg_trigger
--          where tgrelid='public.incident_actions'::regclass and not tgisinternal) as triggers;
--
-- Expect fk 1, on_delete 'n' (SET NULL), eff_cols 4, triggers 1.
-- confdeltype codes: a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL, d=SET DEFAULT.
--
-- NEGATIVE CONTROL (sandbox only, inside begin/rollback):
--
--   begin;
--   savepoint s1;
--   update public.incident_actions set task_id = 'T_DOES_NOT_EXIST' where id = (select min(id) from public.incident_actions);
--   rollback to s1;   -- expect 23503 foreign key violation
--   rollback;
--
-- ===========================================================================
-- OPEN FINDING, NOT ADDRESSED HERE: incident_actions.status has NO CHECK
-- constraint, the same defect class as incidents.status before 8 Aug. The CAPA
-- reconcile treats ('completed','done','verified') as terminal and writes
-- 'completed'. Three synonyms for one state is a vocabulary that was never
-- decided. Reconstruct it from the data before constraining it:
--
--   select status, count(*) from public.incident_actions group by status order by 2 desc;
-- ===========================================================================
