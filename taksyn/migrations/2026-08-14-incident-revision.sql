-- ===========================================================================
-- Taksyn migration — revision counter on incidents
-- 14 August 2026
--
-- WHY
-- A closed incident can still be amended: narrative corrections, action
-- edits and rating changes are all explicitly permitted, and each is audited.
-- But once a PDF has been exported and handed to someone, that copy silently
-- stops matching the record. Nothing on the page tells the holder their copy
-- is superseded.
--
-- A revision number fixes that. The export prints "Revision 3", so a holder
-- of Revision 1 knows to ask for a current copy. Cheap to add now, awkward
-- once exports are in regular circulation.
--
-- THE RULING (Olaf, 14 Aug 2026)
--   * EVERY audited event increments it -- not only changes made after an
--     export. "This record has been amended N times" is meaningful whether or
--     not anyone exported it, and it means no new event type has to remember
--     to bump the counter.
--   * The counter is maintained by a TRIGGER on incident_events, not by the
--     application. Anything that writes an event is counted, including the
--     RPCs and the triggers written earlier today.
--   * It starts at 1. The FIRST event establishes revision 1 rather than
--     advancing it -- a freshly lodged incident is revision 1, not 2.
--   * Existing incidents are BACKFILLED from their event count. The number
--     should describe the record, not the day the feature was added. One
--     LIVE incident jumps to revision 20 as a result, which is accurate.
-- ===========================================================================

alter table public.incidents
  add column if not exists revision integer not null default 1;

comment on column public.incidents.revision is
  'Amendment count, maintained by incident_events_bump_revision. Printed on '
  'the PDF export so a superseded copy is identifiable. Olaf ruling, 14 Aug 2026.';

-- ---------------------------------------------------------------------------
-- Backfill. greatest(count,1) so an incident with no events -- which should
-- not exist, but might -- still reads 1 rather than 0.
-- ---------------------------------------------------------------------------
update public.incidents i
   set revision = greatest(
         (select count(*) from public.incident_events e where e.incident_id = i.id),
         1);

-- ---------------------------------------------------------------------------
-- Maintain it. AFTER INSERT on the event log, which is the one place every
-- audited change lands.
--
-- Deliberately NOT an update of updated_at: this is a derived count, not an
-- edit in its own right, and touching updated_at would make the record look
-- amended by the act of counting the amendment.
-- ---------------------------------------------------------------------------
create or replace function public.incident_events_bump_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The lodgement event establishes revision 1; it does not advance it.
  if new.event_type = 'reported' then
    return new;
  end if;

  update public.incidents
     set revision = coalesce(revision, 1) + 1
   where id = new.incident_id;

  return new;
end;
$$;

drop trigger if exists incident_events_bump_revision_trg on public.incident_events;
create trigger incident_events_bump_revision_trg
  after insert on public.incident_events
  for each row
  execute function public.incident_events_bump_revision();

comment on function public.incident_events_bump_revision() is
  'Increments incidents.revision on every audited event except the lodgement. '
  'Olaf ruling, 14 Aug 2026.';
