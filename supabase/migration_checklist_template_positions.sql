-- Migration: add proper positions TEXT[] column to checklist_templates
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- Run this BEFORE deploying the App.jsx update.

-- 1. Add columns (idempotent)
ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS industry  TEXT,
  ADD COLUMN IF NOT EXISTS positions TEXT[];

-- 2. Migrate existing data: convert the old JSON-string `position` column into the new native array
UPDATE public.checklist_templates
SET positions = CASE
  WHEN position IS NULL OR position = ''  THEN NULL
  WHEN position LIKE '[%'                 THEN ARRAY(SELECT json_array_elements_text(position::json))
  ELSE ARRAY[position]
END
WHERE positions IS NULL AND position IS NOT NULL AND position <> '';

-- 3. Update the 7 Kemrose cleaning templates with the correct per-template positions
DO $$
DECLARE
  kemrose_id TEXT;
BEGIN
  SELECT id INTO kemrose_id FROM organisations WHERE name ILIKE '%kemrose%' LIMIT 1;
  IF kemrose_id IS NULL THEN
    RAISE NOTICE 'Kemrose organisation not found — check the name in the organisations table';
    RETURN;
  END IF;

  UPDATE checklist_templates
    SET industry = 'Hospitality', positions = ARRAY['Housekeeper', 'Room Attendant']
    WHERE organisation_id = kemrose_id AND name ILIKE '%bathroom%';

  UPDATE checklist_templates
    SET industry = 'Hospitality', positions = ARRAY['Housekeeper', 'Room Attendant']
    WHERE organisation_id = kemrose_id AND name ILIKE '%hotel room%';

  UPDATE checklist_templates
    SET industry = 'Hospitality', positions = ARRAY['Bar Tender']
    WHERE organisation_id = kemrose_id AND name ILIKE '%cleaning bar%';

  UPDATE checklist_templates
    SET industry = 'Hospitality', positions = ARRAY['Chef', 'Kitchen Aid']
    WHERE organisation_id = kemrose_id AND name ILIKE '%kitchen%';

  UPDATE checklist_templates
    SET industry = 'Hospitality', positions = ARRAY['Waiter']
    WHERE organisation_id = kemrose_id AND name ILIKE '%restaurant%';

  UPDATE checklist_templates
    SET industry = 'Hospitality', positions = ARRAY['Cleaner', 'Maintenance Officer']
    WHERE organisation_id = kemrose_id AND name ILIKE '%rooftop%';

  UPDATE checklist_templates
    SET industry = 'Hospitality', positions = ARRAY['Cleaner', 'Maintenance Officer']
    WHERE organisation_id = kemrose_id AND name ILIKE '%patio%';

  RAISE NOTICE 'Kemrose templates updated (org id: %)', kemrose_id;
END $$;
