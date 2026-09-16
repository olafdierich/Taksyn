-- 2026-09-16-branches.sql
-- Branches / sites: tables, record columns, access rules, save-time check.
-- Applied to SANDBOX (buqlbmgxevuldahhdbxo) 16 Sep 2026. BR-T PASSED.
-- NOT YET ON LIVE.
--
-- Decisions:
--   * Empty branch_id = "All branches" = organisation-wide.
--   * Manager/supervisor with no branches assigned = organisation-wide.
--   * Deactivate, never delete (no cascade on the record FKs).
--   * tasks.industry_id already existed (uuid, with FK, 0 of 64 filled on
--     sandbox), so it is NOT added here. Empty = "General (any industry)".
--   * incidents.org stores the org ID; tasks.org and issue_reports.org store
--     the org NAME. check_record_branch handles both.
--
-- FINGERPRINTS. Raw md5(prosrc) depends on line endings: sandbox holds CRLF
-- (raw 83dc63dafe / 6c8b514c76). Compare CODE fingerprints instead
-- (comments stripped, whitespace collapsed) -- query at the bottom:
--   branch_visible       7795d46137
--   check_record_branch  0f21e1f1f4

begin;

-- ---------------------------------------------------------------- step 1
create table if not exists public.org_branches (
  id         uuid primary key default gen_random_uuid(),
  org_id     text not null references public.organisations(id),
  name       text not null check (length(trim(name)) > 0),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (id, org_id)
);
create unique index if not exists org_branches_name_uq
  on public.org_branches (org_id, lower(trim(name)));

create table if not exists public.member_branches (
  org_id     text not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  branch_id  uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (user_id, branch_id),
  foreign key (branch_id, org_id) references public.org_branches (id, org_id)
);

create table if not exists public.member_industries (
  org_id      text not null references public.organisations(id),
  user_id     uuid not null references auth.users(id) on delete cascade,
  industry_id uuid not null references public.global_industries(id),
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (user_id, org_id, industry_id)
);
create unique index if not exists member_industries_one_primary
  on public.member_industries (user_id, org_id) where is_primary;

alter table public.tasks         add column if not exists branch_id uuid references public.org_branches(id);
alter table public.incidents     add column if not exists branch_id uuid references public.org_branches(id);
alter table public.issue_reports add column if not exists branch_id uuid references public.org_branches(id);

alter table public.org_branches      enable row level security;
alter table public.member_branches   enable row level security;
alter table public.member_industries enable row level security;

-- ---------------------------------------------------------------- step 2
create or replace function public.branch_visible(p_org_id text, p_branch_id uuid)
returns boolean language plpgsql stable security definer
set search_path = public as $$
declare v_role text;
begin
  if public.is_super_admin() then return true; end if;
  v_role := public.my_role_in(p_org_id);
  if v_role is null then return false; end if;
  if p_branch_id is null then return true; end if;
  if v_role not in ('manager','supervisor') then return true; end if;
  if not exists (select 1 from member_branches
                 where user_id = auth.uid() and org_id = p_org_id)
    then return true; end if;
  return exists (select 1 from member_branches
                 where user_id = auth.uid() and org_id = p_org_id
                   and branch_id = p_branch_id);
end $$;
revoke all on function public.branch_visible(text, uuid) from public, anon;
grant execute on function public.branch_visible(text, uuid) to authenticated;

drop policy if exists br_select on public.org_branches;
drop policy if exists br_insert on public.org_branches;
drop policy if exists br_update on public.org_branches;
create policy br_select on public.org_branches for select to authenticated
  using (public.is_super_admin() or public.my_role_in(org_id) is not null);
create policy br_insert on public.org_branches for insert to authenticated
  with check (public.is_super_admin() or public.my_role_in(org_id) = 'client_admin');
create policy br_update on public.org_branches for update to authenticated
  using      (public.is_super_admin() or public.my_role_in(org_id) = 'client_admin')
  with check (public.is_super_admin() or public.my_role_in(org_id) = 'client_admin');

