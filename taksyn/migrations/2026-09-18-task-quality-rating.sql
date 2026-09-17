-- =====================================================================
-- Taksyn migration: task quality rating (5 ticks)
-- Written 18 September 2026. Applied to SANDBOX buqlbmgxevuldahhdbxo
-- by hand the same night; this file reproduces that state exactly.
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.
-- Safe to re-run.
--
-- APPLYING TO LIVE -- READ FIRST
--   The Supabase SQL editor rewrites text shaped like "select <col> into
--   <name>", INCLUDING inside function bodies. tasks_supervisor_scope_guard
--   contains two such lines. If this file is pasted into the editor, check
--   the fingerprints below afterwards; if they do not match, the editor
--   mangled it -- apply via psql, or base64-encode inside a do $run$ block.
--
--   psql -v ON_ERROR_STOP=1 -f 2026-09-18-task-quality-rating.sql
--
-- EXPECTED FINGERPRINTS AFTER APPLYING (see verification at the foot)
--   task_occurrences_approval_guard  0811cf34e6
--   tasks_supervisor_scope_guard     7e0427eb1e
--
-- ORDER MATTERS AGAINST THE APP
--   Once this is applied, approving from a browser session REQUIRES a
--   rating. Deploy the UI that sends one in the same window, or reviewers
--   cannot approve. Server-side callers (null auth.uid()) are exempt by
--   design -- see the note in the guards.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Rating columns. Identical in name and type on both tables: a name
--    differing by one character produces a silent zero in the reporting
--    helper rather than an error.
-- ---------------------------------------------------------------------

alter table public.tasks
  add column if not exists quality_rating   smallint,
  add column if not exists rating_reason    text,
  add column if not exists rated_by_id      uuid,
  add column if not exists rated_by_name    text,
  add column if not exists rated_at         timestamptz,
  add column if not exists rating_source    text,
  add column if not exists worker_reply     text,
  add column if not exists worker_reply_at  timestamptz;

alter table public.task_occurrences
  add column if not exists quality_rating   smallint,
  add column if not exists rating_reason    text,
  add column if not exists rated_by_id      uuid,
  add column if not exists rated_by_name    text,
  add column if not exists rated_at         timestamptz,
  add column if not exists rating_source    text,
  add column if not exists worker_reply     text,
  add column if not exists worker_reply_at  timestamptz;

-- ---------------------------------------------------------------------
-- 2. Constraints. ADD CONSTRAINT has no IF NOT EXISTS, so each is wrapped.
--    A rating below 3 must carry a reason: it costs nothing to give a 5
--    and something to give a 2, which is the right way round.
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.tasks'::regclass
                   and conname  = 'tasks_quality_rating_range') then
    alter table public.tasks
      add constraint tasks_quality_rating_range
        check (quality_rating is null or quality_rating between 1 and 5);
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.tasks'::regclass
                   and conname  = 'tasks_low_rating_needs_reason') then
    alter table public.tasks
      add constraint tasks_low_rating_needs_reason
        check (quality_rating is null or quality_rating >= 3
               or btrim(coalesce(rating_reason,'')) <> '');
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.task_occurrences'::regclass
                   and conname  = 'task_occurrences_quality_rating_range') then
    alter table public.task_occurrences
      add constraint task_occurrences_quality_rating_range
        check (quality_rating is null or quality_rating between 1 and 5);
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.task_occurrences'::regclass
                   and conname  = 'task_occurrences_low_rating_needs_reason') then
    alter table public.task_occurrences
      add constraint task_occurrences_low_rating_needs_reason
        check (quality_rating is null or quality_rating >= 3
               or btrim(coalesce(rating_reason,'')) <> '');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Append-only rating history. The 24-hour cool-off means a later
--    correction is a NEW entry beside the old one, never an overwrite,
--    so the history IS the audit story -- same model as incident_events
--    and bulk_approvals.
--
--    subject_id is TEXT because tasks.id is text. An occurrence uuid casts
--    into text cleanly; the reverse does not.
-- ---------------------------------------------------------------------

