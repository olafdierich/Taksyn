-- 2026-08-12-notify-stage1.sql
-- [SANDBOX buqlbmgxevuldahhdbxo] FIRST. Do not run on LIVE until proven here.
--
-- Stage 1 of incident/complaint notifications: the durable queue and the
-- recipient resolver. No trigger, no sending. Stage 2 wires create_incident
-- and issue_reports to enqueue; Stage 3 drains via edge function -> Resend.
--
-- WHY A QUEUE, not an inline HTTP call:
--   create_incident is one transaction covering incident + events + evidence
--   + org_people_submissions. A slow or failed Resend call must never block
--   or roll back the recording of an incident. Enqueue is a local insert in
--   the same transaction: atomic, retryable, and the queue row IS the send
--   log that compliance needs ("notified at 19:42, to these addresses").
--   pg_net/pg_cron are AVAILABLE but NOT INSTALLED on this project; enabling
--   background machinery on a production db mid-pilot is deliberately avoided.
--
-- THE ORG KEY GREMLIN - the reason resolve_notify_recipients takes org_kind:
--   incidents.org      stores the org ID   (create_incident matches /^ORG/)
--   issue_reports.org  stores the org NAME (dashboard uses .eq('org',user.org))
--   org_members.org    stores the org ID
--   So complaints must be bridged name -> id via organisations before
--   org_members can be joined. Getting this wrong silently returns zero
--   recipients, which looks exactly like "nobody is configured".
--
-- EMAIL SOURCE: auth.users.email, NOT profiles.email. profiles.email is
--   synced FROM auth only at login (App.jsx ~17468/17493), so a user who
--   changed their address and has not signed in since has a stale row.
--   Notifying a dead address is worse than not notifying.

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------- PRE
do $$
begin
  if to_regclass('public.incident_config') is null then
    raise exception 'PRE-01 FAILED: incident_config missing - wrong database?';
  end if;
  if to_regclass('public.issue_reports') is null then
    raise exception 'PRE-02 FAILED: issue_reports missing - wrong database?';
  end if;
  if to_regclass('public.organisations') is null then
    raise exception 'PRE-03 FAILED: organisations missing - wrong database?';
  end if;
  raise notice 'PRE-OK: required tables present';
end $$;

-- ---------------------------------------------------------------- TABLE
create table if not exists public.notification_queue (
  id           bigserial primary key,
  org          text        not null,          -- as held by the SOURCE table
  org_id       text,                          -- resolved ORG… id, for joins
  kind         text        not null
               check (kind in ('incident','complaint')),
  source_id    text        not null,          -- incidents.id / issue_reports.id
  source_ref   text,                          -- INC-2026-0001 where it exists
  severity     int,                           -- incidents only; null otherwise
  subject      text        not null,
  body         text        not null,
  recipients   text[]      not null default '{}',
  -- Snapshot of who we INTENDED to notify, resolved at enqueue time. Kept
  -- even if roles later change: this is the audit record, not a live view.
  status       text        not null default 'pending'
               check (status in ('pending','sent','failed','skipped')),
  attempts     int         not null default 0,
  last_error   text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);

comment on table public.notification_queue is
  'Durable outbox for incident and complaint notifications. Rows are the send log: never deleted, status transitions pending->sent|failed|skipped.';

create index if not exists notification_queue_pending_idx
  on public.notification_queue (status, created_at)
  where status = 'pending';

create index if not exists notification_queue_org_idx
  on public.notification_queue (org_id, created_at desc);

create unique index if not exists notification_queue_source_uniq
  on public.notification_queue (kind, source_id);
-- One notification per source object. Makes the Stage 2 enqueue idempotent:
-- a retried insert cannot produce a duplicate email.

-- ---------------------------------------------------------------- RLS
alter table public.notification_queue enable row level security;

-- Read-only, and only for client_admin of that org. Nothing in the app
-- writes this table directly; enqueue is SECURITY DEFINER, drain is
-- service-role. No insert/update/delete policy is deliberate.
drop policy if exists notification_queue_select on public.notification_queue;
create policy notification_queue_select on public.notification_queue
  for select using (
    exists (
      select 1 from org_members m
       where m.user_id = auth.uid()
         and m.org     = notification_queue.org_id
         and m.role    = 'client_admin'
    )
  );

-- ---------------------------------------------------------------- RESOLVER
create or replace function public.resolve_notify_recipients(
  p_org      text,
  p_org_kind text,          -- 'id' (incidents) or 'name' (complaints)
  p_roles    text[]
)
returns table (user_id uuid, email text, role text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org_id text;
begin
  if p_org_kind = 'id' then
    v_org_id := p_org;
  elsif p_org_kind = 'name' then
    select g.id into v_org_id from organisations g where g.name = p_org limit 1;
  else
    raise exception 'p_org_kind must be id or name, got %', p_org_kind;
  end if;

  if v_org_id is null then
    return;   -- unresolvable org: zero rows, caller records skipped
  end if;

  return query
  select m.user_id,
         u.email::text,
         m.role
    from org_members m
    join auth.users u on u.id = m.user_id
   where m.org = v_org_id
     and m.role = any(p_roles)
     and u.email is not null
     and coalesce(m.is_active, true) is true;
end;
$function$;

comment on function public.resolve_notify_recipients(text,text,text[]) is
  'Resolves notify_roles to live email addresses. Reads auth.users.email, not profiles.email, which is stale until next login. p_org_kind bridges the incidents(id) vs issue_reports(name) key mismatch.';

revoke all on function public.resolve_notify_recipients(text,text,text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------- POST
do $$
declare
  v_cols int;
  v_pol  int;
begin
  if to_regclass('public.notification_queue') is null then
    raise exception 'POST-01 FAILED: notification_queue not created';
  end if;

  select count(*) into v_cols
    from information_schema.columns
   where table_schema='public' and table_name='notification_queue';
  if v_cols < 15 then
    raise exception 'POST-02 FAILED: expected >=15 columns, found %', v_cols;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='resolve_notify_recipients'
       and p.prosecdef is true
  ) then
    raise exception 'POST-03 FAILED: resolver missing or not SECURITY DEFINER';
  end if;

  select count(*) into v_pol from pg_policies
   where schemaname='public' and tablename='notification_queue';
  if v_pol <> 1 then
    raise exception 'POST-04 FAILED: expected exactly 1 policy, found %', v_pol;
  end if;

  if not exists (
    select 1 from pg_class where relname='notification_queue_source_uniq'
  ) then
    raise exception 'POST-05 FAILED: source uniqueness index missing';
  end if;

  raise notice 'POST-OK: table, resolver, policy and indexes all present';
end $$;

commit;

-- ------------------------------------------------------------- VERIFY
-- Run separately after commit. Expect zero rows queued and the resolver
-- returning the client_admin(s) for a known org.
select 'CHK-NOT-05' as marker, count(*) as queued from public.notification_queue;