drop policy if exists mb_select on public.member_branches;
drop policy if exists mb_insert on public.member_branches;
drop policy if exists mb_delete on public.member_branches;
create policy mb_select on public.member_branches for select to authenticated
  using (public.is_super_admin() or user_id = auth.uid()
         or public.my_role_in(org_id) in ('client_admin','manager','supervisor'));
create policy mb_insert on public.member_branches for insert to authenticated
  with check ((public.is_super_admin() or public.my_role_in(org_id) = 'client_admin')
    and exists (select 1 from public.org_members m
                where m.user_id = member_branches.user_id
                  and m.org = member_branches.org_id));
create policy mb_delete on public.member_branches for delete to authenticated
  using (public.is_super_admin() or public.my_role_in(org_id) = 'client_admin');

drop policy if exists mi_select on public.member_industries;
drop policy if exists mi_insert on public.member_industries;
drop policy if exists mi_update on public.member_industries;
drop policy if exists mi_delete on public.member_industries;
create policy mi_select on public.member_industries for select to authenticated
  using (public.is_super_admin() or user_id = auth.uid()
         or public.my_role_in(org_id) in ('client_admin','manager','supervisor'));
create policy mi_insert on public.member_industries for insert to authenticated
  with check ((public.is_super_admin() or public.my_role_in(org_id) = 'client_admin')
    and exists (select 1 from public.org_members m
                where m.user_id = member_industries.user_id
                  and m.org = member_industries.org_id));
create policy mi_update on public.member_industries for update to authenticated
  using      (public.is_super_admin() or public.my_role_in(org_id) = 'client_admin')
  with check (public.is_super_admin() or public.my_role_in(org_id) = 'client_admin');
create policy mi_delete on public.member_industries for delete to authenticated
  using (public.is_super_admin() or public.my_role_in(org_id) = 'client_admin');

create or replace function public.check_record_branch()
returns trigger language plpgsql security definer
set search_path = public as $$
declare v_branch_org text; v_active boolean; v_ok boolean;
begin
  if new.branch_id is null then return new; end if;
  select org_id, is_active into v_branch_org, v_active
    from org_branches where id = new.branch_id;
  if v_branch_org is null then
    raise exception 'BRANCH: branch not found';
  end if;
  if tg_table_name = 'incidents' then
    v_ok := (new.org = v_branch_org);
  else
    v_ok := exists (select 1 from organisations o
                    where o.id = v_branch_org and o.name = new.org);
  end if;
  if not v_ok then
    raise exception 'BRANCH: branch belongs to a different organisation';
  end if;
  if not v_active then
    if tg_op = 'INSERT' then
      raise exception 'BRANCH: this branch has been deactivated';
    elsif new.branch_id is distinct from old.branch_id then
      raise exception 'BRANCH: this branch has been deactivated';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_check_branch on public.tasks;
drop trigger if exists trg_check_branch on public.incidents;
drop trigger if exists trg_check_branch on public.issue_reports;
create trigger trg_check_branch before insert or update of branch_id, org
  on public.tasks for each row execute function public.check_record_branch();
create trigger trg_check_branch before insert or update of branch_id, org
  on public.incidents for each row execute function public.check_record_branch();
create trigger trg_check_branch before insert or update of branch_id, org
  on public.issue_reports for each row execute function public.check_record_branch();

commit;

-- ---------------------------------------------------------------- check
-- Expect: branch_visible 7795d46137, check_record_branch 0f21e1f1f4
-- select proname,
--        left(md5(btrim(regexp_replace(
--          regexp_replace(prosrc, '--[^' || chr(10) || ']*', '', 'g'),
--          '\s+', ' ', 'g'), ' ')), 10) as code_fingerprint
-- from pg_proc
-- where proname in ('branch_visible','check_record_branch');
