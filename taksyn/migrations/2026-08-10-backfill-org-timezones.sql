-- =====================================================================
-- Taksyn migration: backfill organisations.timezone
-- 10 August 2026
--
-- WHY IT MATTERS
-- src/lib/orgTime.js falls back to UTC on a null or unrecognised zone,
-- SILENTLY and by design. That is right for display and wrong for
-- anything scheduled. Six of ten orgs on LIVE had no timezone, so every
-- date they see today is computed in UTC. For an Australian org that
-- means anything after 10am local rolls to the next calendar day.
--
-- STATE, NOT COUNTRY. Australia/Brisbane has NO daylight saving;
-- Australia/Sydney does. Setting a Sydney org to Brisbane is invisible
-- until October, when its dates start rolling a day early. This is the
-- kind of defect that surfaces months later as "the calendar is wrong
-- sometimes".
--
-- SOURCE OF VALUES: confirmed by Olaf, 10 Aug 2026.
--   JD Sanmed             Brisbane
--   We2care               Brisbane
--   Taksyn proto          Brisbane
--   BProduct              Sydney
--   Hayden's Wedding farm "mid USA, not sure where"
--
-- ** America/Chicago IS A GUESS. ** Olaf said mid-USA without a state.
-- Chicago (US Central) covers most of the country's middle, but
-- America/Denver (Mountain) is also plausible. If this org ever carries
-- real work, get the state and correct it. Recorded here rather than
-- buried so the guess cannot be mistaken for a fact later.
--
-- NOT TOUCHED:
--   Clinic, Kemrose, Test Org  — already set
--   Bright Care                — inactive, dead test org
--   My Organisation            — inactive super-admin shell
--
-- SANDBOX has different orgs entirely, so this migration is LIVE-only
-- and is a no-op there. That is expected, not a parity failure.
-- =====================================================================

\set ON_ERROR_STOP on

select 'PRE-ENV' as marker, count(*) as auth_users from auth.users;

-- Before-state, bracket-wrapped so a trailing space would be visible.
select 'PRE-TZ' as marker, name, status, coalesce('['||timezone||']','NULL') as tz
from organisations order by name;

begin;

-- Matched on id, not name. Names carry a typographic apostrophe
-- (Hayden’s, U+2019) which is easy to mangle on paste; ids are ASCII.
update organisations set timezone = 'Australia/Brisbane' where id = 'ORG1785845552598'; -- JD Sanmed
update organisations set timezone = 'Australia/Brisbane' where id = 'ORG1781916126966'; -- We2care
update organisations set timezone = 'Australia/Brisbane' where id = 'ORG1780556879854'; -- Taksyn proto
update organisations set timezone = 'Australia/Sydney'   where id = 'ORG1784859869993'; -- BProduct
update organisations set timezone = 'America/Chicago'    where id = 'ORG1781306059469'; -- Hayden's Wedding farm (GUESS)

commit;

-- ---------------------------------------------------------------------
-- VERIFY 1: after-state. Every ACTIVE org should now have a zone.
-- ---------------------------------------------------------------------
select 'POST-TZ' as marker, name, status, coalesce('['||timezone||']','NULL') as tz
from organisations order by status, name;

-- ---------------------------------------------------------------------
-- VERIFY 2: the count that matters. active_missing MUST be 0.
-- ---------------------------------------------------------------------
select 'POST-COUNT' as marker,
       count(*) filter (where status = 'active' and timezone is null) as active_missing,
       count(*) filter (where status = 'active' and timezone is not null) as active_set,
       count(*) filter (where status <> 'active') as inactive_ignored
from organisations;

-- ---------------------------------------------------------------------
-- VERIFY 3: every stored value must be a REAL zone. Postgres resolves
-- IANA names in pg_timezone_names, so an invalid string shows up here
-- as valid_iana = f. 'EAT' or 'Brisbane' would pass a null check and
-- fail this one — which is the whole point.
-- ---------------------------------------------------------------------
select 'POST-IANA' as marker,
       o.name,
       o.timezone,
       (o.timezone in (select name from pg_timezone_names)) as valid_iana
from organisations o
where o.timezone is not null
order by valid_iana, o.name;

-- ---------------------------------------------------------------------
-- VERIFY 4: what "today" actually is in each org right now. If two orgs
-- show different dates, that is correct and is exactly why this column
-- exists. Kampala and Auckland can legitimately differ by a full day.
-- ---------------------------------------------------------------------
select 'POST-TODAY' as marker,
       name,
       timezone,
       (now() at time zone timezone)::date as org_today,
       to_char(now() at time zone timezone, 'HH24:MI') as org_time
from organisations
where timezone is not null and status = 'active'
order by org_today, name;

-- ---------------------------------------------------------------------
-- ROLLBACK — restores the exact prior state (all five were NULL):
--   update organisations set timezone = null
--    where id in ('ORG1785845552598','ORG1781916126966','ORG1780556879854',
--                 'ORG1784859869993','ORG1781306059469');
-- ---------------------------------------------------------------------
