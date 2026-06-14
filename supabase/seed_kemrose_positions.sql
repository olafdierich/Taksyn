-- Seed Hospitality positions into org_custom_positions for Kemrose
-- Run via Supabase Dashboard > SQL Editor
-- This seeds all Hospitality role levels (worker / supervisor / manager)

DO $$
DECLARE
  kemrose_id uuid;
  pos_names text[] := ARRAY[
    'Cleaner','Kitchen Aid','Waiter','Bar Tender','Chef','Reception',
    'Plumber','Electrician','Driver','Finance','Housekeeper','Room Attendant',
    'Laundry Staff','Barista',
    'Housekeeping Supervisor','F&B Supervisor','Front Desk Supervisor','Kitchen Supervisor',
    'Operations Manager','F&B Manager','Housekeeping Manager','Front Office Manager','General Manager'
  ];
  pos text;
  i int := 1;
BEGIN
  SELECT id INTO kemrose_id FROM organisations WHERE name ILIKE '%kemrose%' LIMIT 1;

  IF kemrose_id IS NULL THEN
    RAISE NOTICE 'Kemrose organisation not found — check the name';
    RETURN;
  END IF;

  FOREACH pos IN ARRAY pos_names LOOP
    INSERT INTO org_custom_positions (position_name, organisation_id, sort_order)
    VALUES (pos, kemrose_id, i)
    ON CONFLICT DO NOTHING;
    i := i + 1;
  END LOOP;

  RAISE NOTICE 'Seeded % positions for org %', array_length(pos_names,1), kemrose_id;
END $$;
