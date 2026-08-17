-- ============================================================
-- [CODESPACE] -> [SANDBOX buqlbmgxevuldahhdbxo]  Sydney
-- handle_new_user: carry a date of birth from the invite
--
-- WHY THIS, AND NOT invite-user
-- profiles_guard is BEFORE UPDATE and pins date_of_birth when the
-- caller is not a client_admin of the row's org. auth.uid() is
-- null on a service-role connection, so invite-user CANNOT write
-- a date of birth by updating profiles: it would be reverted
-- silently, and a staff import would collect the value, stage it,
-- send the invitation and lose it with no error anywhere.
--
-- handle_new_user INSERTS the profiles row during
-- inviteUserByEmail. An insert does not fire a BEFORE UPDATE
-- trigger, so the guard does not apply and the value lands.
--
-- SHAPE OF THE CHANGE
-- One metadata read and one column added to an INSERT that
-- already exists. If the metadata carries nothing, or carries
-- something unparseable, the date of birth is null and signup is
-- unaffected — the same outcome as today.
--
-- The insert keeps ON CONFLICT (id) DO NOTHING, so a date of
-- birth is best-effort at invite time: if a profile somehow
-- already exists, it is not overwritten. A client_admin can
-- always set it afterwards through Workforce.
--
-- Guarded on md5 ddbf73556b0726503cedcab7329d231a, which is this
-- function AFTER the FIX-INDUSTRY-BY-EMAIL change applied earlier
-- today. Patched dynamically from the catalogue: the surrounding
-- 60 lines of working auth trigger are not retyped.
-- ============================================================
\pset pager off
\set ON_ERROR_STOP on

begin;

-- ---------- PRE ----------

do $mig$
declare n int;
begin
  select count(*) into n from auth.users;
  raise notice 'PRE P1 auth users = %', n;
  if n > 30 then
    raise exception 'ABORT P1: % auth users looks like LIVE, not SANDBOX', n;
  end if;
end $mig$;

-- P2  Exactly the version inspected at CHK-103/104.
do $mig$
declare v_hash text;
begin
  select md5(pg_get_functiondef(p.oid)) into v_hash
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='handle_new_user';

  if v_hash is null then
    raise exception 'ABORT P2: handle_new_user not found';
  end if;
  raise notice 'PRE P2 current md5 = %', v_hash;
  if v_hash <> 'ddbf73556b0726503cedcab7329d231a' then
    raise exception 'ABORT P2: handle_new_user has changed since it was read (expected ddbf7355...). Re-read the body before patching an auth trigger.';
  end if;
end $mig$;

-- P3  The column must exist, or the insert would fail for every
--     new user — breaking signup entirely.
do $mig$
declare t text;
begin
  select data_type into t from information_schema.columns
  where table_schema='public' and table_name='profiles' and column_name='date_of_birth';
  if t is distinct from 'date' then
    raise exception 'ABORT P3: profiles.date_of_birth is %, expected date. Apply the column migration first.', coalesce(t,'MISSING');
  end if;
  raise notice 'PRE P3 profiles.date_of_birth present';
end $mig$;


-- ---------- PATCH ----------

