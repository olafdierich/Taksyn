-- ============================================================
-- [SANDBOX buqlbmgxevuldahhdbxo]  Sydney
-- Staff bulk import — STAGE 6: staging table + validation
--
-- Staff are NOT register rows. profiles.id and org_members.user_id
-- are both FKs to auth.users, so a staff member cannot exist
-- without an auth account. Creating one means an invite, and
-- invite-user's inviteUserByEmail creates the account AND sends
-- the email in a single call — there is no create-without-sending.
--
-- Therefore this stages rows. It creates no accounts and sends no
-- email. A separate, explicit action walks the staged rows through
-- invite-user afterwards, one at a time, recording each outcome.
--
-- A 200-row file with a typo'd domain would otherwise fire 200
-- unrecallable emails before anyone saw a single result.
--
-- Depends on stage 1 (import_batches) and stage 4 (can_bulk_import).
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
  -- INVERTED for LIVE.
  if n < 30 then
    raise exception 'ABORT P1: only % auth users - this looks like SANDBOX. This is the LIVE variant.', n;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='import_batches') then
    raise exception 'ABORT P2: import_batches missing — apply stage 1 first';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='can_bulk_import') then
    raise exception 'ABORT P2: can_bulk_import missing — apply stage 4 first';
  end if;
  raise notice 'PRE P2 stage 1 and stage 4 present';
end $$;

-- P3  import_batches.kind must already permit 'staff'.
do $$
declare v_def text;
begin
  select pg_get_constraintdef(con.oid) into v_def
  from pg_constraint con
  join pg_class rel on rel.oid=con.conrelid
  join pg_namespace ns on ns.oid=rel.relnamespace
  where ns.nspname='public' and rel.relname='import_batches'
    and con.contype='c' and pg_get_constraintdef(con.oid) ilike '%kind%';
  if v_def is null then
    raise notice 'PRE P3 no kind constraint — any value accepted';
  elsif v_def not ilike '%''staff''%' then
    raise exception 'ABORT P3: import_batches.kind does not permit staff: %', v_def;
  else
    raise notice 'PRE P3 import_batches.kind permits staff';
  end if;
end $$;

-- P4  Report the facts the email checks depend on, rather than
--     assuming them.
do $$
declare n_prof int; n_uniq int;
begin
  select count(*) into n_prof from information_schema.columns
  where table_schema='public' and table_name='profiles' and column_name='email';
  if n_prof = 0 then
    raise exception 'ABORT P4: profiles.email does not exist';
  end if;

  select count(*) into n_uniq
  from pg_constraint con
  join pg_class rel on rel.oid=con.conrelid
  join pg_namespace ns on ns.oid=rel.relnamespace
  where ns.nspname='public' and rel.relname='profiles'
    and con.contype='u' and pg_get_constraintdef(con.oid) ilike '%email%';
  raise notice 'PRE P4 profiles.email present, % unique constraint(s) on it', n_uniq;
end $$;

-- P5  org_custom_roles is the live job-role table. org_roles and
--     org_custom_positions are empty on both environments.
do $$
declare n int;
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='org_custom_roles') then
    raise exception 'ABORT P5: org_custom_roles missing';
  end if;
  select count(*) into n from public.org_custom_roles;
  raise notice 'PRE P5 org_custom_roles present, % rows (0 is expected in sandbox)', n;
end $$;


-- ---------- STAGING TABLE ----------

create table if not exists public.import_staff_rows (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references public.import_batches(id),
  org             text not null references public.organisations(id),
  row_no          integer not null,
  email           text not null,
  full_name       text not null,
  access_role     text not null
                    check (access_role in ('worker','supervisor','manager')),
  job_role        text,
  status          text not null default 'staged'
                    check (status in ('staged','invited','failed','cancelled')),
  invited_user_id uuid,
  error           text,
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  invited_at      timestamptz
);

comment on table public.import_staff_rows is
  'Staged staff invitations. Nothing here has an auth account yet. A separate send step walks these rows through the invite-user edge function, one at a time, and records the outcome per row. client_admin is deliberately NOT an option: invite-user clamps a caller to roles strictly below their own.';

