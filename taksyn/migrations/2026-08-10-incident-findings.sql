-- migrations/2026-08-10-incident-findings.sql
--
-- Step 4b. One child table serving BOTH the investigation section and the RCA
-- section (step 5), so step 5 becomes seeding five more item_key values rather
-- than a second build. jsonb would have been quicker but makes trend reporting
-- impractical, and trend reporting is the point of a compliance product.
--
-- DECISIONS THIS IMPLEMENTS (all taken 9-10 Aug, recorded in handover v27):
--
--   (a) Investigation items get THREE STATES, not a tickbox -- same argument the
--       design makes for RCA: "we tried to collect statements and none existed"
--       and "we never tried" must not be the same row. But DIFFERENT vocabulary
--       per section, hence a section-keyed CHECK rather than one flat list.
--
--   (b) Rows are SEEDED ON ENTRY TO investigating, inside incident_transition().
--       Not upfront at creation (which would put 8 rows on every incident
--       including the ones ticked no_action_required, and need a backfill of
--       everything), and not on first edit (which makes the completion predicate
--       a count against a reference list that breaks when the list changes).
--       Seeding at the transition PINS THE ITEM SET at the moment investigation
--       opened, so adding a ninth prompt next year does not retroactively
--       rewrite a 2026 investigation. That is what an auditor wants.
--
--   (B) The seeder is a SECURITY DEFINER function and there is NO INSERT POLICY
--       for authenticated. Rows can only come into existence through seeding.
--       This makes "the item set is pinned" ENFORCEABLE rather than
--       conventional -- nobody can add a ninth finding to an old investigation,
--       because nobody can insert at all.
--
-- WHY THE SEEDER IS A SEPARATE FUNCTION: incident_transition() is SECURITY
-- INVOKER, deliberately -- "select * into v_inc from incidents" relies on the
-- caller's RLS, which is what makes its "Incident not found or not visible"
-- check true. Making it DEFINER would break that. So the seeding insert cannot
-- live directly inside it without an INSERT policy that would also let any
-- supervisor create arbitrary findings rows via the API.
--
-- IDEMPOTENCY IS REQUIRED, NOT OPTIONAL. A reverse to assessing and forward
-- again re-enters investigating and would re-seed. Unique constraint on
-- (incident_id, section, item_key) plus ON CONFLICT DO NOTHING means a
-- reverse-then-forward cannot wipe or duplicate an investigator's work.

begin;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table if not exists public.incident_findings (
  id          bigint generated always as identity primary key,
  incident_id bigint not null references public.incidents(id) on delete cascade,
  org         text   not null,
  section     text   not null,
  item_key    text   not null,
  sort_order  int    not null default 0,
  state       text   not null,
  comment     text,
  by_id       uuid,
  by_name     text,
  by_role     text,
  at          timestamptz not null default now(),

  constraint incident_findings_section_chk
    check (section in ('investigation','rca')),

  -- Section-keyed vocabulary. Same cardinality so the UI control is one
  -- component, different words so the stored record is truthful.
  constraint incident_findings_state_chk check (
       (section = 'investigation' and state in ('not_examined','not_applicable','done'))
    or (section = 'rca'           and state in ('not_examined','not_a_factor','contributing'))
  ),

  -- Design section 3: free text is REQUIRED when an RCA factor is marked
  -- contributing. Optional when ruled out, n/a when not examined.
  constraint incident_findings_contributing_needs_comment check (
    not (section = 'rca' and state = 'contributing'
         and (comment is null or btrim(comment) = ''))
  ),

  constraint incident_findings_unique_item
    unique (incident_id, section, item_key)
);

create index if not exists incident_findings_incident_section_idx
  on public.incident_findings (incident_id, section, sort_order);

-- Trend reporting reads by org and state across incidents.
create index if not exists incident_findings_org_section_state_idx
  on public.incident_findings (org, section, state);

