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
