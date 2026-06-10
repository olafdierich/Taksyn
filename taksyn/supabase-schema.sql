-- ============================================================
-- TAKSYN – Supabase Database Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. USER PROFILES (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id          UUID REFERENCES auth.users(id) PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'worker'
                CHECK (role IN ('super_admin','client_admin','manager','supervisor','worker')),
  tier        TEXT NOT NULL DEFAULT 'Growth'
                CHECK (tier IN ('Personal','Starter','Growth','Professional','Enterprise')),
  org         TEXT NOT NULL DEFAULT 'My Organisation',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, tier, org)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'worker'),
    'Growth',
    'My Organisation'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 2. TASKS
CREATE TABLE public.tasks (
  id              TEXT PRIMARY KEY DEFAULT 'T' || LPAD(NEXTVAL('task_seq')::TEXT, 3, '0'),
  title           TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'General',
  assigned_role   TEXT NOT NULL DEFAULT 'worker',
  assigned_user   UUID REFERENCES public.profiles(id),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','in_progress','awaiting_review','completed','approved','rejected','overdue','escalated')),
  priority        TEXT NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('critical','high','medium','low')),
  due_date        DATE,
  compliance      BOOLEAN DEFAULT FALSE,
  escalation      BOOLEAN DEFAULT FALSE,
  subtasks        JSONB DEFAULT '[]',
  evidence        JSONB DEFAULT '[]',
  comments        JSONB DEFAULT '[]',
  created_by      UUID REFERENCES public.profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS task_seq START 1;

-- 3. ROW LEVEL SECURITY
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks    ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all, update their own
CREATE POLICY "profiles_read_all"   ON public.profiles FOR SELECT USING (TRUE);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Tasks: all authenticated users can read; admins/managers can insert/update
CREATE POLICY "tasks_read_all"    ON public.tasks FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "tasks_insert_auth" ON public.tasks FOR INSERT TO authenticated WITH CHECK (TRUE);
CREATE POLICY "tasks_update_auth" ON public.tasks FOR UPDATE TO authenticated USING (TRUE);

-- 3b. AUDIT LOG
-- Tracks all meaningful events: task lifecycle, evidence, comments, checklist,
-- member management, leave, report exports, and session events.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id                  TEXT PRIMARY KEY,
  event_type          TEXT NOT NULL DEFAULT 'status_change',
  task_id             TEXT,
  task_title          TEXT,
  by                  TEXT,                        -- display name of the actor
  by_id               UUID,                        -- auth user id of the actor
  by_role             TEXT,                        -- role at time of action
  org                 TEXT,                        -- organisation slug
  at                  TIMESTAMPTZ DEFAULT NOW(),   -- when the event occurred
  detail              JSONB DEFAULT '{}',          -- structured extra context (priority, dates, etc.)
  old_value           TEXT,                        -- primary "before" value (status, name, count …)
  new_value           TEXT,                        -- primary "after" value
  is_intervention     BOOLEAN DEFAULT FALSE,       -- true when super_admin acts on another org
  intervention_reason TEXT,
  is_checklist        BOOLEAN DEFAULT FALSE,
  checklist_action    TEXT,                        -- 'checked' or 'unchecked'
  checklist_item      TEXT
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_read_auth"   ON public.audit_log FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "audit_log_insert_auth" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (TRUE);

-- Index for fast org-filtered queries
CREATE INDEX IF NOT EXISTS audit_log_org_at ON public.audit_log (org, at DESC);

-- ── EXISTING INSTALLATION MIGRATION ──────────────────────────────────────────
-- If you already created audit_log manually, run these ALTER TABLE statements
-- in Supabase SQL Editor to add the new columns without losing existing rows:
--
--   ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'status_change';
--   ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS by_id UUID;
--   ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS detail JSONB DEFAULT '{}';
--   ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS old_value TEXT;
--   ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS new_value TEXT;
--   ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS is_intervention BOOLEAN DEFAULT FALSE;
--   ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS intervention_reason TEXT;
--   ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS is_checklist BOOLEAN DEFAULT FALSE;
--   ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS checklist_action TEXT;
--   ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS checklist_item TEXT;
--
-- Column name mapping from old camelCase to new snake_case:
--   taskId         → task_id
--   taskTitle      → task_title
--   byRole         → by_role
--   isIntervention → is_intervention
--   interventionReason → intervention_reason
--   isChecklist    → is_checklist
--   checklistAction → checklist_action
--   checklistItem  → checklist_item
--   fromStatus     → old_value
--   toStatus       → new_value
-- ─────────────────────────────────────────────────────────────────────────────

-- 3b-2. AUDIT LOGS (event-driven, persists after task/entity deletion)
-- NOTE: organisation_id and entity_id are TEXT (not UUID) because the app
-- uses text-based IDs for orgs ('ORG…') and tasks ('T…').
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT,
  user_id         UUID,
  user_name       TEXT,
  action          TEXT NOT NULL,          -- e.g. 'task.created', 'task.status_changed'
  entity_type     TEXT,                   -- 'task', 'leave', 'member', etc.
  entity_id       TEXT,                   -- task id ('T123'), leave id ('LV…'), etc.
  entity_name     TEXT,                   -- human-readable name at time of event
  details         TEXT,                   -- free-text or JSON description
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_read_auth"   ON public.audit_logs FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "audit_logs_insert_auth" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (TRUE);