-- ---------------------------------------------------------------------------
-- 2. Attribution trigger -- same pattern as incident_evidence
-- ---------------------------------------------------------------------------
-- org from the parent, actor from the session. Fires on UPDATE as well as
-- INSERT, because for findings the question "who last set this state" is the
-- audit-relevant one, not "who created the empty row".
--
-- by_role reads org_members.role (PER-ORG), not profiles.role (GLOBAL).
-- patchIncident writes by_role from profiles.role and is wrong for exactly this
-- reason (open finding). This does not repeat that defect.
--
-- NOTE ON is_active: this uses "is true". There are now FOUR variants across
-- the codebase -- storage policies use "= true", incident_transition uses
-- "is not false" (permits null), create_incident applies no filter at all, and
-- this uses "is true". org_members.is_active is NULLABLE. That inconsistency is
-- a real open finding and is NOT resolved here; this file only avoids adding a
-- fifth variant, matching the incident_evidence trigger.

create or replace function public.incident_findings_attribution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  text;
  v_uid  uuid;
  v_role text;
  v_name text;
begin
  select i.org into v_org
  from public.incidents i
  where i.id = new.incident_id;

  if v_org is null then
    raise exception 'Incident % not found -- finding cannot be recorded', new.incident_id
      using errcode = '23503';
  end if;

  new.org := v_org;
  new.at  := now();

  v_uid := auth.uid();
  new.by_id := v_uid;

  -- Best-effort attribution: by_id / by_name / by_role are nullable, so an
  -- unresolvable actor leaves them null rather than blocking the write. Never a
  -- stale or borrowed value. The seeder runs as the transitioning user, so
  -- seeded rows carry that person -- which is correct: they opened the
  -- investigation.
  if v_uid is not null then
    select om.role into v_role
    from public.org_members om
    where om.user_id = v_uid
      and om.org = v_org
      and om.is_active is true
    limit 1;

    select p.name into v_name
    from public.profiles p
    where p.id = v_uid;
  end if;

  new.by_role := v_role;
  new.by_name := v_name;

  return new;
end;
$$;

drop trigger if exists incident_findings_attribution_biu on public.incident_findings;

create trigger incident_findings_attribution_biu
  before insert or update on public.incident_findings
  for each row
  execute function public.incident_findings_attribution();

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
-- SELECT and UPDATE only. NO INSERT policy and NO DELETE policy for
-- authenticated -- see decision (B) above. Rows arrive only via the seeder;
-- they are never removed except by the incidents FK cascade.
--
-- Scoping mirrors incident_evidence: the EXISTS subquery against incidents is
-- itself subject to incidents' RLS when run as authenticated, so visibility is
-- transitive. That was PROVEN by probe on 9 Aug, not assumed from policy text:
-- a worker who cannot see any incident was denied 42501 on the child table.

alter table public.incident_findings enable row level security;

drop policy if exists find_select on public.incident_findings;
create policy find_select on public.incident_findings
  for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_findings.incident_id));

-- UPDATE additionally requires a role that may work an investigation. Without
-- this clause any member who can SEE an incident could answer its findings.
--
-- DELIBERATELY LOOSER THAN incident_transition, WHICH ALSO REQUIRES THE CALLER
-- TO BE THE ASSIGNED HANDLER OR INVESTIGATOR. Rationale: advancing a step is a
-- decision, filling in a finding is work, and an investigation may legitimately
-- draw on several people. If that turns out to be wrong for Kemrose the fix is
-- to add "and (i.assigned_to = auth.uid() or i.investigator_id = auth.uid()
-- or role = client_admin)" to both USING and WITH CHECK. FLAGGED FOR REVIEW.
drop policy if exists find_update on public.incident_findings;
create policy find_update on public.incident_findings
  for update to authenticated
  using (
    exists (select 1 from public.incidents i where i.id = incident_findings.incident_id)
    and exists (
      select 1 from public.org_members om
       where om.user_id = auth.uid()
         and om.org = incident_findings.org
         and om.is_active is true
         and om.role in ('supervisor','manager','client_admin'))
  )
  with check (
    exists (select 1 from public.incidents i where i.id = incident_findings.incident_id)
    and exists (
      select 1 from public.org_members om
       where om.user_id = auth.uid()
         and om.org = incident_findings.org
         and om.is_active is true
         and om.role in ('supervisor','manager','client_admin'))
  );

