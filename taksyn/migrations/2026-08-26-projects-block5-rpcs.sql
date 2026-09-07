-- =====================================================================
-- Taksyn — Projects module, BLOCK 5: the RPCs
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
-- Date: 26 August 2026
-- Requires: blocks 1-3 applied.
--
--   create_project(org, name, description, start, target_end)
--   next_project_ref(org)                     [internal]
--   find_similar_areas(org, name, parent)     [read-only, the warning]
--   create_org_area(org, name, parent, confirm_similar)
--   sign_off_project(project, note)
--
-- AUTHORIZATION.  These are SECURITY DEFINER, so they bypass RLS and
-- must do their own checks.  Two helper families exist and they are NOT
-- interchangeable:
--
--   is_org_*(target_org)            compares org_members.org  -> the ID
--   caller_is_org_*(target_org_name) joins organisations       -> the NAME
--
-- projects.org holds the ID, so everything here uses is_org_*.  Calling
-- the wrong family would silently authorize nobody, which for a
-- SECURITY DEFINER function is the worst failure available: it looks
-- like a permissions bug and gets "fixed" by loosening something.
--
-- tasks.org holds the NAME (default 'My Organisation'), so create_project
-- returns both and any task write must use the name side.
-- =====================================================================

begin;

do $$
begin
  if exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose found. This looks like LIVE. Sandbox-only.';
  end if;
  if to_regclass('public.project_schedule_events') is null then
    raise exception 'ABORT: block 3 has not been applied.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- next_project_ref — PRJ-YYYY-NNNN, per org, per year.
--
-- Computed from the existing max rather than a sequence, because a
-- sequence is global and these must restart at 0001 for each org each
-- year.  Advisory lock rather than a table lock: two admins creating a
-- project in the same second would otherwise both read the same max.
-- The lock is keyed on org+year, so it never blocks a different org.
-- ---------------------------------------------------------------------
create or replace function public.next_project_ref(p_org text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year text := to_char(current_date,'YYYY');
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_org || v_year));

  select coalesce(max(substring(ref from 10)::integer), 0) + 1
    into v_next
  from public.projects
  where org = p_org
    and ref like 'PRJ-' || v_year || '-%'
    and substring(ref from 10) ~ '^[0-9]+$';

  return 'PRJ-' || v_year || '-' || lpad(v_next::text, 4, '0');
end $$;