create table if not exists public.task_rating_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        text not null,
  subject_kind  text not null check (subject_kind in ('task','occurrence')),
  subject_id    text not null,
  event_kind    text not null
                check (event_kind in ('rated','amended','replied','cleared')),
  rating        smallint check (rating is null or rating between 1 and 5),
  reason        text,
  actor_id      uuid,
  actor_name    text,
  source        text,
  created_at    timestamptz not null default now()
);

create index if not exists task_rating_events_subject_idx
  on public.task_rating_events (subject_kind, subject_id, created_at desc);

alter table public.task_rating_events enable row level security;

-- INSERT admits any org member, NOT admins only: 'replied' events are
-- written by the worker about their own rating, and an admin-only policy
-- would silently block every right of reply. Self-attribution does the work.
-- No UPDATE policy and no DELETE policy -- append-only by absence.
drop policy if exists task_rating_events_select on public.task_rating_events;
create policy task_rating_events_select
  on public.task_rating_events
  for select
  using (is_org_member(org_id));

drop policy if exists task_rating_events_insert on public.task_rating_events;
create policy task_rating_events_insert
  on public.task_rating_events
  for insert
  with check (is_org_member(org_id) and actor_id = auth.uid());

-- ---------------------------------------------------------------------
-- 4. Occurrence guard. Replaces the 29 July version.
--
--    TWO INDEPENDENT FLAGS. The previous version had one "touched"
--    boolean gating a single approval_source stamp. Folding the rating
--    columns into it would mean a rating amended a day later rewrites the
--    APPROVAL's provenance -- and amended from the SQL editor it would
--    stamp 'server' onto an approval that came from a browser. That column
--    identified a stale-paste incident on 31 July; it must stay truthful.
--
--    TRANSITION TEST, NOT TOUCH TEST. Both environments already hold
--    approvals from July. A touch test would demand a rating from every
--    one of them the moment anyone wrote to the row.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.task_occurrences_approval_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  appr_touched  boolean;
  rate_touched  boolean;
  became_appr   boolean;
  became_unappr boolean;
  caller        uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    appr_touched := (NEW.approved_by_id    IS NOT NULL
                  OR NEW.approved_by_name  IS NOT NULL
                  OR NEW.approved_at       IS NOT NULL
                  OR NEW.approval_batch_id IS NOT NULL
                  OR NEW.approval_source   IS NOT NULL);
    rate_touched := (NEW.quality_rating  IS NOT NULL
                  OR NEW.rating_reason   IS NOT NULL
                  OR NEW.rated_by_id     IS NOT NULL
                  OR NEW.rated_by_name   IS NOT NULL
                  OR NEW.rated_at        IS NOT NULL
                  OR NEW.rating_source   IS NOT NULL
                  OR NEW.worker_reply    IS NOT NULL
                  OR NEW.worker_reply_at IS NOT NULL);
    became_appr   := (NEW.approved_at IS NOT NULL
                   OR NEW.approval_batch_id IS NOT NULL);
    became_unappr := false;
  ELSE
    -- approved_by_name WAS MISSING FROM BOTH BRANCHES until 29 July 2026.
    -- An UPDATE touching only that column computed touched=false, took the
    -- early return below, and never reached is_org_admin(). The rating
    -- columns sit in the same position: omit one and it becomes writable
    -- by any org member, worker included.
    appr_touched := (NEW.approved_by_id    IS DISTINCT FROM OLD.approved_by_id
                  OR NEW.approved_by_name  IS DISTINCT FROM OLD.approved_by_name
                  OR NEW.approved_at       IS DISTINCT FROM OLD.approved_at
                  OR NEW.approval_batch_id IS DISTINCT FROM OLD.approval_batch_id
                  OR NEW.approval_source   IS DISTINCT FROM OLD.approval_source);
    rate_touched := (NEW.quality_rating  IS DISTINCT FROM OLD.quality_rating
                  OR NEW.rating_reason   IS DISTINCT FROM OLD.rating_reason
                  OR NEW.rated_by_id     IS DISTINCT FROM OLD.rated_by_id
                  OR NEW.rated_by_name   IS DISTINCT FROM OLD.rated_by_name
                  OR NEW.rated_at        IS DISTINCT FROM OLD.rated_at
                  OR NEW.rating_source   IS DISTINCT FROM OLD.rating_source
                  OR NEW.worker_reply    IS DISTINCT FROM OLD.worker_reply
                  OR NEW.worker_reply_at IS DISTINCT FROM OLD.worker_reply_at);
    -- Transition tests, NOT touch tests. Both environments already hold
    -- July approvals; a touch test would demand a rating from every one.
    became_appr   := (OLD.approved_at IS NULL AND OLD.approval_batch_id IS NULL)
                 AND (NEW.approved_at IS NOT NULL OR NEW.approval_batch_id IS NOT NULL);
    became_unappr := (OLD.approved_at IS NOT NULL OR OLD.approval_batch_id IS NOT NULL)
                 AND (NEW.approved_at IS NULL AND NEW.approval_batch_id IS NULL);
  END IF;

  -- Hot path: the miss-writer and the completed path. Runs on every
  -- occurrence write on every task load. Must stay cheap.
  IF NOT appr_touched AND NOT rate_touched THEN
    RETURN NEW;
  END IF;

  -- Server-side context. Decision 8.1 Option 3: the write is permitted so
  -- migration, backfill and repair remain possible, but it is stamped so it
  -- cannot read as a user attestation. Each source is stamped independently
  -- -- a rating amendment must never rewrite the approval's provenance.
  IF caller IS NULL THEN
    IF appr_touched THEN NEW.approval_source := 'server'; END IF;
    IF rate_touched THEN NEW.rating_source   := 'server'; END IF;
    IF became_unappr THEN
      NEW.quality_rating := NULL; NEW.rating_reason := NULL;
      NEW.rated_by_id    := NULL; NEW.rated_by_name := NULL;
      NEW.rated_at       := NULL; NEW.rating_source := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT is_org_admin(org_id_for(NEW.org)) THEN
    RAISE EXCEPTION
      'TOCC-GUARD: approval and rating columns require manager or client_admin (org=%, uid=%)',
      NEW.org, caller
      USING ERRCODE = '42501';
  END IF;

  -- Self-attribution: nobody may attest, or rate, in someone else's name.
  IF NEW.approved_by_id IS NOT NULL AND NEW.approved_by_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION
      'TOCC-GUARD: approved_by_id must equal the calling user (got %, expected %)',
      NEW.approved_by_id, caller
      USING ERRCODE = '42501';
  END IF;

  IF NEW.rated_by_id IS NOT NULL AND NEW.rated_by_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION
      'TOCC-GUARD: rated_by_id must equal the calling user (got %, expected %)',
      NEW.rated_by_id, caller
      USING ERRCODE = '42501';
  END IF;

  -- An approval carries a judgement, or it does not happen.
  IF became_appr AND NEW.quality_rating IS NULL THEN
    RAISE EXCEPTION
      'TOCC-GUARD: a quality rating of 1-5 is required to approve an occurrence'
      USING ERRCODE = '22023';
  END IF;

  -- 24-hour cool-off. After it, a correction is a new event beside the old
  -- one, never an overwrite. Un-approval is exempt: it clears, not amends.
  IF TG_OP = 'UPDATE' AND NOT became_unappr
     AND OLD.rated_at IS NOT NULL
     AND now() - OLD.rated_at > interval '24 hours'
     AND (NEW.quality_rating IS DISTINCT FROM OLD.quality_rating
       OR NEW.rating_reason  IS DISTINCT FROM OLD.rating_reason) THEN
    RAISE EXCEPTION
      'TOCC-GUARD: rating locked (rated %); record a new rating event instead',
      OLD.rated_at
      USING ERRCODE = '22023';
  END IF;

  -- Assigned, never validated. A caller cannot present itself as anything.
  IF appr_touched THEN NEW.approval_source := 'user'; END IF;
  IF rate_touched THEN NEW.rating_source   := 'user'; END IF;

  -- Clearing runs LAST. Before the stamps it would write rating_source
  -- onto a rating that no longer exists.
  IF became_unappr THEN
    NEW.quality_rating := NULL; NEW.rating_reason := NULL;
    NEW.rated_by_id    := NULL; NEW.rated_by_name := NULL;
    NEW.rated_at       := NULL; NEW.rating_source := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------