-- ---------------------------------------------------------------------------
-- 4. The seeder
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can insert where authenticated has no INSERT policy.
-- Item text comes from the design document verbatim; item_key is a stable
-- machine key so trend reporting can group across orgs and the display label
-- can be reworded without orphaning history.
--
-- BOTH sections are seeded together. Step 5 (RCA) therefore needs NO further
-- migration -- the rows are already there, it is a UI build only.

create or replace function public.seed_incident_findings(p_incident_id bigint)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org     text;
  v_seeded  int;
begin
  select i.org into v_org from public.incidents i where i.id = p_incident_id;
  if v_org is null then
    raise exception 'Incident % not found', p_incident_id using errcode = 'P0002';
  end if;

  with items(section, item_key, sort_order) as (
    values
      -- Design section 2 -- investigation items
      ('investigation', 'collect_statements',             1),
      ('investigation', 'review_records',                 2),
      ('investigation', 'determine_contributing_factors', 3),
      -- Design section 3 -- the five RCA factors
      ('rca',           'human_factors',                  1),
      ('rca',           'equipment_failure',              2),
      ('rca',           'process_failure',                3),
      ('rca',           'environmental_factors',          4),
      ('rca',           'training_deficiencies',          5)
  )
  insert into public.incident_findings (incident_id, org, section, item_key, sort_order, state)
  select p_incident_id, v_org, i.section, i.item_key, i.sort_order, 'not_examined'
  from items i
  on conflict (incident_id, section, item_key) do nothing;

  get diagnostics v_seeded = row_count;
  return v_seeded;
end;
$$;

