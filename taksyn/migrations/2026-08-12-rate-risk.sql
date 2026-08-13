-- ===========================================================================
-- Taksyn migration — incident_rate_risk()
-- 12 August 2026 (C-3c)
--
-- WHY
-- Both risk ratings saved through patchIncident, which recorded only the NEW
-- number. Revising a rating left two risk_rated events with no record of what
-- the figure had been or why it moved -- and the trajectory of a risk rating
-- is precisely what a regulator reads. "It was 12, now it is 4" is the story;
-- two disconnected numbers are not.
--
-- It also inherited patchIncident's silent-write problem: an RLS denial comes
-- back as HTTP 200 with error null and zero rows, so the client takes the
-- success branch and writes an event asserting a change that never happened.
--
-- RULING (Olaf, 12 Aug 2026)
-- The FIRST rating saves freely -- it is the initial assessment, not a
-- correction, and demanding "why" for it is nonsense. EVERY SUBSEQUENT CHANGE
-- requires a reason, with the same 10-character floor as every other edit
-- path written today. The function distinguishes the two by checking whether
-- a rating already exists.
--
-- ONE FUNCTION, BOTH RATINGS
-- p_kind selects initial or residual. They share every rule, every validation
-- and the same event shape; splitting them would mean maintaining one
-- behaviour in two places, which is how the incTasks bug fixed this morning
-- came about in the first place.
--
-- The residual GATE (an action must exist, or no_action_required ticked) is
-- deliberately NOT enforced here. It is a UI affordance about when the fields
-- appear, not a rule about what a valid record looks like, and a client_admin
-- correcting a residual figure on an old incident should not be blocked by
-- the state of its actions today.
--
-- risk_rated and residual_risk_rated are ALREADY in the event_type constraint.
-- ratings_edited was reserved in Migration 1 but is NOT used: keeping the
-- existing two event types means the timeline reads continuously across the
-- change rather than splitting one story into two vocabularies.
--
-- Sandbox first, then LIVE. CALL it before believing it.
-- ===========================================================================

create or replace function public.incident_rate_risk(
  p_incident_id  bigint,
  p_kind         text,     -- 'initial' | 'residual'
  p_likelihood   integer,
  p_consequence  integer,
  p_reason       text default null
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
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_rating   integer;
  v_old_l    integer;
  v_old_c    integer;
  v_old_r    integer;
  v_event    text;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  if p_kind not in ('initial','residual') then
    raise exception 'Unknown rating kind %.', p_kind using errcode = '22023';
  end if;

  select * into v_inc
  from public.incidents
  where id = p_incident_id
  for update;

  if not found then
    raise exception 'Incident % not found.', p_incident_id using errcode = 'P0002';
  end if;

  select p.name, p.role into v_name, v_role
  from public.profiles p where p.id = v_uid;

  if v_role is null then
    raise exception 'No profile for the calling user.' using errcode = '42501';
  end if;

  -- Both figures or neither. A likelihood without a consequence is not a
  -- rating, and storing half of one produces a null product that reads as
  -- "not rated" while looking on screen as though it was.
  if (p_likelihood is null) <> (p_consequence is null) then
    raise exception 'Give both a likelihood and a consequence, or neither.'
      using errcode = '22023';
  end if;

  if p_likelihood is not null then
    if p_likelihood < 1 or p_likelihood > 5 or p_consequence < 1 or p_consequence > 5 then
      raise exception 'Likelihood and consequence must each be between 1 and 5.'
        using errcode = '22023';
    end if;
    v_rating := p_likelihood * p_consequence;
  end if;

  if p_kind = 'initial' then
    v_old_l := v_inc.risk_likelihood;
    v_old_c := v_inc.risk_consequence;
    v_old_r := v_inc.risk_rating;
    v_event := 'risk_rated';
  else
    v_old_l := v_inc.residual_likelihood;
    v_old_c := v_inc.residual_consequence;
    v_old_r := v_inc.residual_rating;
    v_event := 'residual_risk_rated';
  end if;

  if v_old_l is not distinct from p_likelihood
     and v_old_c is not distinct from p_consequence then
    raise exception 'Nothing changed.' using errcode = '22023';
  end if;

  -- THE RULING. A first assessment needs no justification; changing a
  -- recorded judgement does.
  if v_old_r is not null and length(v_reason) < 10 then
    raise exception
      'This rating has already been recorded. Give a reason for changing it (at least 10 characters).'
      using errcode = '22023';
  end if;

  if p_kind = 'initial' then
    update public.incidents
       set risk_likelihood  = p_likelihood,
           risk_consequence = p_consequence,
           risk_rating      = v_rating,
           updated_at       = now()
     where id = p_incident_id
    returning * into v_inc;
  else
    update public.incidents
       set residual_likelihood  = p_likelihood,
           residual_consequence = p_consequence,
           residual_rating      = v_rating,
           updated_at           = now()
     where id = p_incident_id
    returning * into v_inc;
  end if;

  insert into public.incident_events (
    incident_id, org, event_type, by_id, by_name, by_role,
    from_value, to_value, details
  ) values (
    p_incident_id, v_inc.org, v_event, v_uid, v_name, v_role,
    case when v_old_r is null then null else v_old_r::text end,
    case when v_rating is null then null else v_rating::text end,
    jsonb_build_object(
      'likelihood',  p_likelihood,
      'consequence', p_consequence,
      'from', jsonb_build_object('likelihood', v_old_l, 'consequence', v_old_c, 'rating', v_old_r),
      'to',   jsonb_build_object('likelihood', p_likelihood, 'consequence', p_consequence, 'rating', v_rating))
      || case when v_old_r is null then '{}'::jsonb
              else jsonb_build_object('reason', v_reason) end
  );

  return v_inc;
end;
$$;

revoke all on function public.incident_rate_risk(bigint, text, integer, integer, text) from public;
revoke all on function public.incident_rate_risk(bigint, text, integer, integer, text) from anon;
grant execute on function public.incident_rate_risk(bigint, text, integer, integer, text) to authenticated;

comment on function public.incident_rate_risk(bigint, text, integer, integer, text) is
  'Record or revise an initial or residual risk rating. First rating saves '
  'freely; any later change needs a reason of at least 10 characters. Stores '
  'both sides so the trajectory is readable. Olaf ruling, 12 Aug 2026.';
