-- 2026-08-12-notify-stage2.sql
-- [SANDBOX buqlbmgxevuldahhdbxo] FIRST. Do not run on LIVE until proven here.
--
-- Stage 2: enqueue on insert. Requires Stage 1 (notification_queue +
-- resolve_notify_recipients).
--
-- WHY TRIGGERS, NOT AN EDIT TO create_incident:
--   create_incident is ~150 lines on the pilot's critical path, and its
--   Sandbox/LIVE parity has not been diffed verbatim. A trigger touches
--   none of it, fires for incidents created by ANY path (RPC, admin, future
--   import), and is reversible with one DROP TRIGGER.
--
-- CRITICAL - WHY EVERY BLOCK SWALLOWS EXCEPTIONS:
--   An exception raised in an AFTER INSERT trigger rolls back the INSERT.
--   A failed notification must NEVER prevent an incident or complaint from
--   being recorded. Every failure path here degrades to "no queue row" or
--   "queue row marked skipped", never to a lost report.
--
-- SEVERITY IN THE SUBJECT is deliberate. Decision was to notify client_admin
-- at ALL severities, so triage has to be possible from the inbox list without
-- opening anything. Retrofitting this after people build mail filters is hard.
--
-- ANONYMOUS COMPLAINTS: issue_reports.is_anonymous exists and is honoured.
-- The reporter is omitted entirely from the body when set. Leaking it in a
-- notification would defeat the flag's whole purpose.

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------- PRE
do $$
begin
  if to_regclass('public.notification_queue') is null then
    raise exception 'PRE-01 FAILED: notification_queue missing - run Stage 1 first';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='resolve_notify_recipients'
  ) then
    raise exception 'PRE-02 FAILED: resolve_notify_recipients missing - run Stage 1 first';
  end if;
  raise notice 'PRE-OK: Stage 1 objects present';
end $$;

-- ------------------------------------------------------- INCIDENT ENQUEUE
create or replace function public.enqueue_incident_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_roles   text[];
  v_emails  text[];
  v_subject text;
  v_body    text;
  v_status  text := 'pending';
  v_note    text;
begin
  begin
    -- notify_roles for this org+severity. No config row is a real
    -- possibility, so fall back to client_admin rather than notifying
    -- nobody: the decision was that client_admin hears about everything.
    select notify_roles into v_roles
      from incident_config
     where org = NEW.org and severity = NEW.severity
     limit 1;
    if v_roles is null or array_length(v_roles,1) is null then
      v_roles := array['client_admin'];
      v_note  := 'no incident_config row; defaulted to client_admin';
    end if;

    -- incidents.org holds the org ID, hence 'id'.
    select array_agg(distinct email) into v_emails
      from resolve_notify_recipients(NEW.org, 'id', v_roles);

    if v_emails is null or array_length(v_emails,1) is null then
      v_status := 'skipped';
      v_note   := coalesce(v_note || '; ', '') || 'no recipients resolved';
      v_emails := '{}';
    end if;

    v_subject := '[Taksyn] SEV ' || NEW.severity || ' · ' ||
                 coalesce(NEW.ref,'incident') || ' · ' ||
                 coalesce(NEW.category,'uncategorised');

    v_body := 'A new incident has been reported.' || chr(10) || chr(10) ||
      'Reference: ' || coalesce(NEW.ref,'-')       || chr(10) ||
      'Severity:  ' || NEW.severity                || chr(10) ||
      'Category:  ' || coalesce(NEW.category,'-')  || chr(10) ||
      'Occurred:  ' || coalesce(NEW.occurred_at::text,'-') || chr(10) ||
      'Reported by: ' || coalesce(NEW.reported_by_name,'-') || chr(10) ||
      chr(10) ||
      'Assign by:      ' || coalesce(NEW.assign_due_at::text,'-')      || chr(10) ||
      'Investigate by: ' || coalesce(NEW.investigate_due_at::text,'-') || chr(10) ||
      'Close by:       ' || coalesce(NEW.close_due_at::text,'-')       || chr(10) ||
      chr(10) ||
      'Open Taksyn to view the full report. Incident details are not ' ||
      'included in this email.';
    -- Deliberate: no facts, no affected person, no narrative. Email is not
    -- a secure channel and the incident body is need-to-know inside the app.

    insert into notification_queue (
      org, org_id, kind, source_id, source_ref, severity,
      subject, body, recipients, status, last_error
    ) values (
      NEW.org, NEW.org, 'incident', NEW.id::text, NEW.ref, NEW.severity,
      v_subject, v_body, v_emails, v_status, v_note
    )
    on conflict (kind, source_id) do nothing;

  exception when others then
    -- Never block the incident. Swallow and move on.
    raise warning 'enqueue_incident_notification failed for incident %: %',
                  NEW.id, sqlerrm;
  end;

  return NEW;
