-- Migration: remove duplicate / incorrectly-capitalised Hospitality positions
-- Fixes: 'Bar tender' → remove (correct 'Bar Tender' already exists)
--        'Kitchen aid' → remove (correct 'Kitchen Aid' already exists)
--        'Cleaner'     → remove (consolidated into 'Housekeeping')
-- Run in: Supabase Dashboard → SQL Editor → New Query

DO $$
DECLARE
  kemrose_id TEXT;
BEGIN
  SELECT id INTO kemrose_id FROM organisations WHERE name ILIKE '%kemrose%' LIMIT 1;
  IF kemrose_id IS NULL THEN
    RAISE NOTICE 'Kemrose organisation not found';
    RETURN;
  END IF;

  -- org_custom_roles
  DELETE FROM org_custom_roles
    WHERE organisation_id = kemrose_id
      AND role_name IN ('Bar tender', 'Kitchen aid', 'Cleaner');

  -- org_custom_positions
  DELETE FROM org_custom_positions
    WHERE organisation_id = kemrose_id
      AND position_name IN ('Bar tender', 'Kitchen aid', 'Cleaner');

  -- Fix any org_members whose position was set to a lowercase variant
  UPDATE org_members SET position = 'Bar Tender'  WHERE org = kemrose_id AND position = 'Bar tender';
  UPDATE org_members SET position = 'Kitchen Aid' WHERE org = kemrose_id AND position = 'Kitchen aid';
  UPDATE org_members SET position = 'Housekeeping' WHERE org = kemrose_id AND position = 'Cleaner';

  RAISE NOTICE 'Duplicate Hospitality positions cleaned for Kemrose (org id: %)', kemrose_id;
END $$;
