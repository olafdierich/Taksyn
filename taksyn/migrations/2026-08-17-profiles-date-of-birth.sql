-- ============================================================
-- [CODESPACE] -> [SANDBOX buqlbmgxevuldahhdbxo]  Sydney
-- profiles.date_of_birth
--
-- A date of birth belongs to the PERSON, not to a membership:
-- someone in two organisations has one date of birth, not two.
-- So profiles, not org_members.
--
-- TWO CHANGES, and the second is the one that matters.
--
-- 1. Add the column.
--
-- 2. Add it to profiles_guard()'s pinned list.
--
--    The guard (CHK-95) pins a specific set of fields when the
--    caller is not a client_admin of the row's org:
--      name, first_name, last_name, phone, email, notes
--    Anything outside that list is freely writable by anyone who
--    passes RLS. A new date_of_birth would therefore be LESS
--    protected than phone or notes, which is backwards for a
--    date of birth in a compliance product.
--
--    caller_is_org_admin checks role = 'client_admin' explicitly
--    (CHK-97) — it does NOT admit managers, unlike is_org_admin.
--    So pinning date_of_birth means only a client_admin or a
--    super_admin can set or change it.
--
-- Consequence worth knowing: auth.uid() is null on a service-role
-- connection, so both checks fail and the pinned fields revert.
-- invite-user therefore cannot write a date of birth by updating
-- profiles. If it is ever to arrive with an invitation it must
-- come through handle_new_user's INSERT instead.
--
-- The guard is patched dynamically from the catalogue: the
-- surrounding logic is not retyped, so it cannot be mistyped.
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

-- P2  The guard must be the version inspected at CHK-95.
do $mig$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='profiles_guard';

  if v_def is null then
    raise exception 'ABORT P2: profiles_guard() not found';
  end if;
  if v_def not like '%NEW.notes      := OLD.notes;%' then
    raise exception 'ABORT P2: the pinned-field block is not as inspected. Re-read it before patching.';
  end if;
  if v_def like '%date_of_birth%' then
    raise exception 'ABORT P2: the guard already mentions date_of_birth';
  end if;
  raise notice 'PRE P2 profiles_guard matches the inspected version';
end $mig$;

-- P3  caller_is_org_admin must still exclude managers.
do $mig$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='caller_is_org_admin';
  if v_src is null then
    raise exception 'ABORT P3: caller_is_org_admin not found';
  end if;
  if v_src not like '%client_admin%' then
    raise exception 'ABORT P3: caller_is_org_admin no longer checks client_admin';
  end if;
  if v_src like '%manager%' then
    raise exception 'ABORT P3: caller_is_org_admin now mentions manager. Who may edit a date of birth has changed; revisit this migration.';
  end if;
  raise notice 'PRE P3 caller_is_org_admin is client_admin only';
end $mig$;


-- ---------- COLUMN ----------

alter table public.profiles
  add column if not exists date_of_birth date;

comment on column public.profiles.date_of_birth is
  'Staff date of birth. Pinned by profiles_guard(): only a client_admin of the person''s organisation, or a super_admin, may set or change it. Not written by invite-user — auth.uid() is null on a service-role connection, so the guard reverts it.';


-- ---------- GUARD ----------

do $mig$
declare
  v_def text;
  v_new text;
  v_old text;
  v_rep text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='profiles_guard';

  v_old := $old$    NEW.notes      := OLD.notes;$old$;
  v_rep := $rep$    NEW.notes      := OLD.notes;
    -- A date of birth is at least as sensitive as a phone number.
    -- Without this line it would sit outside the pinned set and be
    -- writable by anyone who passes RLS.
    NEW.date_of_birth := OLD.date_of_birth;$rep$;

  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'ABORT: the notes pin was not found exactly once. Do not proceed blind.';
  end if;

  v_new := replace(v_def, v_old, v_rep);
  if v_new = v_def then
    raise exception 'ABORT: replacement produced no change';
  end if;

  execute v_new;
  raise notice 'PATCH applied: date_of_birth added to the pinned set';
end $mig$;


-- ---------- POST ----------

do $mig$
declare t text;
begin
  select data_type into t from information_schema.columns
  where table_schema='public' and table_name='profiles' and column_name='date_of_birth';
  if t is distinct from 'date' then
    raise exception 'ABORT Q1: profiles.date_of_birth is %, expected date', coalesce(t,'MISSING');
  end if;
  raise notice 'POST Q1 profiles.date_of_birth is date';
end $mig$;

-- Q2  The guard pins it, and everything it pinned before survives.
do $mig$
declare v_def text; missing text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='profiles_guard';

  if v_def not like '%NEW.date_of_birth := OLD.date_of_birth;%' then
    raise exception 'ABORT Q2: date_of_birth is not pinned';
  end if;

  select string_agg(f, ', ') into missing
  from unnest(array['NEW.name       := OLD.name;',
                    'NEW.first_name := OLD.first_name;',
                    'NEW.last_name  := OLD.last_name;',
                    'NEW.phone      := OLD.phone;',
                    'NEW.email      := OLD.email;',
                    'NEW.notes      := OLD.notes;']) f
  where position(f in v_def) = 0;
  if missing is not null then
    raise exception 'ABORT Q2: previously pinned fields lost: %', missing;
  end if;

  if v_def not like '%caller_can_manage_role%' then
    raise exception 'ABORT Q2: the role clamp is gone';
  end if;
  if v_def not like '%is_super_admin()%' then
    raise exception 'ABORT Q2: the super_admin bypass is gone';
  end if;
  raise notice 'POST Q2 date_of_birth pinned; all previous pins, role clamp and super_admin bypass intact';
end $mig$;

-- Q3  Still SECURITY DEFINER with a pinned search_path, and the
--     trigger still points at it.
do $mig$
declare v_sec boolean; v_cfg text[]; n int;
begin
  select p.prosecdef, p.proconfig into v_sec, v_cfg
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='profiles_guard';
  if not v_sec then
    raise exception 'ABORT Q3: profiles_guard is no longer SECURITY DEFINER';
  end if;
  if v_cfg is null or not (v_cfg @> array['search_path=public']) then
    raise exception 'ABORT Q3: search_path changed, got %', v_cfg;
  end if;

  select count(*) into n
  from pg_trigger t join pg_class c on c.oid=t.tgrelid
  join pg_namespace ns on ns.oid=c.relnamespace
  where ns.nspname='public' and c.relname='profiles'
    and not t.tgisinternal and t.tgname='profiles_guard_biu';
  if n <> 1 then
    raise exception 'ABORT Q3: profiles_guard_biu trigger missing';
  end if;
  raise notice 'POST Q3 DEFINER, search_path pinned, trigger attached';
end $mig$;

-- Q4  No profile data was touched.
do $mig$
declare n int; d int;
begin
  select count(*), count(date_of_birth) into n, d from public.profiles;
  raise notice 'POST Q4 % profiles, % with a date of birth (expect 0)', n, d;
  if d <> 0 then
    raise exception 'ABORT Q4: % profiles already have a date of birth', d;
  end if;
end $mig$;

commit;

select 'DONE-01' as marker,
       (select count(*) from information_schema.columns
        where table_schema='public' and table_name='profiles' and column_name='date_of_birth') as column_added,
       (select pg_get_functiondef(p.oid) like '%NEW.date_of_birth := OLD.date_of_birth;%'
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='profiles_guard') as pinned_in_guard;
