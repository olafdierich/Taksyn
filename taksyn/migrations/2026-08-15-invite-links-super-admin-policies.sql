-- invite_links: add super_admin bypass; add missing DELETE policy.
-- Captured pre-state: CHK-IL-POL (LIVE) / CHK-IL-POL-S2 (SANDBOX), 15 Aug 2026.
-- Rollback: recreate the 3 originals without the is_super_admin() clause,
--           and drop the DELETE policy.

drop policy if exists "Users can insert invite links in same org" on public.invite_links;
create policy "Users can insert invite links in same org"
  on public.invite_links for insert to authenticated
  with check (
    is_super_admin()
    or organisation_id in (select om.org from org_members om where om.user_id = auth.uid())
  );

drop policy if exists "Users can read invite links in same org" on public.invite_links;
create policy "Users can read invite links in same org"
  on public.invite_links for select to authenticated
  using (
    is_super_admin()
    or organisation_id in (select om.org from org_members om where om.user_id = auth.uid())
  );

drop policy if exists "Users can update invite links in same org" on public.invite_links;
create policy "Users can update invite links in same org"
  on public.invite_links for update to authenticated
  using (
    is_super_admin()
    or organisation_id in (select om.org from org_members om where om.user_id = auth.uid())
  )
  with check (
    is_super_admin()
    or organisation_id in (select om.org from org_members om where om.user_id = auth.uid())
  );

create policy "Users can delete invite links in same org"
  on public.invite_links for delete to authenticated
  using (
    is_super_admin()
    or organisation_id in (select om.org from org_members om where om.user_id = auth.uid())
  );
