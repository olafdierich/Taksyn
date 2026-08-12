-- ===========================================================================
-- Taksyn migration — incident_edit_narrative()
-- 12 August 2026
--
-- WHY
-- The three narrative fields (facts, immediate_actions, root_cause) had no
-- edit path at all, and the one save that existed -- root_cause via
-- patchIncident -- recorded only THAT a root cause was saved, never what it
-- said or what it replaced. Editing overwrote history with no trace.
--
-- It also could not be trusted. patchIncident tests only `upErr`; it has no
-- .select() and no rows-returned check, so an RLS denial (HTTP 200, error
-- null, zero rows) takes the success branch, writes an event claiming the
-- change, and updates the UI. An event asserting a change that never happened
-- is the worst failure available on an append-only audit spine.
--
-- This function replaces that path for narrative edits: update and event in
-- ONE transaction, server-side, returning the updated row so the client knows
-- whether it actually worked.
--
-- RULINGS ENCODED HERE (Olaf, 12 Aug 2026 -- do not reverse without a new one)
--   1. Editing NEVER stops. No cutoff at close, none at verification.
--      Corrections surface after closure; blocking them drives people to keep
--      the real record somewhere else.
--   2. Verification required. Every edit carries a reason, enforced here and
--      not in the UI, with a length floor so it cannot be satisfied by "x".
--   3. Authority is status-dependent. Any authenticated member of the org may
--      edit while the incident is open; once closed, client_admin only. A
--      post-closure amendment is a deliberate, higher-authority act.
--   4. Both sides stored in full. from and to for every changed field, in
--      details. A self-contained event row is far easier to defend than
--      reconstructing history by replaying a chain that a single lost row
--      would break.
--
-- DEPENDS ON 2026-08-12-event-type-check.sql, which must be applied first --
-- 'narrative_edited' is in that constraint's enumeration.
-- ===========================================================================

create or replace function public.incident_edit_narrative(
  p_incident_id bigint,
  p_facts       text,
  p_immediate   text,
  p_root_cause  text,
  p_reason      text
) returns public.incidents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inc      public.incidents;
  v_uid      uuid := auth.uid();
  v_name     text;
  v_role     text;
  v_org      text;
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_facts    text := btrim(coalesce(p_facts, ''));
  v_imm      text := nullif(btrim(coalesce(p_immediate, '')), '');
  v_root     text := nullif(btrim(coalesce(p_root_cause, '')), '');
  v_changes  jsonb := '{}'::jsonb;
  v_fields   text[] := array[]::text[];
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  -- Lock the row for the duration: two people editing the same narrative
  -- must serialise, or the second event records a "from" that was already
  -- superseded and the trail reads as though a change never happened.
  select * into v_inc
  from public.incidents
  where id = p_incident_id
  for update;

  if not found then
    raise exception 'Incident % not found.', p_incident_id using errcode = 'P0002';
  end if;

  -- Caller identity, read server-side. Never passed in by the client.
  select p.name, p.role, p.org
    into v_name, v_role, v_org
  from public.profiles p
  where p.id = v_uid;

  if v_role is null then
    raise exception 'No profile for the calling user.' using errcode = '42501';
  end if;

  -- RULING 3 -- authority depends on status.
  if v_inc.status = 'closed' and v_role <> 'client_admin' then
    raise exception
      'This incident is closed. Only a client admin may amend a closed record.'
      using errcode = '42501';
  end if;

  -- RULING 2 -- the reason is mandatory, with a floor.
  if length(v_reason) < 10 then
    raise exception
      'Give a reason for this edit (at least 10 characters). It is recorded in the audit trail.'
      using errcode = '22023';
  end if;

  -- facts is NOT NULL on the table and is the account of what happened.
  -- Refuse to blank it rather than let the constraint produce a worse message.
  if v_facts = '' then
    raise exception 'What happened cannot be left empty.' using errcode = '22023';
  end if;

  -- RULING 4 -- record both sides of every field that actually changed.
  if v_facts is distinct from v_inc.facts then
    v_fields  := v_fields || 'facts';
    v_changes := v_changes || jsonb_build_object(
      'facts', jsonb_build_object('from', v_inc.facts, 'to', v_facts));
  end if;

  if v_imm is distinct from v_inc.immediate_actions then
    v_fields  := v_fields || 'immediate_actions';
    v_changes := v_changes || jsonb_build_object(
      'immediate_actions', jsonb_build_object('from', v_inc.immediate_actions, 'to', v_imm));
  end if;

  if v_root is distinct from v_inc.root_cause then
    v_fields  := v_fields || 'root_cause';
    v_changes := v_changes || jsonb_build_object(
      'root_cause', jsonb_build_object('from', v_inc.root_cause, 'to', v_root));
  end if;

  -- Nothing changed: raise rather than write an event that asserts an edit
  -- which did not happen. A log full of empty edits is a log nobody reads.
  if array_length(v_fields, 1) is null then
    raise exception 'Nothing changed.' using errcode = '22023';
  end if;

  update public.incidents
     set facts             = v_facts,
         immediate_actions = v_imm,
         root_cause        = v_root,
         updated_at        = now()
   where id = p_incident_id
  returning * into v_inc;

  insert into public.incident_events (
    incident_id, org, event_type, by_id, by_name, by_role,
    from_value, to_value, details
  ) values (
    p_incident_id, v_inc.org, 'narrative_edited', v_uid, v_name, v_role,
    array_to_string(v_fields, ','),   -- which fields changed
    v_reason,                          -- the reason, visible without opening details
    jsonb_build_object('reason', v_reason, 'changes', v_changes)
  );

  return v_inc;
end;
$$;

-- The function is SECURITY DEFINER, so PUBLIC must not hold execute.
-- REVOKE FROM PUBLIC alone is insufficient on Supabase -- revoke per role.
revoke all on function public.incident_edit_narrative(bigint, text, text, text, text) from public;
revoke all on function public.incident_edit_narrative(bigint, text, text, text, text) from anon;
grant execute on function public.incident_edit_narrative(bigint, text, text, text, text) to authenticated;

comment on function public.incident_edit_narrative(bigint, text, text, text, text) is
  'Edit the three narrative fields with a mandatory reason. Update and audit '
  'event in one transaction. Any org member while open; client_admin only once '
  'closed. Records both sides of every changed field. Olaf rulings, 12 Aug 2026.';