do $mig$
declare
  v_def  text;
  v_new  text;
  v_old1 text; v_rep1 text;
  v_old2 text; v_rep2 text;
  v_old3 text; v_rep3 text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='handle_new_user';

  -- 1. a variable to hold it
  v_old1 := $o1$  v_last         text;$o1$;
  v_rep1 := $r1$  v_last         text;
  v_dob          date;$r1$;

  -- 2. read it from the metadata, tolerating anything unparseable
  v_old2 := $o2$  -- Org NAME resolved from organisations by ID, never trusted from metadata.$o2$;
  v_rep2 := $r2$  -- FIX-DOB-FROM-INVITE: a date of birth cannot arrive by UPDATE.
  -- profiles_guard pins it and auth.uid() is null on the service-role
  -- connection invite-user uses, so the write would revert silently.
  -- It arrives here instead, on the INSERT, where no BEFORE UPDATE
  -- trigger applies. Anything unparseable leaves it null rather than
  -- failing the signup.
  begin
    v_dob := nullif(NEW.raw_user_meta_data->>'dateOfBirth','')::date;
  exception when others then
    v_dob := null;
    raise log 'handle_new_user DOB: unparseable value for user %, left null', NEW.id;
  end;

  -- Org NAME resolved from organisations by ID, never trusted from metadata.$r2$;

  -- 3. write it
  v_old3 := $o3$      (id, name, first_name, last_name, email, role, tier, org, industry)$o3$;
  v_rep3 := $r3$      (id, name, first_name, last_name, email, role, tier, org, industry, date_of_birth)$r3$;

  if (length(v_def) - length(replace(v_def, v_old1, ''))) / length(v_old1) <> 1 then
    raise exception 'ABORT: the declare block anchor was not found exactly once.';
  end if;
  if (length(v_def) - length(replace(v_def, v_old2, ''))) / length(v_old2) <> 1 then
    raise exception 'ABORT: the org-name comment anchor was not found exactly once.';
  end if;
  if (length(v_def) - length(replace(v_def, v_old3, ''))) / length(v_old3) <> 1 then
    raise exception 'ABORT: the profiles insert column list was not found exactly once.';
  end if;

  v_new := replace(v_def, v_old1, v_rep1);
  v_new := replace(v_new, v_old2, v_rep2);
  v_new := replace(v_new, v_old3, v_rep3);

  -- The VALUES list must gain the variable too, or the insert has
  -- one more column than value and fails for every new user.
  v_new := replace(v_new,
    $o4$      (NEW.id, v_name, v_first, v_last, NEW.email, v_role, 'Growth', v_org_name, v_industry)$o4$,
    $r4$      (NEW.id, v_name, v_first, v_last, NEW.email, v_role, 'Growth', v_org_name, v_industry, v_dob)$r4$);

  if v_new = v_def then
    raise exception 'ABORT: replacement produced no change';
  end if;
  if v_new not like '%, v_dob)%' then
    raise exception 'ABORT: the VALUES list did not gain v_dob. Column and value counts would not match.';
  end if;

  execute v_new;
  raise notice 'PATCH applied: date of birth read from invite metadata and written on insert';
end $mig$;


-- ---------- POST ----------

do $mig$
declare v_def text; v_hash text;
begin
  select pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid))
    into v_def, v_hash
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='handle_new_user';

  if v_def not like '%FIX-DOB-FROM-INVITE%' then
    raise exception 'ABORT Q1: the fix marker is absent';
  end if;
  if v_def not like '%date_of_birth)%' then
    raise exception 'ABORT Q1: the insert column list does not include date_of_birth';
  end if;
  if v_def not like '%, v_dob)%' then
    raise exception 'ABORT Q1: the VALUES list does not include v_dob';
  end if;
  raise notice 'POST Q1 new md5 = %', v_hash;
end $mig$;

-- Q2  Everything that was already right must still be right.
do $mig$
declare v_def text; missing text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='handle_new_user';

  select string_agg(f, ', ') into missing
  from unnest(array['FIX-ROLE-FROM-INVITE',
                    'CHK-36 clamp',
                    'FIX-INDUSTRY-BY-EMAIL',
                    'on conflict (id) do nothing',
                    'insert into public.org_members']) f
  where position(f in v_def) = 0;
  if missing is not null then
    raise exception 'ABORT Q2: lost from the function: %', missing;
  end if;
  raise notice 'POST Q2 role lookup, clamp, industry fix, conflict clause and org_members insert all intact';
end $mig$;

-- Q3  Still SECURITY DEFINER, same search_path, trigger attached.
do $mig$
declare v_sec boolean; v_cfg text[]; n int;
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

  select count(*) into n
  from pg_trigger t join pg_proc p on p.oid = t.tgfoid
  join pg_namespace n2 on n2.oid = p.pronamespace
  where n2.nspname='public' and p.proname='handle_new_user' and not t.tgisinternal;
  if n = 0 then
    raise exception 'ABORT Q3: no trigger references handle_new_user';
  end if;
  raise notice 'POST Q3 DEFINER, search_path preserved, % trigger(s) attached', n;
end $mig$;

-- Q4  No data touched.
do $mig$
declare n int; d int;
begin
  select count(*), count(date_of_birth) into n, d from public.profiles;
  raise notice 'POST Q4 % profiles, % with a date of birth', n, d;
end $mig$;

commit;

select 'DONE-01' as marker,
       md5(pg_get_functiondef(p.oid)) as new_hash,
       pg_get_functiondef(p.oid) like '%FIX-DOB-FROM-INVITE%' as dob_read,
       pg_get_functiondef(p.oid) like '%, v_dob)%'            as dob_written,
       pg_get_functiondef(p.oid) like '%FIX-INDUSTRY-BY-EMAIL%' as industry_fix_intact
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='handle_new_user';