CREATE INDEX IF NOT EXISTS audit_logs_org_at   ON public.audit_logs (organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_at  ON public.audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity   ON public.audit_logs (entity_id);

-- 3c. INVITE LINKS (tracks WhatsApp invite links sent from Teams section)
-- Created when an admin clicks "Send via WhatsApp"; marked used on registration.
CREATE TABLE IF NOT EXISTS public.invite_links (
  id          TEXT PRIMARY KEY,             -- 'IL' + timestamp + random (set by app)
  org_id      TEXT NOT NULL,                -- UUID id from organisations table
  org         TEXT NOT NULL,                -- org name (denormalised for display)
  team_id     TEXT NOT NULL,                -- team id from teams table
  role        TEXT NOT NULL DEFAULT 'worker',
  position    TEXT,                         -- optional position title
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  used_at     TIMESTAMPTZ,
  used_by     TEXT
);

ALTER TABLE public.invite_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invite_links_read_auth"   ON public.invite_links FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "invite_links_insert_auth" ON public.invite_links FOR INSERT TO authenticated WITH CHECK (TRUE);
CREATE POLICY "invite_links_update_auth" ON public.invite_links FOR UPDATE TO authenticated USING (TRUE);
-- Anonymous users need SELECT to resolve the link on the registration page
CREATE POLICY "invite_links_read_anon"   ON public.invite_links FOR SELECT TO anon USING (used_at IS NULL);

CREATE INDEX IF NOT EXISTS invite_links_org     ON public.invite_links (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invite_links_used    ON public.invite_links (used_at) WHERE used_at IS NULL;

-- 3d. USER POSITIONS (department-based roles per person)
-- One row per person/department combination. is_primary = true on exactly one row per user.
CREATE TABLE IF NOT EXISTS public.user_positions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org            TEXT NOT NULL,
  department     TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'worker'
                   CHECK (role IN ('manager','supervisor','worker')),
  position_title TEXT,               -- custom label e.g. "Registered Nurse", "Team Leader"
  is_primary     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_positions_read_auth"   ON public.user_positions FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "user_positions_insert_auth" ON public.user_positions FOR INSERT TO authenticated WITH CHECK (TRUE);
CREATE POLICY "user_positions_update_auth" ON public.user_positions FOR UPDATE TO authenticated USING (TRUE);
CREATE POLICY "user_positions_delete_auth" ON public.user_positions FOR DELETE TO authenticated USING (TRUE);

CREATE INDEX IF NOT EXISTS user_positions_user_org ON public.user_positions (user_id, org);
CREATE INDEX IF NOT EXISTS user_positions_org ON public.user_positions (org);

-- ── MIGRATION for existing installations ──────────────────────────────────────
-- Run this once in Supabase SQL Editor to create position rows for users
-- who already have a department set in their profile:
--
--   INSERT INTO public.user_positions (id, user_id, org, department, role, position_title, is_primary, created_at)
--   SELECT
--     'POS' || gen_random_uuid()::text,
--     p.id,
--     om.org,
--     p.department,
--     om.role,
--     '',
--     TRUE,
--     NOW()
--   FROM public.profiles p
--   JOIN public.org_members om ON om.user_id = p.id
--   WHERE p.department IS NOT NULL AND p.department <> ''
--     AND NOT EXISTS (
--       SELECT 1 FROM public.user_positions up
--       WHERE up.user_id = p.id AND up.org = om.org
--     );
-- ─────────────────────────────────────────────────────────────────────────────

-- 4. SEED DEMO DATA (optional – run after creating your admin account)
-- Replace 'YOUR-ADMIN-UUID' with your actual user ID from auth.users

/*
INSERT INTO public.tasks (title, category, assigned_role, status, priority, due_date, compliance, subtasks)
VALUES
  ('Clean Rooms 301–315', 'Housekeeping', 'worker', 'in_progress', 'high', CURRENT_DATE + 1, TRUE,
   '[{"t":"Strip linen","done":true},{"t":"Replace towels","done":true},{"t":"Clean bathroom","done":false},{"t":"Vacuum floors","done":false}]'),
  ('Daily Kitchen Compliance', 'Kitchen', 'worker', 'pending', 'critical', CURRENT_DATE + 1, TRUE,
   '[{"t":"Check fridge temp","done":false},{"t":"Check freezer","done":false},{"t":"Inspect storage","done":false}]'),
  ('Daily Safety Inspection', 'Safety', 'supervisor', 'completed', 'critical', CURRENT_DATE, TRUE,
   '[{"t":"Fire exits clear","done":true},{"t":"Extinguishers OK","done":true},{"t":"Emergency lighting","done":true}]'),
  ('Medication Audit', 'Clinical', 'worker', 'overdue', 'critical', CURRENT_DATE - 1, TRUE,
   '[{"t":"Verify med chart","done":true},{"t":"Confirm dosage","done":false},{"t":"Record admin","done":false}]');
*/
