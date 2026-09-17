-- 2026-09-17-branches-invite.sql
-- Invites carry branches. When an invite is used, the new member is added to
-- those branches automatically.
--
-- WHY A TRIGGER: the person registering is a brand-new worker, and the
-- member_branches rules only let a client admin add rows. The trigger runs
-- with the database's rights, but only ever for the invite's own org, only
-- for branches that belong to that org and are active, and only once the
-- person is already a member of that org.
--
-- Fires when invite_links.used_by is set (registration marks the invite used
-- after writing org_members). Existing invites have no branches and are
-- unaffected.
-- Casts (::text) keep it working whatever type used_by / organisation_id
-- have on the target database.
-- Applied to SANDBOX (buqlbmgxevuldahhdbxo) 17 Sep 2026. NOT YET ON LIVE.
-- App side: patch_invite_branch_v1.py (INVITE-BRANCH-V1).

alter table public.invite_links
  add column if not exists branch_ids uuid[] not null default '{}';

create or replace function public.apply_invite_branches()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.used_by is null
     or new.used_by is not distinct from old.used_by
     or coalesce(array_length(new.branch_ids, 1), 0) = 0 then
    return new;
  end if;
  if not exists (select 1 from org_members m
                 where m.user_id::text = new.used_by::text
                   and m.org = new.organisation_id::text) then
    return new;
  end if;
  -- Never block the invite being marked used: a failure here is logged
  -- as a warning and the admin can tick the branches in Edit Member.
  begin
    insert into member_branches (org_id, user_id, branch_id)
    select new.organisation_id::text, new.used_by::text::uuid, b.id
      from org_branches b
     where b.id = any(new.branch_ids)
       and b.org_id = new.organisation_id::text
       and b.is_active
    on conflict (user_id, branch_id) do nothing;
  exception when others then
    raise warning 'apply_invite_branches: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_apply_invite_branches on public.invite_links;
create trigger trg_apply_invite_branches
  after update of used_by on public.invite_links
  for each row execute function public.apply_invite_branches();
