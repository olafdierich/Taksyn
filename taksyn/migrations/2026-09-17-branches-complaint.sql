-- 2026-09-17-branches-complaint.sql
-- Complaints (issue_reports) must name a branch once the org has an active
-- branch. INSERT only: existing complaints can still be updated and resolved.
-- issue_reports.org stores the org NAME, so the org is matched by name.
-- Applied to SANDBOX (buqlbmgxevuldahhdbxo) 17 Sep 2026. NOT YET ON LIVE.
-- App side: patch_complaint_branch_v1.py (COMPLAINT-BRANCH-V1) ships with it.

create or replace function public.require_complaint_branch()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.branch_id is null and exists (
       select 1 from org_branches b
       join organisations o on o.id = b.org_id
       where o.name = new.org and b.is_active) then
    raise exception 'BRANCH: please choose the branch this is about';
  end if;
  return new;
end $$;

drop trigger if exists trg_require_complaint_branch on public.issue_reports;
create trigger trg_require_complaint_branch
  before insert on public.issue_reports
  for each row execute function public.require_complaint_branch();
