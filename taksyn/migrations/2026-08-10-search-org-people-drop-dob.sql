-- =====================================================================
-- Taksyn migration: remove date_of_birth from search_org_people
-- 10 August 2026
--
-- WHY: search_org_people is SECURITY DEFINER and its only access check
-- is is_org_member(). It returned date_of_birth to ANY org member,
-- bypassing the client_admin-only RLS policies on org_people. The
-- incident form rendered it on screen (App.jsx 14700-14701, 14720),
-- so a worker reporting an incident saw each matched person's DOB.
--
-- WHAT CHANGES: two things only.
--   1. date_of_birth removed from RETURNS TABLE
--   2. p.date_of_birth removed from the final SELECT
-- Membership check, 3-char floor, metacharacter guard, limit 10,
-- active-only filter and the access-log INSERT are all UNCHANGED.
--
-- ORDER: apply the App.jsx patch FIRST. Applying this first leaves the
-- incident form referencing a column the RPC no longer returns.
--
-- APPLY WITH psql -f, NEVER the Supabase browser SQL editor
-- (it silently truncates long input).
--
-- SANDBOX FIRST. Confirm the before-state matches on both.
-- =====================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------
-- PRE-FLIGHT 1: which database am I on?
-- LIVE  yylvtvbhddcepilzwpaw  = 49-ish
-- SBX   buqlbmgxevuldahhdbxo  = 14-ish
-- ---------------------------------------------------------------------
select 'PRE-ENV' as marker, count(*) as auth_users from auth.users;

-- ---------------------------------------------------------------------
-- PRE-FLIGHT 2: capture the before-state.
-- LIVE measured 1362 on 10 Aug. If sandbox differs, STOP and diff the
-- two verbatim before proceeding -- do not assume parity.
-- has_dob = t means the fix has not yet been applied here.
-- ---------------------------------------------------------------------
select 'PRE-FN' as marker,
       length(pg_get_functiondef(oid))                        as deflen,
       position('date_of_birth' in pg_get_functiondef(oid))>0 as has_dob
from pg_proc where proname = 'search_org_people';

-- ---------------------------------------------------------------------
-- PRE-FLIGHT 3: rollback copy. Paste the output somewhere durable
-- BEFORE running the transaction below.
-- ---------------------------------------------------------------------
select 'PRE-DEF' as marker, pg_get_functiondef(oid)
from pg_proc where proname = 'search_org_people';

begin;

-- CREATE OR REPLACE cannot change a function's return type, so the old
-- signature must be dropped first. Grants do NOT survive a DROP, which
-- is why they are re-issued explicitly at the end. Forgetting them would
-- leave the function callable by PUBLIC, including anon.
drop function if exists public.search_org_people(text, text, text);

create function public.search_org_people(p_org text, p_type text, p_query text)
returns table(id uuid, full_name text, external_ref text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ids   uuid[];
  v_count integer;
begin
  select coalesce(array_agg(t.id), '{}'::uuid[])
    into v_ids
    from (
      select p.id
      from org_people p
      where p.org = p_org
        and is_org_member(p_org)
        and p.person_type = p_type
        and p.status = 'active'
        and length(btrim(p_query)) >= 3
        and btrim(p_query) !~ '[%_\\]'
        and p.full_name ilike '%' || btrim(p_query) || '%'
      order by p.full_name
      limit 10
    ) t;
  v_count := coalesce(array_length(v_ids, 1), 0);
  -- Zero-result searches are NOT logged. Known accepted gap: a search
  -- failing is_org_member also returns zero and logs nothing, so
  -- cross-org denials are invisible. Confirmed by Olaf 6 Aug.
  if v_count > 0 then
    insert into org_people_access_log
      (org, actor_id, action, matched_ids, result_count, person_id)
    values
      (p_org, auth.uid(), 'search', v_ids, v_count, null);
  end if;
  return query
    select p.id, p.full_name, p.external_ref
    from org_people p
    where p.id = any(v_ids)
    order by p.full_name;
end;
$function$;

-- Grants: mirror the original exactly. anon must NOT appear -- the
-- register is not readable without a session, and a DROP wiped whatever
-- was there before.
revoke all on function public.search_org_people(text, text, text) from public;
revoke all on function public.search_org_people(text, text, text) from anon;
grant execute on function public.search_org_people(text, text, text) to authenticated;

commit;

-- ---------------------------------------------------------------------
-- VERIFY 1: has_dob must now be f. deflen will have shrunk.
-- ---------------------------------------------------------------------
select 'POST-FN' as marker,
       length(pg_get_functiondef(oid))                        as deflen,
       position('date_of_birth' in pg_get_functiondef(oid))>0 as has_dob,
       prosecdef                                              as is_definer
from pg_proc where proname = 'search_org_people';

-- ---------------------------------------------------------------------
-- VERIFY 2: exactly one row, authenticated=X. anon MUST be absent.
-- A DROP removes grants; this proves they were restored correctly.
-- ---------------------------------------------------------------------
select 'POST-ACL' as marker, unnest(proacl)::text as grant_entry
from pg_proc where proname = 'search_org_people';

-- ---------------------------------------------------------------------
-- VERIFY 3: the body survived intact. All four must be t. A browser
-- SQL editor truncation would show up here as an f.
-- ---------------------------------------------------------------------
select 'POST-BODY' as marker,
       pg_get_functiondef(oid) like '%is_org_member%'            as has_member_check,
       pg_get_functiondef(oid) like '%org_people_access_log%'    as has_logging,
       pg_get_functiondef(oid) like '%btrim(p_query) !~%'        as has_metachar_guard,
       pg_get_functiondef(oid) like '%limit 10%'                 as has_limit
from pg_proc where proname = 'search_org_people';

-- ---------------------------------------------------------------------
-- VERIFY 4: does it still run? Expect zero rows (no name matches
-- 'zzz'), NOT an error. An error means the rewrite is broken.
-- Substitute a real org ID for the environment being applied to.
--   LIVE Test Org  ORG1783849351837
--   SANDBOX        use a sandbox org ID, NOT this one
-- ---------------------------------------------------------------------
-- select 'POST-SMOKE' as marker, * from search_org_people('ORG1783849351837','client','zzz');

-- ---------------------------------------------------------------------
-- ROLLBACK: re-run the PRE-DEF output captured above, preceded by
--   drop function if exists public.search_org_people(text, text, text);
-- and followed by the same three grant statements. The DROP is required
-- for the same reason as above -- the return type differs.
-- ---------------------------------------------------------------------
