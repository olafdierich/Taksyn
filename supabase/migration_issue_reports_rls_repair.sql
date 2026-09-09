-- issue_reports RLS repair v1
--
-- APPLIED TO SANDBOX buqlbmgxevuldahhdbxo ON 2026-09-09.
-- This file is the applied record. Do not edit it. Promote to LIVE
-- byte-identical, or write a v2.
--
-- WHY:
-- Two policies on issue_reports carried names that asserted restrictions
-- their rules did not contain:
--
--   "Users can view issues in their org"   SELECT  qual = true
--   "Admins can update issues"             UPDATE  qual = true, with_check = null
--
-- Both evaluated to true for every authenticated user on the platform.
-- The UPDATE policy in particular allowed any authenticated user to alter
-- any row in any organisation, including writing a reported_by uuid onto
-- an anonymous complaint (fabricated attribution -- the anonymity guarantee
-- itself is not affected, since identity was never stored).
--
-- THE TRAP THIS AVOIDS:
-- issue_reports.org stores the org NAME. org_members.org stores the org ID.
-- A predicate comparing m.org = issue_reports.org matches nothing, raises
-- no error, and silently locks every user out of the queue. The join through
-- organisations is load-bearing, not decorative.
--
-- VERIFIED BEFORE APPLYING (sandbox):
--   CHK-IR-02  9 of 9 issue_reports rows resolve to an active member via
--              organisations.name -- the join matches.
--   CHK-IR-03  Two orgs hold rows: Demo Care Services 8, Test Org Alpha 1.
--   CHK-IR-04  A third org, Test Org Beta, holds 8 members and 0 rows --
--              the sharpest denial test (expects 0, not a smaller number).
--              One Test Org Alpha worker carries is_active = false.
--              No NULL is_active rows exist, but the clause says "is true"
--              explicitly rather than relying on their absence.
--   CHK-IR-05  org_members.user_id is uuid and NULLABLE. A null user_id
--              compared to auth.uid() yields NULL, not true, so it cannot
--              match -- the safe direction.
--   CHK-IR-06  Dry run under ROLLBACK returned the expected policy shape.
--
-- SCOPE NOTES:
--   SELECT is deliberately open to ANY active member of the org, not just
--   client_admin. The "Open Requests" dashboard count (App.jsx ~3167) is not
--   role-gated, and the submitter's own list (~17988) reads back their named
--   rows. Restricting SELECT to client_admin would make that card silently
--   read zero for everyone else -- a wrong number, not an error.
--
--   Internal admin notes must therefore NOT live on this table. They belong
--   in a child table with its own client_admin-only policy. This is the
--   reason issue_report_notes is a table and not a column.
--
--   The INSERT policy is untouched. Its anonymity wiring is correct and was
--   proven at the database level in July 2026.
--
-- NOT CLOSED BY THIS FILE:
--   A client_admin can still overwrite reported_by and is_anonymous on their
--   own org's rows. Policies cannot express column immutability. That needs a
--   BEFORE UPDATE trigger and is deliberately a separate step.

begin;

drop policy if exists "Users can view issues in their org" on public.issue_reports;
drop policy if exists "Admins can update issues" on public.issue_reports;

-- SELECT: any active member of the owning org.
create policy "ir_select_org_members"
on public.issue_reports for select to authenticated
using (
  exists (
    select 1 from public.org_members m
    join public.organisations o on o.id = m.org
    where m.user_id = auth.uid()
      and m.is_active is true
      and o.name = issue_reports.org
  )
);

-- UPDATE: client_admin of the owning org only.
-- WITH CHECK is NOT redundant with USING. USING decides which rows may be
-- touched; WITH CHECK decides what the row may look like afterwards. Without
-- it, a client_admin could rewrite org and move a complaint into another
-- organisation. The policy this replaces had no WITH CHECK at all.
create policy "ir_update_client_admin"
on public.issue_reports for update to authenticated
using (
  exists (
    select 1 from public.org_members m
    join public.organisations o on o.id = m.org
    where m.user_id = auth.uid()
      and m.is_active is true
      and m.role = 'client_admin'
      and o.name = issue_reports.org
  )
)
with check (
  exists (
    select 1 from public.org_members m
    join public.organisations o on o.id = m.org
    where m.user_id = auth.uid()
      and m.is_active is true
      and m.role = 'client_admin'
      and o.name = issue_reports.org
  )
);

commit;

-- Read-back is a SEPARATE statement. The Supabase SQL editor shows only the
-- last statement's grid, and DDL returns no rows:
--
--   select 'CHK-IR-07' as marker, policyname, cmd
--   from pg_policies where tablename='issue_reports' order by cmd, policyname;
--
-- Expect three rows: the untouched INSERT policy, ir_select_org_members,
-- ir_update_client_admin.
--
-- STRUCTURE IS NOT BEHAVIOUR. This file being applied proves the policies
-- exist, not that they discriminate. Denial must be demonstrated from real
-- authenticated sessions:
--
--   Alpha client_admin    SELECT 1 row     UPDATE permitted
--   Alpha active worker   SELECT 1 row     UPDATE denied (42501)
--   Alpha inactive worker SELECT 0 rows    UPDATE denied
--   Beta any member       SELECT 0 rows    UPDATE denied
--
-- A service-role token has BYPASSRLS and would make every denial pass
-- meaninglessly. Use the publishable key.