create index if not exists import_staff_rows_batch_idx
  on public.import_staff_rows (batch_id, row_no);
create index if not exists import_staff_rows_pending_idx
  on public.import_staff_rows (org, status)
  where status = 'staged';

alter table public.import_staff_rows enable row level security;

drop policy if exists import_staff_rows_select on public.import_staff_rows;
create policy import_staff_rows_select
  on public.import_staff_rows
  for select to authenticated
  using (public.can_bulk_import(org));

-- No write policies. Everything goes through the functions below.
grant select on public.import_staff_rows to authenticated;


-- ---------- VALIDATION + STAGING ----------

create or replace function public.stage_staff_batch(
  p_org      text,
  p_rows     jsonb,
  p_filename text    default null,
  p_dry_run  boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_batch_id  uuid;
  v_elem      jsonb;
  v_idx       bigint;
  v_row_no    int;
  v_email     text;
  v_name      text;
  v_first     text;
  v_last      text;
  v_access    text;
  v_job       text;
  v_verdict   text;
  v_reason    text;
  v_seen      text[] := '{}';
  v_results   jsonb  := '[]'::jsonb;
  v_n_total   int := 0;
  v_n_ok      int := 0;
  v_n_error   int := 0;
  v_caller_lv int;
  v_lvl       int;
begin
  if v_uid is null then
    raise exception 'no authenticated user (auth.uid() is null): staff import must be called from a signed-in session';
  end if;

  if p_org is null or btrim(p_org) = '' then
    raise exception 'target organisation is required';
  end if;

  if not exists (select 1 from organisations where id = p_org) then
    raise exception 'organisation % not found', p_org;
  end if;

  if not can_bulk_import(p_org) then
    raise exception 'not permitted: staff import requires super_admin, or client_admin of this organisation';
  end if;

  -- Mirror invite-user's ROLE_LEVEL clamp. A caller may only grant
  -- a role STRICTLY BELOW their own, so staging must refuse here
  -- rather than letting every row fail later at send time.
  if is_super_admin() then
    v_caller_lv := 5;
  else
    select case m.role when 'client_admin' then 4 when 'manager' then 3
                       when 'supervisor' then 2 when 'worker' then 1 else 0 end
      into v_caller_lv
    from org_members m
    where m.user_id = v_uid and m.org = p_org and m.is_active is not false
    limit 1;
  end if;
  v_caller_lv := coalesce(v_caller_lv, 0);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a json array';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'p_rows is empty: nothing to stage';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'too many rows (%): staff invitations are limited to 500 per file',
      jsonb_array_length(p_rows);
  end if;

  for v_idx, v_elem in
    select ordinality, value from jsonb_array_elements(p_rows) with ordinality
  loop
    v_n_total := v_n_total + 1;
    v_row_no  := coalesce(nullif(v_elem->>'row_no','')::int, v_idx::int);
    v_verdict := null; v_reason := null;

    v_email  := lower(btrim(coalesce(v_elem->>'email','')));
    v_first  := btrim(coalesce(v_elem->>'first_name',''));
    v_last   := btrim(coalesce(v_elem->>'surname',''));
    v_name   := btrim(coalesce(nullif(btrim(coalesce(v_elem->>'full_name','')),''),
                               btrim(v_first || ' ' || v_last)));
    v_access := lower(btrim(coalesce(v_elem->>'access_role','')));
    v_job    := nullif(btrim(coalesce(v_elem->>'job_role','')), '');

    -- name
    if v_name = '' then
      v_verdict := 'error'; v_reason := 'a name is required';
    end if;

    -- email: required, unlike a client. There is no account without one.
    if v_verdict is null then
      if v_email = '' then
        v_verdict := 'error';
        v_reason  := 'an email address is required — staff need one to sign in';
      elsif v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        v_verdict := 'error';
        v_reason  := format('%L is not a valid email address', v_email);
      elsif v_email = any(v_seen) then
        v_verdict := 'error';
        v_reason  := 'this email appears earlier in the file';
      end if;
    end if;

    -- already a Taksyn user. Deliberately does not say which
    -- organisation: that is not this caller's business.
    if v_verdict is null then
      if exists (select 1 from auth.users u where lower(u.email) = v_email) then
        v_verdict := 'error';
        v_reason  := 'this email already has a Taksyn account — add them from Workforce instead';
      end if;
    end if;

    -- access role
    if v_verdict is null then
      if v_access = '' then
        v_verdict := 'error'; v_reason := 'an access level is required';
      elsif v_access not in ('worker','supervisor','manager') then
        v_verdict := 'error';
        v_reason  := format('access level %L is not one of worker, supervisor, manager', v_access);
      else
        v_lvl := case v_access when 'manager' then 3 when 'supervisor' then 2 else 1 end;
        if v_lvl >= v_caller_lv then
          v_verdict := 'error';
          v_reason  := format('you cannot grant %L — it is at or above your own access level', v_access);
        end if;
      end if;
    end if;

    -- job role: checked against the organisation's own list, but
    -- only when that list exists. An org with no roles configured
    -- should not have every row rejected.
    if v_verdict is null and v_job is not null then
      if exists (select 1 from org_custom_roles r where r.organisation_id = p_org) then
        if not exists (
          select 1 from org_custom_roles r
          where r.organisation_id = p_org
            and lower(btrim(r.role_name)) = lower(v_job)
        ) then
          v_verdict := 'error';
          v_reason  := format('job role %L is not one of this organisation''s roles', v_job);
        end if;
      end if;
    end if;

    if v_verdict is null then
      v_verdict := 'stage';
      v_seen    := v_seen || v_email;
      v_n_ok    := v_n_ok + 1;

      if not p_dry_run then
        if v_batch_id is null then
          insert into import_batches (org, kind, filename, rows_total, uploaded_by)
          values (p_org, 'staff', p_filename, jsonb_array_length(p_rows), v_uid)
          returning id into v_batch_id;
        end if;

        insert into import_staff_rows
          (batch_id, org, row_no, email, full_name, access_role, job_role, created_by)
        values
          (v_batch_id, p_org, v_row_no, v_email, v_name, v_access, v_job, v_uid);
      end if;
    else
      v_n_error := v_n_error + 1;
    end if;

    v_results := v_results || jsonb_build_object(
      'row_no', v_row_no, 'full_name', v_name, 'email', v_email,
      'access_role', v_access, 'job_role', v_job,
      'verdict', v_verdict, 'reason', v_reason
    );
  end loop;

  -- Whole-file gate, same as the client import.
  if not p_dry_run and v_n_error > 0 then
    raise exception 'refusing to stage: % of % rows are invalid. Run with p_dry_run => true to see each one.',
      v_n_error, v_n_total;
  end if;

  if not p_dry_run and v_batch_id is not null then
    update import_batches
       set rows_imported = v_n_ok, rows_skipped = v_n_error
     where id = v_batch_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'dry_run', p_dry_run, 'org', p_org, 'batch_id', v_batch_id,
    'counts', jsonb_build_object('total', v_n_total, 'staged', v_n_ok, 'errors', v_n_error),
    'rows', v_results
  );
