-- =====================================================================
-- 20260901_clamp_metadata_role_to_worker.sql
--
-- CLAMP-METADATA-WORKER-ONLY
--
-- CHANGE (one line, in the else branch of the role resolution):
--     before:  if v_role not in ('worker','supervisor','manager') then
--     after:   if v_role <> 'worker' then
--
-- WHY. The CHK-36 clamp was written to stop metadata claiming client_admin,
-- and it does. But it left 'supervisor' and 'manager' reachable from
-- NEW.raw_user_meta_data. With no matching invite_links row, v_invited_role
-- is null, the else branch runs, and an unauthenticated POST to
-- /auth/v1/signup carrying role:"manager" plus any known org ID produced an
-- org_members row as a manager of that org. Kemrose's org ID has travelled
-- in every WhatsApp invite ever sent, and a self-granted manager can search
-- org_people (proven by probe M3, 5 Aug).
--
-- WHY THIS IS SAFE. Every sanctioned invite writes an invite_links row with
-- invited_email BEFORE the auth user exists:
--   * supabase/functions/invite-user/index.ts:139  (when no caller secret)
--   * src/App.jsx:7801, 9056                       (when App.jsx wrote it first)
-- The invite branch above therefore wins for every legitimate supervisor and
-- manager. This change only affects signups with NO invite row at all.
--
-- PRE-FLIGHT (CHK-CLAMP-01, run on LIVE 1 Sep 2026):
--   active_no_email 0 | active_elevated 2 | elevated_no_email 0 | active_total 14
-- elevated_no_email = 0 is the gate. If a future run returns non-zero, DO NOT
-- APPLY -- some path is issuing elevated invites without an email and those
-- users would degrade to worker.
--
-- UNCHANGED, deliberately: SECURITY DEFINER, SET search_path, the invite
-- allow-list (supervisor and manager remain grantable BY INVITE), and every
-- industry / position / DOB block and comment. Reproduced verbatim from
-- pg_get_functiondef output captured 1 Sep 2026 (CHK-TRIG-02).
--
-- APPLY ORDER: SANDBOX buqlbmgxevuldahhdbxo -> verify -> LIVE
-- yylvtvbhddcepilzwpaw -> verify. Use psql -f; the browser SQL editor
-- truncates input this long without warning.
--
-- "No rows returned" from CREATE OR REPLACE FUNCTION is SUCCESS. Confirm
-- with CHK-CLAMP-02 at the foot of this file.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_org_id       text;
  v_org_name     text;
  v_industry     text;
  v_role         text;
  v_meta_role    text;
  v_invited_role text;
  v_name         text;
  v_first        text;
  v_last         text;
  v_dob          date;
  v_position     text;