-- ---------------------------------------------------------------------
-- create_project
--
-- Returns the new row plus org_name, because the caller will almost
-- certainly create tasks next and tasks.org needs the NAME.  Handing it
-- back here means the client never has to look it up and never has to
-- decide which side of the gremlin it is on.
-- ---------------------------------------------------------------------
create or replace function public.create_project(
  p_org             text,
  p_name            text,
  p_description     text default null,
  p_start_date      date default null,
  p_target_end_date date default null
)
returns table (
  id uuid, ref text, name text, org text, org_name text, status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  uuid;
  v_ref text;
begin
  if auth.uid() is null then
    raise exception 'create_project: not signed in';
  end if;

  -- Managers and client_admins create projects. is_org_admin covers
  -- both; sign-off is narrower and checked separately.
  if not public.is_org_admin(p_org) then
    raise exception 'create_project: not permitted for org %', p_org;
  end if;

  if coalesce(btrim(p_name),'') = '' then
    raise exception 'create_project: a project needs a name';
  end if;

  if p_start_date is not null and p_target_end_date is not null
     and p_target_end_date < p_start_date then
    raise exception 'create_project: target end date is before the start date';
  end if;

  v_ref := public.next_project_ref(p_org);

  insert into public.projects
    (org, ref, name, description, start_date, target_end_date,
     owner_id, created_by_id, status)
  values
    (p_org, v_ref, btrim(p_name), nullif(btrim(coalesce(p_description,'')),''),
     p_start_date, p_target_end_date, auth.uid(), auth.uid(), 'active')
  returning projects.id into v_id;

  return query
    select p.id, p.ref, p.name, p.org, o.name, p.status
    from public.projects p
    join public.organisations o on o.id = p.org
    where p.id = v_id;
end $$;


-- ---------------------------------------------------------------------
-- find_similar_areas — the warning, read-only.
--
-- The unique index already refuses an exact collision after
-- normalisation: "Main Kitchen", "main kitchen" and "Main  Kitchen" all
-- become mainkitchen and cannot coexist.  This catches the NEAR misses
-- the index cannot: "Kitchen" when "Kitchens" exists, "Bar" when "Back
-- Bar" exists.
--
-- Advisory only.  It returns what looks close and lets the caller
-- decide.  Blocking on similarity would be wrong — a venue really can
-- have a Bar and a Back Bar.
--
-- Substring matching rather than trigram similarity, deliberately: it
-- needs no extension, and pg_trgm may not be present on every
-- environment this eventually reaches. Cheap and predictable beats
-- clever and conditional.
-- ---------------------------------------------------------------------
create or replace function public.find_similar_areas(
  p_org       text,
  p_name      text,
  p_parent_id uuid default null
)
returns table (id uuid, name text, parent_id uuid, match_kind text)
language sql
stable
security definer
set search_path = public
as $$
  with candidate as (
    select regexp_replace(lower(p_name), '[^a-z0-9]', '', 'g') as key
  )
  select a.id, a.name, a.parent_id,
         case
           when a.name_key = c.key then 'exact'
           when a.name_key like c.key || '%' then 'starts_with'
           when c.key like a.name_key || '%' then 'extends'
           else 'contains'
         end as match_kind
  from public.org_areas a, candidate c
  where a.org = p_org
    and a.is_active
    and c.key <> ''
    and (
      a.name_key = c.key
      or a.name_key like c.key || '%'
      or c.key like a.name_key || '%'
      or a.name_key like '%' || c.key || '%'
    )
  order by case
    when a.name_key = c.key then 0
    when a.name_key like c.key || '%' then 1
    else 2
  end, a.name
  limit 10;
$$;


-- ---------------------------------------------------------------------
-- create_org_area
--
-- Two-step by design.  Called with p_confirm_similar false (the
-- default) it REFUSES when something similar exists and hands back what
-- it found, so the UI can say "there is already a Back Bar — did you
-- mean that?".  Called again with true, it creates.
--
-- An exact normalised duplicate is refused either way: that is the
-- unique index, and confirming past it is not an option.  Server-side
-- rather than in the client because the 7 August note on org_people
-- recorded the Contacts direct-add doing this check client-side and
-- being weaker under concurrency.  One place, not two.
-- ---------------------------------------------------------------------
create or replace function public.create_org_area(
  p_org              text,
  p_name             text,
  p_parent_id        uuid    default null,
  p_confirm_similar  boolean default false
)
returns table (id uuid, name text, parent_id uuid, warning text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_key     text;
  v_similar text;
  v_count   integer;
begin
  if auth.uid() is null then
    raise exception 'create_org_area: not signed in';
  end if;
  if not public.is_org_admin(p_org) then
    raise exception 'create_org_area: not permitted for org %', p_org;
  end if;

  v_key := regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9]', '', 'g');
  if v_key = '' then
    raise exception 'create_org_area: a name needs at least one letter or digit';
  end if;

  -- Exact after normalisation. Never confirmable.
  if exists (
    select 1 from public.org_areas a
    where a.org = p_org
      and coalesce(a.parent_id,'00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(p_parent_id,'00000000-0000-0000-0000-000000000000'::uuid)
      and a.name_key = v_key
  ) then
    raise exception 'create_org_area: "%" already exists here', btrim(p_name);
  end if;

  if not p_confirm_similar then
    select count(*), string_agg(s.name, ', ' order by s.name)
      into v_count, v_similar
    from public.find_similar_areas(p_org, p_name, p_parent_id) s;

    if v_count > 0 then
      raise exception
        'create_org_area: similar areas already exist (%). Call again with p_confirm_similar => true to create anyway.',
        v_similar
        using errcode = 'raise_exception';
    end if;
  end if;

  insert into public.org_areas (org, name, parent_id)
  values (p_org, btrim(p_name), p_parent_id)
  returning org_areas.id into v_id;

  return query
    select a.id, a.name, a.parent_id,
           case when p_confirm_similar
                then 'Created despite similar existing areas.'
                else null end
    from public.org_areas a where a.id = v_id;
end $$;


-- ---------------------------------------------------------------------
-- sign_off_project — client_admin ONLY.
--
-- Narrower than create: is_org_client_admin, not is_org_admin.  A
-- manager can run a project; only a client_admin closes one.
--
-- REFUSES while work is open.  A project that can be signed off with
-- unapproved tasks or open blockers is a project whose sign-off means
-- nothing, and the sign-off is the entire compliance value of the
-- module.  Enforced here rather than in the UI so it cannot be clicked
-- around.
--
-- Blockers are 'blocked' rows from the most recent propagation run:
-- locked dates the chain pushed against.  Signing off over one would be
-- signing off a project that has already missed a statutory date.
-- ---------------------------------------------------------------------
create or replace function public.sign_off_project(
  p_project_id uuid,
  p_note       text default null
)
returns table (id uuid, ref text, status text, closed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org       text;
  v_open      integer;
  v_blocked   integer;
  v_last_run  uuid;
begin
  select p.org into v_org from public.projects p where p.id = p_project_id;
  if v_org is null then
    raise exception 'sign_off_project: project % not found', p_project_id;
  end if;

  if not public.is_org_client_admin(v_org) then
    raise exception 'sign_off_project: only a client admin can sign off a project';
  end if;

  if exists (select 1 from public.projects p
              where p.id = p_project_id and p.status in ('closed','cancelled')) then
    raise exception 'sign_off_project: already closed';
  end if;

  -- Unfinished work. 'approved' is the end state for a task that needed
  -- approval; 'completed' is done-but-unreviewed and does NOT count.
  select count(*) into v_open
  from public.tasks t
  where t.project_id = p_project_id
    and coalesce(t.status,'') not in ('approved','completed');

  if v_open > 0 then
    raise exception 'sign_off_project: % task(s) are still open', v_open;
  end if;

  select count(*) into v_open
  from public.tasks t
  where t.project_id = p_project_id
    and t.status = 'completed'
    and coalesce(t.requires_approval, true);

  if v_open > 0 then
    raise exception 'sign_off_project: % task(s) are done but not yet approved', v_open;
  end if;

  select e.run_id into v_last_run
  from public.project_schedule_events e
  where e.project_id = p_project_id
  order by e.created_at desc limit 1;

  if v_last_run is not null then
    select count(*) into v_blocked
    from public.project_schedule_events e
    where e.project_id = p_project_id
      and e.run_id = v_last_run
      and e.kind = 'blocked';

    if v_blocked > 0 then
      raise exception
        'sign_off_project: % locked date(s) are at risk. Resolve or record them before sign-off.',
        v_blocked;
    end if;
  end if;

  update public.projects p
     set status       = 'closed',
         closed_at    = now(),
         closed_by_id = auth.uid(),
         signoff_note = nullif(btrim(coalesce(p_note,'')),'')
   where p.id = p_project_id;

  return query
    select p.id, p.ref, p.status, p.closed_at
    from public.projects p where p.id = p_project_id;
end $$;


-- ---------------------------------------------------------------------
-- Grants.  authenticated only; the functions do their own authz.
-- next_project_ref stays internal — a ref is allocated by
-- create_project, never asked for separately.
-- ---------------------------------------------------------------------
revoke all on function public.next_project_ref(text) from public, authenticated;

grant execute on function public.create_project(text,text,text,date,date)      to authenticated;
grant execute on function public.find_similar_areas(text,text,uuid)            to authenticated;
grant execute on function public.create_org_area(text,text,uuid,boolean)       to authenticated;
grant execute on function public.sign_off_project(uuid,text)                   to authenticated;
grant execute on function public.recompute_project_dates(uuid,boolean,text)    to authenticated;

commit;


-- =====================================================================
-- VERIFICATION
-- =====================================================================
select 'PRJ-B5-01' as marker, p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as sec_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('create_project','next_project_ref','find_similar_areas',
                    'create_org_area','sign_off_project')
order by p.proname;

-- Ref allocation. No auth.uid() needed — this one is pure.
select 'PRJ-B5-02' as marker,
       public.next_project_ref('ORG1900000000001') as next_ref_alpha,
       public.next_project_ref('ORG1900000000002') as next_ref_beta;

-- The similar-name warning, against the areas block 4 seeded.
select 'PRJ-B5-03' as marker, name, match_kind
from public.find_similar_areas('ORG1900000000001','Test Bar Back')
order by match_kind, name;

select 'PRJ-B5-04' as marker, name, match_kind
from public.find_similar_areas('ORG1900000000001','Storeroom')
order by name;
