-- migration_issue_report_notes.sql
--
-- Admin-only note timeline on Complaints & Feedback, plus the transition
-- function that writes a status change and its note in one transaction.
--
-- APPLIED TO SANDBOX buqlbmgxevuldahhdbxo 2026-09-09 and proven (see
-- VERIFICATION below). NOT YET APPLIED TO LIVE.
--
-- LIVE PROMOTION ORDER -- these three run in sequence, and the order matters:
--   1. taksyn/scripts/issue_reports_rls_v1.sql   (RLS repair -- SECURITY FIX)
--   2. this file                                 (table + RPC)
--   3. deploy branch feat/complaint-notes        (commit 3fd2a3d)
--
-- Deploying the branch before this file gives every button on the
-- Complaints & Feedback screen "function issue_report_transition does not
-- exist". Vercel preview branches point at LIVE, so this applies to previews
-- as well as production.
--
--
-- WHAT PROBLEM THIS SOLVES
--
-- Before this work the screen had two buttons and no record. Marking
-- something In Progress wrote a status word and nothing else -- no actor,
-- no timestamp, no reason. There was nowhere to say what had been done.
--
-- Three verified defects sat underneath (see the App.jsx patch for the code):
--   1. resolved_by is a uuid column and the app wrote user.name into it.
--      Postgres rejected it with 22P02 every time. MARK RESOLVED HAD NEVER
--      WORKED -- sandbox held zero resolved rows across 9 issues.
--   2. The update result was discarded, so nothing on the screen could
--      report its own failure. This is why (1) went unnoticed for months.
--   3. The non-resolved branch nulled resolved_by/resolved_at, destroying
--      attribution on any move off resolved.
--
--
-- WHY A CHILD TABLE AND NOT A COLUMN
--
-- issue_reports SELECT must stay readable by ANY active member of the org:
-- the "Open Requests" dashboard count (App.jsx ~3167) is not role-gated, and
-- the submitter's own list (~17988) reads back their named rows. A note
-- column would inherit that permissive rule. Admin-only notes therefore
-- require their own table with their own policy. This is a consequence, not
-- a preference.
--
--
-- WHY THE POLICY PREDICATE IS WRITTEN OUT IN FULL
--
-- incident_events scopes its policies as
--   EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_events.incident_id)
-- with no auth.uid(), no org and no role. Every child row has a parent by
-- definition, so that predicate is effectively true; the real scoping is
-- inherited from the incidents table's own RLS and nothing in the policy says
-- so. Notes are admin-only, which is strictly NARROWER than the parent's
-- SELECT, so inheritance could not express it in any case.
--
--
-- THE JOIN TRAP
--
-- issue_reports.org holds the org NAME. org_members.org holds the org ID.
-- Comparing them directly matches nothing, raises no error, and silently
-- locks everyone out of the queue. The join through organisations is
-- load-bearing.
--
--
-- VERIFICATION (sandbox, 2026-09-09)
--   CHK-IR-15  dry run under ROLLBACK: 8 columns, 2 policies, 1 trigger,
--              rls_enabled true
--   CHK-IR-16  applied; both policies persist
--   CHK-IR-17  UPDATE on a note raises 42501 from the trigger -- append-only
--              holds even against a superuser connection, which RLS does not
--   CHK-IR-18  incident_transition is SECURITY INVOKER (prosecdef false);
--              this function matches
--   CHK-IR-22  end-to-end under impersonation: resolve wrote the status, the
--              note, the author name, and the transition in_progress ->
--              resolved, all in one transaction
--   CHK-IR-23  applied; SECURITY INVOKER, 4 arguments
--   Browser    three paths proven as Margaret Whitfield / Demo Care Services:
--              refusal with no note, resolve with a note, resolve via tickbox
--
-- STILL UNPROVEN: the denial cases. No session has demonstrated that a worker
-- CANNOT read a note or move a status -- only that an admin can. Closing this
-- needs sandbox passwords for a non-admin and a member of another org, probed
-- with the PUBLISHABLE key (a service-role token has BYPASSRLS and would make
-- every denial pass meaninglessly).

begin;

create table if not exists public.issue_report_notes (
  id           uuid primary key default gen_random_uuid(),
  issue_id     uuid not null references public.issue_reports(id) on delete cascade,
  author_id    uuid not null,
  author_name  text not null,
  body         text not null,
  status_from  text,
  status_to    text,
  created_at   timestamptz not null default now()
);

-- author_id AND author_name, both. The uuid is the durable link; the name is
-- a snapshot of how it read at the time, so a later rename does not silently
-- rewrite history. issue_reports.resolved_by stores only the uuid, which is
-- why the card had to print a raw id until the note timeline replaced it.
--
-- status_from / status_to are NULLABLE on purpose: a note written without a
-- status change -- a comment left while in progress -- has neither.

create index if not exists issue_report_notes_issue_id_created_idx
  on public.issue_report_notes (issue_id, created_at desc);

alter table public.issue_report_notes enable row level security;

create policy "irn_select_client_admin"
on public.issue_report_notes for select to authenticated
using (
  exists (
    select 1
    from public.issue_reports ir
    join public.organisations o on o.name = ir.org
    join public.org_members m on m.org = o.id
    where ir.id = issue_report_notes.issue_id
      and m.user_id = auth.uid()
      and m.is_active is true
      and m.role = 'client_admin'
  )
);

