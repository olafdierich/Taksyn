-- Seed Kemrose Hospitality positions into both:
--   org_custom_roles    → shows in Settings → Positions per Industry tab
--   org_custom_positions → used as org override in invite/edit dropdowns
-- Run via Supabase Dashboard > SQL Editor

DO $$
DECLARE
  kemrose_id uuid;
  worker_titles  text[] := ARRAY['Housekeeping','Kitchen Aid','Waiter','Bar Tender','Chef','Reception','Plumber','Electrician','Driver','Finance','Laundry Staff'];
  super_titles   text[] := ARRAY['Housekeeping Supervisor','F&B Supervisor','Front Desk Supervisor','Kitchen Supervisor'];
  mgr_titles     text[] := ARRAY['Operations Manager','F&B Manager','Housekeeping Manager','Front Office Manager','General Manager'];
  all_titles     text[];
  pos            text;
  i              int;
BEGIN
  SELECT id INTO kemrose_id FROM organisations WHERE name ILIKE '%kemrose%' LIMIT 1;

  IF kemrose_id IS NULL THEN
    RAISE NOTICE 'Kemrose organisation not found — check the name in the organisations table';
    RETURN;
  END IF;

  -- ── org_custom_roles (Positions per Industry tab) ──────────────────────
  i := 1;
  FOREACH pos IN ARRAY (worker_titles || super_titles || mgr_titles) LOOP
    INSERT INTO org_custom_roles (role_name, organisation_id, industry_name, sort_order)
    VALUES (pos, kemrose_id, 'Hospitality', i)
    ON CONFLICT DO NOTHING;
    i := i + 1;
  END LOOP;

  -- ── org_custom_positions (invite / edit dropdown override) ──────────────
  all_titles := worker_titles || super_titles || mgr_titles;
  i := 1;
  FOREACH pos IN ARRAY all_titles LOOP
    INSERT INTO org_custom_positions (position_name, organisation_id, sort_order)
    VALUES (pos, kemrose_id, i)
    ON CONFLICT DO NOTHING;
    i := i + 1;
  END LOOP;

  RAISE NOTICE 'Seeded % job titles for Kemrose (org id: %)', array_length(all_titles, 1), kemrose_id;
END $$;