end;
$function$;

comment on function public.stage_staff_batch(text, jsonb, text, boolean) is
  'Validates and stages staff rows for invitation. Creates NO accounts and sends NO email. Refuses roles at or above the caller''s own level, mirroring invite-user''s clamp, so a row cannot pass staging and then fail at send.';

revoke all on function public.stage_staff_batch(text, jsonb, text, boolean) from public, anon;
grant execute on function public.stage_staff_batch(text, jsonb, text, boolean) to authenticated;


-- ---------- RECORDING THE OUTCOME OF EACH SEND ----------

create or replace function public.mark_staff_row(
  p_row_id  uuid,
  p_status  text,
  p_user_id uuid default null,
  p_error   text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_org text;
begin
  if v_uid is null then
    raise exception 'no authenticated user (auth.uid() is null)';
  end if;
  if p_status not in ('invited','failed','cancelled') then
    raise exception 'status must be invited, failed or cancelled';
  end if;

  select org into v_org from import_staff_rows where id = p_row_id;
  if v_org is null then
    raise exception 'staged row % not found', p_row_id;
  end if;
  if not can_bulk_import(v_org) then
    raise exception 'not permitted for this organisation';
  end if;

  update import_staff_rows
     set status          = p_status,
         invited_user_id = coalesce(p_user_id, invited_user_id),
         error           = p_error,
         invited_at      = case when p_status = 'invited' then now() else invited_at end
   where id = p_row_id
     and status = 'staged';          -- never re-send an already-sent row

  if not found then
    raise exception 'row % was not staged — it may already have been sent', p_row_id;
  end if;

  return jsonb_build_object('ok', true, 'row_id', p_row_id, 'status', p_status);
end;
$function$;

comment on function public.mark_staff_row(uuid, text, uuid, text) is
  'Records the outcome of one invitation attempt. Only acts on a row still in staged state, so an invitation cannot be sent twice.';

revoke all on function public.mark_staff_row(uuid, text, uuid, text) from public, anon;
grant execute on function public.mark_staff_row(uuid, text, uuid, text) to authenticated;


-- ---------- POST ----------

do $$
declare missing text;
begin
  select string_agg(c, ', ') into missing
  from unnest(array['id','batch_id','org','row_no','email','full_name','access_role',
                    'job_role','status','invited_user_id','error','created_by',
                    'created_at','invited_at']) c
  where not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='import_staff_rows' and column_name=c
  );
  if missing is not null then
    raise exception 'ABORT Q1: import_staff_rows missing columns: %', missing;
  end if;
  raise notice 'POST Q1 import_staff_rows column set complete';