-- 5. Task guard. The rating block goes INSIDE the existing supervisor
--    scope guard rather than into a second trigger: two BEFORE triggers
--    both deciding what an approval requires is how they drift apart,
--    and Postgres fires them in alphabetical name order, which is a
--    fragile thing to depend on.
--
--    The function name now understates what it does. Worth a rename in a
--    later pass; not worth the churn here.
--
--    PERMISSION IS APPROVER-BASED (ruled 18 Sep). Whoever is named as the
--    task's approver may rate it, whatever their role -- otherwise a
--    supervisor could approve a Low task but not rate it, and with rating
--    mandatory that removes the approval right the September ruling gave
--    them. Org admins and super admins may also rate.
--
--    my_role_in() returns NULL for a non-member, so the check PERMITS an
--    explicit set rather than DENYING one. Framed the other way round, a
--    null role would sail through.
--
--    The rating block sits ABOVE the org-resolution early return. That
--    return is a pre-existing hole -- a task whose org does not resolve
--    bypasses every supervisor rule silently -- and the rating rules must
--    not inherit it, so the permission check resolves its own org and
--    treats a failure as denial.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tasks_supervisor_scope_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_org text; v_role text; v_appr text;
  rate_touched boolean; became_appr boolean; became_unappr boolean;
  v_is_approver boolean; v_rate_org text;