-- The author_id = auth.uid() clause stops an admin attributing a note to a
-- colleague. Without it the audit value of the table is optional.
create policy "irn_insert_client_admin"
on public.issue_report_notes for insert to authenticated
with check (
  author_id = auth.uid()
  and exists (
    select 1
    from public.issue_reports ir
    join public.organisations o on o.name = ir.org
    join public.org_members m on m.org = o.id
    where ir.id = issue_report_notes.issue_id
      and m.user_id = auth.uid()
      and m.is_active is true
      and m.role = 'client_admin'
  )
);

-- No UPDATE and no DELETE policy: RLS denies both by default, matching
-- incident_events. The trigger below closes what policies cannot -- BYPASSRLS
-- is not subject to them, so without it a service-role connection could edit
-- or remove a note silently. For a complaint record, "was this altered after
-- the fact" should be structurally no.
create or replace function public.issue_report_notes_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'issue_report_notes is append-only (attempted %)', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists issue_report_notes_immutable_trg on public.issue_report_notes;
create trigger issue_report_notes_immutable_trg
  before update or delete on public.issue_report_notes
  for each row execute function public.issue_report_notes_immutable();

-- NOTE ON THE CASCADE: the foreign key cascades on delete, but the trigger
-- blocks row-level deletes -- so deleting an issue_report that has notes will
-- FAIL rather than silently destroy them. issue_reports has no DELETE policy,
-- so this is unreachable from the app. Recorded so it is not a surprise later.


-- issue_report_transition -----------------------------------------------
--
-- SECURITY INVOKER, matching incident_transition (CHK-IR-18). It runs as the
-- caller, so RLS applies normally and ir_update_client_admin does the
-- authorisation. Nothing here escalates privilege.
--
-- Returns the updated row, again matching incident_transition, so the caller
-- can render from the result instead of guessing.
--
-- LIFECYCLE IS THREE STATUSES: open -> in_progress -> resolved.
-- 'closed' was present in the UI colour map but unreachable from the filter
-- row, and is deliberately NOT accepted here. Resolved is terminal, and the
-- Resolved tab is the archive.
--
-- A NOTE IS REQUIRED TO RESOLVE, or the no-note-required flag must be set --
-- and that flag WRITES ITS OWN NOTE ROW recording who decided nothing needed
-- saying. It is not an escape from the record. Same reasoning as
-- no_action_required on incidents: an undecided question should be visible.
-- Enforced here rather than by disabling a button, because a client-side
-- check alone is the silent-write shape this work removes.

create or replace function public.issue_report_transition(
  p_issue_id uuid,
  p_to_status text,
  p_note text default null,
  p_no_note_required boolean default false
)
returns public.issue_reports
language plpgsql
security invoker
as $$
declare
  v_row       public.issue_reports;
  v_from      text;
  v_actor     uuid := auth.uid();
  v_name      text;
  v_body      text;
begin
  -- Without this guard a null identity fails deep inside the insert with a
  -- not-null violation on author_id rather than saying what is wrong.
  if v_actor is null then
    raise exception 'no authenticated identity' using errcode = '42501';
  end if;

  if p_to_status not in ('open','in_progress','resolved') then
    raise exception 'invalid status: %', p_to_status using errcode = '22023';
  end if;

  select * into v_row from public.issue_reports where id = p_issue_id;
  if not found then
    raise exception 'issue not found' using errcode = '22023';
  end if;
  v_from := v_row.status;

  if p_to_status = 'resolved'
     and coalesce(btrim(p_note),'') = '' and not p_no_note_required then
    raise exception 'a note is required to resolve, or tick no-note-required'
      using errcode = '22023';
  end if;

  select name into v_name from public.profiles where id = v_actor;

  if p_to_status = 'resolved' then
    -- auth.uid() into resolved_by: a uuid into a uuid column. This is the fix
    -- for the defect that made Mark Resolved fail silently.
    update public.issue_reports
       set status = 'resolved', resolved_by = v_actor, resolved_at = now()
     where id = p_issue_id
     returning * into v_row;
  else
    -- Deliberately does NOT null resolved_by/resolved_at. The old code did,
    -- destroying attribution on any move off resolved. The card gates that
    -- display on status = 'resolved', so stale values cannot present as
    -- current fact.
    update public.issue_reports
       set status = p_to_status
     where id = p_issue_id
     returning * into v_row;
  end if;

  -- PostgREST returns success with error null when RLS blocks an update, so
  -- zero rows affected is the only signal that authorisation failed.
  if not found then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  v_body := coalesce(nullif(btrim(p_note),''), 'Resolved with no note required');

  if coalesce(btrim(p_note),'') <> '' or p_to_status = 'resolved' then
    insert into public.issue_report_notes
      (issue_id, author_id, author_name, body, status_from, status_to)
    values
      (p_issue_id, v_actor, coalesce(v_name,'Unknown'), v_body, v_from, p_to_status);
  end if;

  return v_row;
end;
$$;

grant execute on function public.issue_report_transition(uuid,text,text,boolean) to authenticated;

commit;

-- Read-back is a SEPARATE statement -- the Supabase SQL editor shows only the
-- last statement's grid and DDL returns no rows:
--
--   select 'CHK-IR-24' as marker,
--          (select count(*) from pg_policies
--            where tablename='issue_report_notes') as policies,
--          (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
--            where c.relname='issue_report_notes' and not t.tgisinternal) as triggers,
--          (select count(*) from pg_proc
--            where proname='issue_report_transition') as fn;
--
-- Expect: policies 2, triggers 1, fn 1.