end;
$function$;

drop trigger if exists trg_enqueue_incident_notification on public.incidents;
create trigger trg_enqueue_incident_notification
  after insert on public.incidents
  for each row execute function public.enqueue_incident_notification();

-- ------------------------------------------------------ COMPLAINT ENQUEUE
create or replace function public.enqueue_complaint_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_emails  text[];
  v_subject text;
  v_body    text;
  v_status  text := 'pending';
  v_note    text;
begin
  begin
    -- Decision: complaints only. Requests and feedback are not
    -- time-critical, and mixing them trains people to ignore the mail.
    if coalesce(NEW.type,'request') <> 'complaint' then
      return NEW;
    end if;

    -- issue_reports.org holds the org NAME, not the ID. Hence 'name'.
    -- This is the gremlin the org_kind parameter exists for.
    select array_agg(distinct email) into v_emails
      from resolve_notify_recipients(NEW.org, 'name', array['client_admin']);

    if v_emails is null or array_length(v_emails,1) is null then
      v_status := 'skipped';
      v_note   := 'no recipients resolved';
      v_emails := '{}';
    end if;

    v_subject := '[Taksyn] Complaint · ' || coalesce(NEW.title,'untitled');

    v_body := 'A complaint has been logged.' || chr(10) || chr(10) ||
      'Title:    ' || coalesce(NEW.title,'-')    || chr(10) ||
      'Priority: ' || coalesce(NEW.priority,'-') || chr(10) ||
      case when coalesce(NEW.is_anonymous,false)
           then 'Reported anonymously.'
           else 'Reported by: see Taksyn.' end || chr(10) ||
      -- is_anonymous is honoured absolutely: the reporter is not named,
      -- and no reporter id is included for a non-anonymous report either,
      -- since email is not a secure channel.
      chr(10) ||
      'Open Taksyn to view and respond.';

    insert into notification_queue (
      org, org_id, kind, source_id, source_ref, severity,
      subject, body, recipients, status, last_error
    ) values (
      NEW.org,
      (select g.id from organisations g where g.name = NEW.org limit 1),
      'complaint', NEW.id::text, null, null,
      v_subject, v_body, v_emails, v_status, v_note
    )
    on conflict (kind, source_id) do nothing;

  exception when others then
    raise warning 'enqueue_complaint_notification failed for report %: %',
                  NEW.id, sqlerrm;
  end;

  return NEW;
end;
$function$;

drop trigger if exists trg_enqueue_complaint_notification on public.issue_reports;
create trigger trg_enqueue_complaint_notification
  after insert on public.issue_reports
  for each row execute function public.enqueue_complaint_notification();

-- ---------------------------------------------------------------- POST
do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgname='trg_enqueue_incident_notification'
                    and tgrelid='public.incidents'::regclass) then
    raise exception 'POST-01 FAILED: incident trigger missing';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname='trg_enqueue_complaint_notification'
                    and tgrelid='public.issue_reports'::regclass) then
    raise exception 'POST-02 FAILED: complaint trigger missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public'
                    and p.proname='enqueue_incident_notification'
                    and p.prosecdef is true) then
    raise exception 'POST-03 FAILED: incident enqueue not SECURITY DEFINER';
  end if;
  raise notice 'POST-OK: both triggers installed';
end $$;

commit;

-- ------------------------------------------------------------- VERIFY
select 'CHK-NOT-09' as marker, kind, status, count(*)
from public.notification_queue group by kind, status order by kind, status;
