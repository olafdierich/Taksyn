-- Migration: consolidate Hospitality position names
--   Cleaner + Housekeeper + Room Attendant → Housekeeping
--   Barista → Bar Tender (merged into existing)
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

  -- ── checklist_templates.positions ─────────────────────────────────────────
  -- Bathroom & Hotel Room: [Housekeeper, Room Attendant] → [Housekeeping]
  UPDATE checklist_templates
    SET positions = ARRAY['Housekeeping']
    WHERE organisation_id = kemrose_id AND name ILIKE '%bathroom%';

  UPDATE checklist_templates
    SET positions = ARRAY['Housekeeping']
    WHERE organisation_id = kemrose_id AND name ILIKE '%hotel room%';

  -- Rooftop & Patio: [Cleaner, Maintenance Officer] → [Housekeeping, Maintenance Officer]
  UPDATE checklist_templates
    SET positions = ARRAY['Housekeeping', 'Maintenance Officer']
    WHERE organisation_id = kemrose_id AND (name ILIKE '%rooftop%' OR name ILIKE '%patio%');

  -- ── org_custom_roles: remove old, insert consolidated ─────────────────────
  DELETE FROM org_custom_roles
    WHERE organisation_id = kemrose_id
      AND role_name IN ('Cleaner', 'Housekeeper', 'Room Attendant', 'Barista');

  INSERT INTO org_custom_roles (role_name, organisation_id, industry_name, sort_order)
  VALUES ('Housekeeping', kemrose_id, 'Hospitality', 1)
  ON CONFLICT DO NOTHING;

  -- ── org_custom_positions: remove old, insert consolidated ─────────────────
  DELETE FROM org_custom_positions
    WHERE organisation_id = kemrose_id
      AND position_name IN ('Cleaner', 'Housekeeper', 'Room Attendant', 'Barista');

  INSERT INTO org_custom_positions (position_name, organisation_id, sort_order)
  VALUES ('Housekeeping', kemrose_id, 1)
  ON CONFLICT DO NOTHING;

  -- ── org_members: remap any existing members' position field ───────────────
  UPDATE org_members
    SET position = 'Housekeeping'
    WHERE org = kemrose_id
      AND position IN ('Cleaner', 'Housekeeper', 'Room Attendant');

  UPDATE org_members
    SET position = 'Bar Tender'
    WHERE org = kemrose_id
      AND position = 'Barista';

  -- ── invite_links: remap pending (unused) invites ──────────────────────────
  UPDATE invite_links
    SET invited_position = 'Housekeeping'
    WHERE organisation_id = kemrose_id
      AND used_at IS NULL
      AND invited_position IN ('Cleaner', 'Housekeeper', 'Room Attendant');

  UPDATE invite_links
    SET invited_position = 'Bar Tender'
    WHERE organisation_id = kemrose_id
      AND used_at IS NULL
      AND invited_position = 'Barista';

  RAISE NOTICE 'Hospitality positions consolidated for Kemrose (org id: %)', kemrose_id;
END $$;
