-- Add the Organisation Settings columns the CompanySettingsView save() writes.
-- These were missing from the organisations table, causing a 400 (PGRST204
-- "Could not find the '<column>' column of 'organisations'") when saving.
-- All columns are optional (nullable, no default required).
--
-- Run once in the Supabase SQL Editor (DDL requires the Postgres/service role —
-- it cannot be executed from the client app with the anon key).

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS address_street TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS address_city TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS address_state TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS address_postcode TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS address_country TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS contact2_name TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS contact2_email TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS contact2_phone TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS org_settings TEXT;
