-- ===========================================================================
-- Taksyn migration -- supervisor scope enforced in the database
-- 11 September 2026
--
-- WHY
-- Supervisors were removed from incident visibility and limited to Low priority
-- tasks in the interface (main @ 8946795). Screen rules are not enforcement: a
-- direct API call met nothing. Measured on the sandbox, a supervisor could still
-- read AND update 6 incidents after the screens stopped showing any (CHK-DB-20);
-- after this migration, 0. A manager's 5 and a client admin's 16 were unchanged.
--
-- POLICIES
-- inc_select and inc_update drop 'supervisor' from the role test; incident
-- findings find_update does the same. Everything hanging off an incident
-- (actions, events, evidence, findings select, outcomes) gates on
-- EXISTS(incidents), so those closed with inc_select and needed no change.
--
-- Reporting is unaffected: create_incident is SECURITY DEFINER with its own
-- membership check. Proven on LIVE -- INC-2026-0017 was saved by a supervisor
-- after this ran. incident_transition is SECURITY INVOKER, so a supervisor is
-- refused by inc_select before its own role list matters; not changed here.
--
-- THE TASK TRIGGER
-- The tasks table's RLS is only "same org" for select/insert/update/delete, so
-- this trigger is the ONLY database protection for the Low-only rule.
--   supervisor : no insert above Low; no raising priority above Low; no setting
--                status approved or rejected on a non-Low task.
--   anyone     : no non-Low task with a supervisor as approver -- checked ONLY
--                on insert, or when priority or approver_id changes, so rows
--                that predate the rule can still be worked on and commented on.
--   auth.uid() null (cron, service role) passes untouched, or the nightly
--                missed-task capture would start failing.
--
-- VERIFIED on sandbox inside rolled-back blocks, nothing saved: 9 of 9
-- (CHK-DB-23a/b), including "comment on an old stuck task" ALLOWED and "raise
-- that same task to High" REFUSED.
--
-- SAFE TO RE-RUN.
-- Applied to SANDBOX and LIVE 11 Sep 2026. Trigger function fingerprint
-- 6f0ed272bc on both.
--
-- EMERGENCY OFF SWITCH, keeping the function:
--   alter table public.tasks disable trigger tasks_supervisor_scope_guard_trg;
-- and to check which state it is in:
--   select tgname, case tgenabled when 'O' then 'ON' when 'D' then 'OFF' end
--     from pg_trigger where tgname = 'tasks_supervisor_scope_guard_trg'
--      and not tgisinternal;
-- ===========================================================================

alter policy inc_select on public.incidents
  using ((my_role_in(org) = 'client_admin')
      OR (my_role_in(org) = 'manager'
          AND (assigned_to = auth.uid() OR investigator_id = auth.uid())));

alter policy inc_update on public.incidents
  using ((my_role_in(org) = 'client_admin')
      OR (my_role_in(org) = 'manager'
          AND (assigned_to = auth.uid() OR investigator_id = auth.uid())));

alter policy find_update on public.incident_findings
  using ((EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_findings.incident_id))
     AND (EXISTS (SELECT 1 FROM org_members om
                   WHERE om.user_id = auth.uid()
                     AND om.org = incident_findings.org
                     AND om.is_active IS TRUE
                     AND om.role = ANY (ARRAY['manager'::text, 'client_admin'::text]))))
  with check ((EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_findings.incident_id))
     AND (EXISTS (SELECT 1 FROM org_members om
                   WHERE om.user_id = auth.uid()
                     AND om.org = incident_findings.org
                     AND om.is_active IS TRUE
                     AND om.role = ANY (ARRAY['manager'::text, 'client_admin'::text]))));

create or replace function public.tasks_supervisor_scope_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare v_uid uuid := auth.uid(); v_org text; v_role text; v_appr text;
begin
  if v_uid is null then return new; end if;  -- system jobs and service calls pass
  select id into v_org from organisations where lower(name) = lower(new.org) limit 1;
  if v_org is null then return new; end if;
  v_role := my_role_in(v_org);
  if v_role = 'supervisor' then
    if tg_op = 'INSERT' and coalesce(new.priority,'') <> 'low' then
      raise exception 'Supervisors can only create Low priority tasks. Please contact your manager to create this task.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.priority is distinct from old.priority and coalesce(new.priority,'') <> 'low' then
      raise exception 'Supervisors cannot raise a task above Low priority.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved','rejected')
       and coalesce(new.priority,'') <> 'low' then
      raise exception 'Supervisors can only approve Low priority tasks.' using errcode = '42501';
    end if;
  end if;
  if coalesce(new.priority,'') <> 'low' and new.approver_id is not null
     and (tg_op = 'INSERT' or new.priority is distinct from old.priority or new.approver_id is distinct from old.approver_id) then
    select role into v_appr from org_members where user_id::text = new.approver_id::text and org = v_org;
    if v_appr = 'supervisor' then
      raise exception 'Tasks above Low priority need a manager or administrator as approver.' using errcode = '42501';
    end if;
  end if;
  return new;
end $f$;

drop trigger if exists tasks_supervisor_scope_guard_trg on public.tasks;
create trigger tasks_supervisor_scope_guard_trg before insert or update on public.tasks
  for each row execute function public.tasks_supervisor_scope_guard();