begin
  v_org_id    := NEW.raw_user_meta_data->>'orgId';
  v_meta_role := lower(trim(coalesce(NEW.raw_user_meta_data->>'role','worker')));
  -- FIX-ROLE-FROM-INVITE: prefer the server-controlled invite_links row for THIS
  -- email. Scoped by invited_email, never by org alone -- an org-only lookup
  -- would hand a new user a stranger's role.
  v_invited_role := null;
  if v_org_id is not null and NEW.email is not null then
    select lower(trim(il.role)) into v_invited_role
    from public.invite_links il
    where il.organisation_id = v_org_id
      and lower(trim(il.invited_email)) = lower(trim(NEW.email))
      and il.used_at is null
      and il.is_active is true
    order by il.created_at desc limit 1;
  end if;
  if v_invited_role in ('worker','supervisor','manager','client_admin') then
    v_role := v_invited_role;
    raise log 'handle_new_user INVITE ROLE: user % granted % from invite_links',
              NEW.id, v_role;
  else
    -- CLAMP-METADATA-WORKER-ONLY (1 Sep 2026), supersedes the CHK-36 clamp:
    -- metadata role is client-supplied and is now worth NOTHING. Any role
    -- above worker -- supervisor, manager, client_admin, anything -- is
    -- granted only by an invite_links row written server-side after an
    -- authorisation check (invite-user clamps to strictly below the
    -- caller's own level). The previous list permitted supervisor and
    -- manager here, which meant a signup with no invite at all could claim
    -- manager of any org whose ID was known.
    v_role := v_meta_role;
    if v_role <> 'worker' then
      v_role := 'worker';
      raise log 'handle_new_user CLAMP: user % requested role % with no matching invite, degraded to worker',
                NEW.id, v_meta_role;
    end if;
  end if;
  -- FIX-INDUSTRY-PRECEDENCE (30 Aug 2026): the INVITE wins, metadata is the
  -- fallback. This is the same precedence FIX-ROLE-FROM-INVITE applies above,
  -- and industry was the one client-supplied value that did the opposite.
  -- Every industry in this database outside global_industries arrived through
  -- the old order; none of those strings exists anywhere in App.jsx.
  --
  -- FIX-INDUSTRY-MAX (20 Aug 2026), retained: max() NOT `order by created_at
  -- desc limit 1`. Invite rows are written twice by two writers and the NEWER
  -- row is frequently the one WITHOUT invited_industry, so an ordering based
  -- lookup picks the empty one. max() ignores nulls and finds the value
  -- wherever it sits.
  --
  -- FIX-INDUSTRY-BY-EMAIL, retained: scoped by invited_email, mirroring the
  -- role lookup. An org-only lookup hands a new user a stranger's industry:
  -- harmless with one open invite, wrong as soon as a bulk import leaves
  -- many open at once.
  v_industry := null;
  if v_org_id is not null and NEW.email is not null then
    select max(nullif(trim(invited_industry),'')) into v_industry
    from public.invite_links
    where organisation_id = v_org_id
      and lower(trim(invited_email)) = lower(trim(NEW.email))
      and used_at is null
      and is_active is true;
  end if;
  if v_industry is null then
    v_industry := nullif(NEW.raw_user_meta_data->>'industry','');
  end if;
  -- VALIDATE against global_industries. An unrecognised value is DROPPED,
  -- not stored: null reads as "not set" and every consumer already handles
  -- it, whereas a junk string reads as a real industry and silently
  -- resolves to no position list and no category pack. Logged, never fatal
  -- -- an industry must not be able to fail a signup.
  if v_industry is not null
     and not exists (select 1 from public.global_industries g
                      where lower(trim(g.name)) = lower(trim(v_industry))) then
    raise log 'handle_new_user INDUSTRY REJECTED: user % supplied %, not in global_industries',
              NEW.id, v_industry;
    v_industry := null;
  end if;

  -- FIX-POSITION-FROM-INVITE (20 Aug 2026): org_members.position was always NULL.
  -- The App.jsx writes that were supposed to set it either fail silently or never
  -- run. This is the only write path that reliably lands the row, so it is sourced
  -- here. Separate lookup because the industry one above is gated on v_industry
  -- being null and is skipped whenever industry arrives in metadata.
  -- max() NOT `order by created_at desc limit 1`: invite rows are written twice by
  -- two writers and the NEWER row is the one WITHOUT invited_position. max() ignores
  -- nulls and finds the value wherever it sits.
  v_position := nullif(trim(coalesce(NEW.raw_user_meta_data->>'position','')),'');
  if v_position is null and v_org_id is not null and NEW.email is not null then
    select max(coalesce(nullif(trim(il.invited_position),''),
                        nullif(trim(il.position),'')))
      into v_position
    from public.invite_links il
    where il.organisation_id = v_org_id
      and lower(trim(il.invited_email)) = lower(trim(NEW.email))
      and il.used_at is null
      and il.is_active is true;
  end if;
  -- FIX-DOB-FROM-INVITE: a date of birth cannot arrive by UPDATE.
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

  -- Org NAME resolved from organisations by ID, never trusted from metadata.
  if v_org_id is not null then
    select o.name into v_org_name from public.organisations o where o.id = v_org_id;
  end if;
  v_org_name := coalesce(v_org_name, 'UNASSIGNED');
  v_name  := coalesce(nullif(trim(NEW.raw_user_meta_data->>'name'),''),
                      split_part(NEW.email,'@',1));
  v_first := split_part(v_name,' ',1);
  v_last  := nullif(trim(substr(v_name, length(split_part(v_name,' ',1)) + 1)), '');
  begin
    insert into public.profiles
      -- FIX-TIER-DROPPED (22 Aug 2026): profiles.tier removed. The column is
      -- deprecated, nothing reads it, and it is now nullable. This function
      -- was the last writer, hardcoding a plan value on every signup.
      (id, name, first_name, last_name, email, role, org, industry, date_of_birth)
    values
      (NEW.id, v_name, v_first, v_last, NEW.email, v_role, v_org_name, v_industry, v_dob)
    on conflict (id) do nothing;
  exception when others then
    raise log 'handle_new_user PROFILES INSERT FAILED for user % (email %): %',
              NEW.id, NEW.email, sqlerrm;
  end;
  if v_org_id is not null
     and exists (select 1 from public.organisations where id = v_org_id) then
    begin
      insert into public.org_members (user_id, org, role, industry, position)
      values (NEW.id, v_org_id, v_role, v_industry, v_position)
      on conflict (user_id, org) do update
        set industry = excluded.industry,
            role     = excluded.role,
            position = coalesce(nullif(trim(org_members.position),''),
                                excluded.position);
    exception when others then
      raise log 'handle_new_user ORG_MEMBERS INSERT FAILED for user % (org %): %',
                NEW.id, v_org_id, sqlerrm;
    end;
  end if;
  return NEW;
end;
$function$;

-- =====================================================================
-- VERIFY -- run separately after the above reports success.
--
-- Expect: sup_still_present NON-ZERO (supervisor correctly remains in the
--         INVITE allow-list), marker_present NON-ZERO (new version landed),
--         old_clamp_gone = 0 (the permissive list is gone).
-- =====================================================================
-- select 'CHK-CLAMP-02' as marker,
--        position('supervisor' in prosrc)                  as sup_still_present,
--        position('CLAMP-METADATA-WORKER-ONLY' in prosrc)   as marker_present,
--        position('not in (''worker'',''supervisor'',''manager'')' in prosrc)
--                                                          as old_clamp_gone
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'handle_new_user';
