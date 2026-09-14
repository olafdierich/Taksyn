-- ===========================================================================
-- Taksyn migration -- incident_add_outcome, recorded and reconciled
-- 14 September 2026
--
-- WHY THIS FILE EXISTS
-- The two databases held versions of this function with different fingerprints
-- (sandbox a61f3164e4, LIVE 1789df3355), which looked like drift. Compared line
-- by line they are behaviourally IDENTICAL: every check, message and insert is
-- the same. The difference is blank lines and one stray "--" comment line --
-- four characters. Recorded here so nobody investigates it a second time.
--
-- The text below is LIVE's, taken as the reference because production is the
-- reference, and applied to the sandbox so the two now match.
--
-- WHAT THE FUNCTION GUARDS
-- It is SECURITY DEFINER, so RLS does not apply inside it and it must check the
-- caller itself. It does, on four counts:
--   * a signed-in user is required;
--   * the role is read with my_role_in(incident org) -- per organisation, not
--     the global profiles.role that went stale elsewhere -- and must be
--     client_admin or manager;
--   * a closed incident is refused, mirroring inc_out_insert rather than
--     relying on it, with the reason stated in the code;
--   * the outcome must belong to the ladder for THIS incident's category,
--     resolved by the incident's own industry, with a coalesce for incidents
--     recorded before industry_id existed.
--
-- NOTHING ABOUT ITS BEHAVIOUR CHANGED on either database. This migration makes
-- the text the same in both places and puts it in the repo, which it never was.
--
-- SAFE TO RE-RUN. CREATE OR REPLACE only; no data touched.
--
-- VERIFY BY THE CODE, NOT THE RAW TEXT
-- md5(prosrc) is worthless for this function: the databases and this file each
-- lay the same code out slightly differently (blank lines, one stray "--"), so
-- the raw fingerprint has already been three different values -- 1789df3355,
-- a61f3164e4, 95f57dccd3 -- for code that never changed. Strip comments and
-- collapse whitespace first and all three agree:
--
--   code fingerprint  41f755701b
--
-- select left(md5(regexp_replace(regexp_replace(prosrc, '--[^\n]*', '', 'g'),
--                                '\s+', ' ', 'g')), 10)
--   from pg_proc where oid = 'public.incident_add_outcome'::regproc;
--
-- That is the check to run. Where a file was generated straight from the
-- database -- 2026-09-11-incident-authority-fixes.sql -- the raw fingerprint IS
-- reliable and is recorded there. Hand-laid-out files like this one are not.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.incident_add_outcome(p_incident_id bigint, p_outcome_key text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS incident_outcomes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inc  public.incidents;
  v_uid  uuid := auth.uid();
  v_name text;
  v_role text;
  v_lad  text;
  v_rung public.incident_outcome_ladders;
  v_seq  int;
  v_row  public.incident_outcomes;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception 'Incident % not found.', p_incident_id using errcode = 'P0002';
  end if;

  select name into v_name from public.profiles where id = v_uid;
  v_role := public.my_role_in(v_inc.org);
  if v_role is null or v_role not in ('client_admin','manager') then
    raise exception 'Only a client admin or manager may add an outcome.'
      using errcode = '42501';
  end if;

  -- Mirrors the inc_out_insert policy rather than relying on it: this
  -- function is SECURITY DEFINER and bypasses RLS entirely.
  if v_inc.status = 'closed' then
    raise exception 'This incident is closed. Reopen it before adding an outcome.'
      using errcode = '42501';
  end if;

  -- Which ladder this incident's category uses. Pack first, org-defined
  -- category second -- the same order create_incident resolves the domain.
  -- IND: scoped to the INCIDENT's industry, not the org's. The coalesce
  -- covers incidents recorded before industry_id existed, which resolve
  -- through their org exactly as they did before.
  select p.ladder_key into v_lad
    from public.incident_category_packs p
   where p.category_key = v_inc.category
     and p.industry_id  = coalesce(
           v_inc.industry_id,
           (select g.industry_id from public.organisations g where g.id = v_inc.org))
     and p.source = 'category'
   limit 1;
  if v_lad is null then
    select ladder_key into v_lad
      from public.org_incident_categories
     where category_key = v_inc.category
       and org = v_inc.org
       and overrides_key is null
     limit 1;
  end if;
  if v_lad is null then
    raise exception 'No outcome ladder is set up for this category.'
      using errcode = '22023';
  end if;

  select * into v_rung
    from public.incident_outcome_ladders
   where ladder_key = v_lad
     and outcome_key = p_outcome_key
     and is_active
   limit 1;
  if not found then
    raise exception 'That outcome does not belong to this incident''s ladder.'
      using errcode = '22023';
  end if;

  -- Appended, so seq reflects the order outcomes were RECORDED.
  select coalesce(max(seq), 0) + 1 into v_seq
    from public.incident_outcomes
   where incident_id = p_incident_id;

  insert into public.incident_outcomes
    (incident_id, org, outcome_key, outcome_label, suggested_severity,
     seq, occurred_at, recorded_by, recorded_by_name)
  values
    (p_incident_id, v_inc.org, v_rung.outcome_key, v_rung.label,
     v_rung.suggested_severity, v_seq,
     coalesce(p_occurred_at, now()), v_uid, v_name)
  returning * into v_row;

  insert into public.incident_events
    (incident_id, org, event_type, by_id, by_name, by_role, to_value, details)
  values
    (p_incident_id, v_inc.org, 'outcome_added', v_uid, v_name, v_role,
     v_rung.label,
     jsonb_build_object('outcome_key', v_rung.outcome_key,
                        'occurred_at', coalesce(p_occurred_at, now()),
                        'seq', v_seq));

  update public.incidents set updated_at = now() where id = p_incident_id;
  return v_row;
end;
$function$
;