revoke all on function public.seed_incident_findings(bigint) from public;
grant execute on function public.seed_incident_findings(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Hook into incident_transition
-- ---------------------------------------------------------------------------
-- ONE LINE added to the existing function, immediately after the audit event
-- insert and before the return, so the seeding is inside the same transaction
-- as the status change: either both happen or neither does.
--
-- Fires on ANY entry to investigating, forward or reverse. Idempotent by the
-- unique constraint, so a reverse-then-forward cannot duplicate or wipe.
--
-- The rest of this function is UNCHANGED from the version live on both
-- environments. It is reproduced in full because CREATE OR REPLACE requires the
-- whole body -- diff it against the deployed definition before applying.

create or replace function public.incident_transition(p_incident_id bigint, p_to_status text, p_note text default null)
returns incidents
language plpgsql
set search_path to 'public'
as $function$
declare
  v_inc     public.incidents;
  v_role    text;
  v_name    text;
  v_from    text;
  v_from_ix int;
  v_to_ix   int;
  v_kind    text;
  v_event   text;
  v_order   constant text[] :=
    array['reported','assessing','investigating','actions_open','review','closed'];
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if public.is_super_admin() then
    raise exception 'Platform administrators cannot alter an organisation''s incident workflow'
      using errcode = '42501';
  end if;

  select * into v_inc from public.incidents where id = p_incident_id;
  if not found then
    raise exception 'Incident not found or not visible' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.org_members m
   where m.user_id = auth.uid()
     and m.org = v_inc.org
     and m.is_active is not false;

  if v_role is null then
    raise exception 'Not an active member of this organisation' using errcode = '42501';
  end if;

  v_from    := v_inc.status;
  v_from_ix := array_position(v_order, v_from);
  v_to_ix   := array_position(v_order, p_to_status);

  if v_to_ix is null then
    raise exception 'Unknown status %', p_to_status using errcode = '22023';
  end if;

  if v_to_ix = v_from_ix then
    raise exception 'Incident is already at %', p_to_status using errcode = '22023';
  end if;

  if v_from = 'closed' and p_to_status = 'review' then
    v_kind := 'reopen';  v_event := 'reopened';
  elsif v_to_ix = v_from_ix + 1 then
    v_kind := 'forward';
    v_event := case when p_to_status = 'investigating' then 'investigation_started'
                    when p_to_status = 'closed'        then 'closed'
                    else 'status_changed' end;
  elsif v_to_ix = v_from_ix - 1 then
    v_kind := 'reverse'; v_event := 'status_reverted';
  else
    raise exception 'Cannot move from % to % — steps must be taken in order', v_from, p_to_status
      using errcode = '22023';
  end if;

  if v_kind = 'forward' and p_to_status = 'closed' then
    if v_role <> 'client_admin' then
      raise exception 'Only a client admin may close an incident' using errcode = '42501';
    end if;
    if p_note is null or btrim(p_note) = '' then
      raise exception 'A closure note is required' using errcode = '22023';
    end if;

  elsif v_kind = 'forward' then
    if v_role not in ('supervisor','manager','client_admin') then
      raise exception 'Your role may not advance an incident' using errcode = '42501';
    end if;
    if v_role <> 'client_admin'
       and v_inc.assigned_to     is distinct from auth.uid()
       and v_inc.investigator_id is distinct from auth.uid() then
      raise exception 'Only the assigned handler or investigator may advance this incident'
        using errcode = '42501';
    end if;

  else
    if v_role <> 'client_admin' then
      raise exception 'Only a client admin may move an incident backwards' using errcode = '42501';
    end if;
    if p_note is null or btrim(p_note) = '' then
      raise exception 'A note is required when moving an incident backwards' using errcode = '22023';
    end if;
  end if;

  select p.name into v_name from public.profiles p where p.id = auth.uid();

  update public.incidents
     set status       = p_to_status,
         updated_at   = now(),
         closed_at    = case when p_to_status = 'closed' then now()
                             when v_kind = 'reopen'      then null
                             else closed_at end,
         closure_note = case when p_to_status = 'closed' then p_note else closure_note end
   where id = p_incident_id
  returning * into v_inc;

  insert into public.incident_events
    (incident_id, org, event_type, by_id, by_name, by_role, from_value, to_value, details)
  values
    (p_incident_id, v_inc.org, v_event, auth.uid(), v_name, v_role, v_from, p_to_status,
     case when p_note is null then null else jsonb_build_object('note', p_note) end);

  -- ADDED 10 Aug 2026 (step 4b). Seed the investigation and RCA findings on
  -- entry to investigating. Idempotent; a reverse-then-forward cannot wipe or
  -- duplicate existing answers. Inside this transaction by design.
  if p_to_status = 'investigating' then
    perform public.seed_incident_findings(p_incident_id);
  end if;

  return v_inc;
end;
$function$;

commit;

-- ===========================================================================
-- BACKFILL -- run SEPARATELY, after the migration commits.
--
-- Incidents already at or past investigating never fired the seeding branch.
-- Counted 9 Aug: 2 on LIVE (ids 3 and 5, both Test Org ORG1783849351837 --
-- NEITHER Kemrose incident needs it, both are at reported) and 2 on SANDBOX.
--
-- COUNT AGAIN before running. These numbers are from a point in time.
--
--   select (select count(*) from auth.users) as env, 'CHK-F4' as marker,
--          id, ref, status
--   from public.incidents
--   where status in ('investigating','actions_open','review','closed')
--   order by id;
--
-- Then, for each id returned:
--
--   select (select count(*) from auth.users) as env, 'CHK-F5' as marker,
--          id, public.seed_incident_findings(id) as rows_seeded
--   from public.incidents
--   where status in ('investigating','actions_open','review','closed')
--   order by id;
--
-- Expect rows_seeded = 8 for each on the first run, 0 on any re-run.
-- Seeded rows will carry the RUNNING user's attribution, not the original
-- investigator's -- unavoidable for a backfill and worth knowing when reading
-- those two records later.
-- ===========================================================================

-- VERIFICATION (run separately, after commit):
--
-- select (select count(*) from auth.users) as env, 'CHK-F6' as marker,
--        (select count(*) from pg_policies
--          where schemaname='public' and tablename='incident_findings') as policies,
--        (select count(*) from pg_trigger
--          where tgrelid='public.incident_findings'::regclass and not tgisinternal) as triggers,
--        (select count(*) from information_schema.table_constraints
--          where table_name='incident_findings' and constraint_type='CHECK') as checks,
--        (pg_get_functiondef('public.incident_transition(bigint,text,text)'::regprocedure)
--           like '%seed_incident_findings%') as hook_present;
--
-- Expect: policies 2 (select + update, NO insert, NO delete), triggers 1,
-- hook_present true.