begin
  -- [RATING-V1] Rating flags, computed before any early return.
  if tg_op = 'INSERT' then
    rate_touched := (new.quality_rating is not null or new.rating_reason is not null
                  or new.rated_by_id is not null  or new.rated_by_name is not null
                  or new.rated_at is not null     or new.rating_source is not null
                  or new.worker_reply is not null or new.worker_reply_at is not null);
    became_appr   := coalesce(new.status,'') = 'approved';
    became_unappr := false;
  else
    rate_touched := (new.quality_rating is distinct from old.quality_rating
                  or new.rating_reason  is distinct from old.rating_reason
                  or new.rated_by_id    is distinct from old.rated_by_id
                  or new.rated_by_name  is distinct from old.rated_by_name
                  or new.rated_at       is distinct from old.rated_at
                  or new.rating_source  is distinct from old.rating_source
                  or new.worker_reply   is distinct from old.worker_reply
                  or new.worker_reply_at is distinct from old.worker_reply_at);
    became_appr   := new.status is distinct from old.status and new.status = 'approved';
    became_unappr := coalesce(old.status,'') = 'approved'
                     and new.status is distinct from old.status;
  end if;

  if v_uid is null then
    if rate_touched then new.rating_source := 'server'; end if;
    if became_unappr then
      new.quality_rating := null; new.rating_reason := null;
      new.rated_by_id    := null; new.rated_by_name := null;
      new.rated_at       := null; new.rating_source := null;
    end if;
    return new;  -- system jobs and service calls pass
  end if;

  -- An approval carries a judgement, or it does not happen.
  if became_appr and new.quality_rating is null then
    raise exception 'TASK-GUARD: a quality rating of 1-5 is required to approve a task'
      using errcode = '22023';
  end if;

  -- Nobody rates in someone else's name.
  if new.rated_by_id is not null and new.rated_by_id is distinct from v_uid then
    raise exception 'TASK-GUARD: rated_by_id must equal the calling user (got %, expected %)',
      new.rated_by_id, v_uid using errcode = '42501';
  end if;

  -- Approver-based permission. my_role_in() returns NULL for a non-member, so
  -- this permits an explicit set rather than denying one. An unresolvable org
  -- DENIES here -- it must not inherit the silent pass further down.
  if rate_touched then
    v_is_approver := (new.approver_id is not null
                      and new.approver_id::text = v_uid::text);
    if not v_is_approver and not is_super_admin() then
      select id into v_rate_org from organisations
        where lower(name) = lower(new.org) limit 1;
      if v_rate_org is null or not is_org_admin(v_rate_org) then
        raise exception
          'TASK-GUARD: only the task approver, an org admin or a super admin may rate (uid=%)',
          v_uid using errcode = '42501';
      end if;
    end if;
  end if;

  -- 24-hour cool-off. A later correction is a new event, not an overwrite.
  if tg_op = 'UPDATE' and not became_unappr
     and old.rated_at is not null
     and now() - old.rated_at > interval '24 hours'
     and (new.quality_rating is distinct from old.quality_rating
       or new.rating_reason  is distinct from old.rating_reason) then
    raise exception 'TASK-GUARD: rating locked (rated %); record a new rating event instead',
      old.rated_at using errcode = '22023';
  end if;

  if rate_touched then new.rating_source := 'user'; end if;

  -- Clearing runs after the stamp, never before.
  if became_unappr then
    new.quality_rating := null; new.rating_reason := null;
    new.rated_by_id    := null; new.rated_by_name := null;
    new.rated_at       := null; new.rating_source := null;
  end if;

  -- ===== existing supervisor scope rules, unchanged below this line =====
  select id into v_org from organisations where lower(name) = lower(new.org) limit 1;
  if v_org is null then return new; end if;
  v_role := my_role_in(v_org);
  if v_role = 'supervisor' then
    if tg_op = 'INSERT' and coalesce(new.priority,'') <> 'low' then
      raise exception 'Supervisors can only create Low priority tasks. Please contact your manager to create this task.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.priority is distinct from old.priority and coalesce(new.priority,'') <> 'low' then
      raise exception 'Supervisors cannot raise a task above Low priority.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved','rejected')
       and coalesce(new.priority,'') <> 'low' then
      raise exception 'Supervisors can only approve Low priority tasks.' using errcode = '42501';
    end if;
  end if;
  if coalesce(new.priority,'') <> 'low' and new.approver_id is not null
     and (tg_op = 'INSERT' or new.priority is distinct from old.priority or new.approver_id is distinct from old.approver_id) then
    select role into v_appr from org_members where user_id::text = new.approver_id::text and org = v_org;
    if v_appr = 'supervisor' then
      raise exception 'Tasks above Low priority need a manager or administrator as approver.' using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;

