-- Incident evidence: stage marker + privacy columns.
-- stage distinguishes report-time from investigation-time attachment.
-- privacy_* are written by the planned on-device detection layer; null until then.

alter table public.incident_evidence
  add column if not exists stage text not null default 'report',
  add column if not exists privacy_flagged boolean not null default false,
  add column if not exists privacy_note text;

alter table public.incident_evidence
  drop constraint if exists incident_evidence_stage_check;

alter table public.incident_evidence
  add constraint incident_evidence_stage_check
  check (stage in ('report','investigation'));

create index if not exists incident_evidence_incident_stage_idx
  on public.incident_evidence (incident_id, stage);