end $$;

do $$
declare v_sec boolean; v_cfg text[];
begin
  for v_sec, v_cfg in
    select p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('stage_staff_batch','mark_staff_row')
  loop
    if not v_sec then raise exception 'ABORT Q2: a function is not SECURITY DEFINER'; end if;
    if v_cfg is null or not (v_cfg @> array['search_path=public']) then
      raise exception 'ABORT Q2: search_path not pinned';
    end if;
  end loop;
  raise notice 'POST Q2 both functions DEFINER with pinned search_path';
end $$;

-- Q3  NEGATIVE CONTROL: null auth.uid() must be refused.
do $$
begin
  begin
    perform stage_staff_batch('ORGX', '[{"row_no":1,"email":"a@b.com","full_name":"A","access_role":"worker"}]'::jsonb);
    raise exception 'ABORT Q3: ran with a null auth.uid()';
  exception when sqlstate 'P0001' then
    if sqlerrm like '%ABORT Q3%' then raise; end if;
    raise notice 'POST Q3 refused as expected: %', sqlerrm;
  end;
end $$;

do $$
declare n_sel int; n_other int;
begin
  select count(*) filter (where cmd='SELECT'), count(*) filter (where cmd<>'SELECT')
    into n_sel, n_other
  from pg_policies where schemaname='public' and tablename='import_staff_rows';
  if n_sel <> 1 or n_other <> 0 then
    raise exception 'ABORT Q4: expected 1 SELECT policy and 0 write policies, got % / %', n_sel, n_other;
  end if;
  raise notice 'POST Q4 RLS: 1 SELECT policy, no write policies';
end $$;

do $$
declare n int;
begin
  select count(*) into n from public.import_staff_rows;
  if n <> 0 then
    raise exception 'ABORT Q5: import_staff_rows has % rows, expected 0', n;
  end if;
  raise notice 'POST Q5 no rows staged by this migration';
end $$;

commit;

select 'DONE-01 fns' as marker, p.proname,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('stage_staff_batch','mark_staff_row')
order by p.proname;

select 'DONE-02 table' as marker, count(*) as staged_rows from public.import_staff_rows;