commit;

-- =====================================================================
-- VERIFICATION -- run separately after the transaction commits.
-- Expect 4 columns rows (8 each side), 4 constraints, 2 policies,
-- RLS true, and both fingerprints matching the header.
-- =====================================================================

-- select 'VERIFY-1' as marker, table_name, count(*) as rating_columns
-- from information_schema.columns
-- where table_schema='public'
--   and table_name in ('tasks','task_occurrences')
--   and column_name in ('quality_rating','rating_reason','rated_by_id',
--                       'rated_by_name','rated_at','rating_source',
--                       'worker_reply','worker_reply_at')
-- group by table_name;

-- select 'VERIFY-2' as marker, conrelid::regclass::text as tbl, conname
-- from pg_constraint
-- where conrelid in ('public.tasks'::regclass,'public.task_occurrences'::regclass)
--   and conname like '%rating%'
-- order by tbl, conname;

-- select 'VERIFY-3' as marker, policyname, cmd
-- from pg_policies
-- where schemaname='public' and tablename='task_rating_events'
-- order by cmd;

-- select 'VERIFY-4' as marker, relname, relrowsecurity
-- from pg_class where oid = 'public.task_rating_events'::regclass;

-- select 'VERIFY-5' as marker, proname, prosecdef, proconfig,
--        left(md5(prosrc),10) as fingerprint
-- from pg_proc
-- where pronamespace='public'::regnamespace
--   and proname in ('task_occurrences_approval_guard',
--                   'tasks_supervisor_scope_guard')
-- order by proname;
