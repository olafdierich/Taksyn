-- ============================================================
-- [SANDBOX buqlbmgxevuldahhdbxo]  Sydney  aws-0-ap-southeast-2
-- handle_new_user: scope the industry lookup by email
--
-- THE BUG
-- handle_new_user() resolves industry from invite_links like this:
--
--   select invited_industry into v_industry
--   from public.invite_links
--   where organisation_id = v_org_id and used_at is null
--   order by created_at desc limit 1;
--
-- Scoped by ORG only. The role lookup directly above it is
-- deliberately scoped by invited_email, carrying the comment:
-- "never by org alone -- an org-only lookup would hand a new user
-- a stranger's role." The same reasoning applies to industry and
-- was not applied.
--
-- WHY IT MATTERS NOW
-- With invites sent one at a time there is rarely more than one
-- open invite per org, so the wrong-row risk is small. A staff
-- bulk import leaves 80 open invites at once, and then every
-- person who signs up inherits the industry of whichever invite
-- was created last, regardless of whose it is.
--
-- Verified identical on both environments before writing this:
-- CHK-67 returned md5 a9591303d8dd390fba7f5b5b4f688307 on LIVE
-- and SANDBOX alike.
--
-- METHOD
-- The function body is read from the catalogue, the target block
-- replaced, and the result executed. The 60 lines of working auth
-- trigger around it are never retyped, so they cannot be mistyped.
-- ============================================================
\pset pager off
\set ON_ERROR_STOP on

begin;

-- ---------- PRE ----------

do $$
declare n int;
begin
  select count(*) into n from auth.users;
  raise notice 'PRE P1 auth users = %', n;
  if n > 30 then
    raise exception 'ABORT P1: % auth users looks like LIVE, not SANDBOX', n;
  end if;
end $$;

-- P2  The function must be the version we inspected.
do $$
declare v_hash text;
begin
  select md5(pg_get_functiondef(p.oid)) into v_hash
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='handle_new_user';

  if v_hash is null then
    raise exception 'ABORT P2: handle_new_user not found';
  end if;
  raise notice 'PRE P2 current handle_new_user md5 = %', v_hash;
  if v_hash <> 'a9591303d8dd390fba7f5b5b4f688307' then
    raise exception 'ABORT P2: handle_new_user has changed since CHK-67 (expected a9591303d8dd390fba7f5b5b4f688307). Re-read the body before patching an auth trigger.';
  end if;
end $$;


-- ---------- PATCH ----------

do $$
declare
  v_def     text;
  v_new     text;
  v_pattern text := 'select\s+invited_industry\s+into\s+v_industry\s+from\s+public\.invite_links\s+where\s+organisation_id\s*=\s*v_org_id\s+and\s+used_at\s+is\s+null\s+order\s+by\s+created_at\s+desc\s+limit\s+1;';
  v_repl    text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='handle_new_user';

  -- Exactly one occurrence, or stop.
  if not (v_def ~ v_pattern) then
    raise exception 'ABORT: the industry lookup block was not found. Do not proceed blind.';
  end if;
  if (select count(*) from regexp_matches(v_def, v_pattern, 'g')) <> 1 then
    raise exception 'ABORT: the industry lookup block appears more than once.';
  end if;

  v_repl :=
    'select invited_industry into v_industry' || E'\n' ||
    '    from public.invite_links' || E'\n' ||
    '    where organisation_id = v_org_id' || E'\n' ||
    '      -- FIX-INDUSTRY-BY-EMAIL: scoped by invited_email, mirroring the' || E'\n' ||
    '      -- role lookup above. An org-only lookup hands a new user a' || E'\n' ||
    '      -- stranger''s industry: harmless with one open invite, wrong as' || E'\n' ||
    '      -- soon as a bulk import leaves many open at once.' || E'\n' ||
    '      and lower(trim(invited_email)) = lower(trim(NEW.email))' || E'\n' ||
    '      and used_at is null' || E'\n' ||
    '      and is_active is true' || E'\n' ||
    '    order by created_at desc limit 1;';

  v_new := regexp_replace(v_def, v_pattern, v_repl);

  if v_new = v_def then
    raise exception 'ABORT: replacement produced no change';
  end if;

  execute v_new;
  raise notice 'PATCH applied: industry lookup now scoped by invited_email';
end $$;


-- ---------- POST ----------

do $$
declare v_def text; v_hash text;
begin
  select pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid))
    into v_def, v_hash
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='handle_new_user';

  if v_def not like '%FIX-INDUSTRY-BY-EMAIL%' then
    raise exception 'ABORT Q1: the fix marker is absent from the new body';
  end if;
  if v_hash = 'a9591303d8dd390fba7f5b5b4f688307' then
    raise exception 'ABORT Q1: body is unchanged';
  end if;
  raise notice 'POST Q1 new md5 = %', v_hash;
end $$;

-- Q2  The role lookup must be untouched. It is the more important
--     of the two and was already correct.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='handle_new_user';

  if v_def not like '%FIX-ROLE-FROM-INVITE%' then
    raise exception 'ABORT Q2: the role fix comment is gone — the role lookup may have been damaged';
  end if;
  if v_def not like '%CHK-36 clamp%' then
    raise exception 'ABORT Q2: the role clamp comment is gone';
  end if;
  raise notice 'POST Q2 role lookup and clamp intact';
end $$;

-- Q3  Still SECURITY DEFINER with the same search_path.
do $$
declare v_sec boolean; v_cfg text[];
begin
  select p.prosecdef, p.proconfig into v_sec, v_cfg
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='handle_new_user';
  if not v_sec then
    raise exception 'ABORT Q3: no longer SECURITY DEFINER';
  end if;
  if v_cfg is null or not (v_cfg @> array['search_path=public, auth']) then
    raise exception 'ABORT Q3: search_path changed, got %', v_cfg;
  end if;
  raise notice 'POST Q3 DEFINER and search_path preserved';
end $$;

-- Q4  The trigger still points at it.
do $$
declare n int;
begin
  select count(*) into n
  from pg_trigger t join pg_proc p on p.oid = t.tgfoid
  join pg_namespace n2 on n2.oid = p.pronamespace
  where n2.nspname='public' and p.proname='handle_new_user' and not t.tgisinternal;
  if n = 0 then
    raise exception 'ABORT Q4: no trigger references handle_new_user';
  end if;
  raise notice 'POST Q4 % trigger(s) still reference handle_new_user', n;
end $$;

commit;

select 'DONE-01' as marker,
       md5(pg_get_functiondef(p.oid)) as new_hash,
       pg_get_functiondef(p.oid) like '%FIX-INDUSTRY-BY-EMAIL%' as fix_present,
       pg_get_functiondef(p.oid) like '%FIX-ROLE-FROM-INVITE%' as role_fix_intact
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='handle_new_user';
