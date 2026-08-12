-- Constrain incident_events.event_type to the known vocabulary.
--
-- WHY: event_type was free text. A typo silently created a new category that
-- no reader would ever match, on the one table that is the audit spine.
--
-- The nineteen values are the sixteen observed in SANDBOX on 12 Aug 2026
-- (CHK-ED7 + CHK-ED8) plus three planned for the edit-with-audit work.
-- LIVE holds only ten of the sixteen; sandbox is the superset because it has
-- exercised close, reopen, no-action and notification paths LIVE has not.
--
-- data_remediation is a maintenance artefact from 4 Aug, deliberately INCLUDED:
-- a constraint should reflect what an append-only table actually holds, rather
-- than retro-cleaning audit rows to fit a constraint.
--
-- Proven in SANDBOX 12 Aug 2026: applied clean over 130+ rows; negative control
-- rejected 'totally_made_up' with 23514 naming this constraint.

alter table public.incident_events
  add constraint incident_events_event_type_check
  check (event_type in (
    'reported','assigned','severity_set','investigation_started',
    'status_changed','status_reverted','closed','reopened',
    'risk_rated','residual_risk_rated','root_cause_recorded',
    'action_created','corrective_action_completed','no_action_decided',
    'notified','data_remediation',
    'narrative_edited','action_edited','ratings_edited'
  ));
