// =====================================================================
// Taksyn Incident Escalation Engine — headless sandbox test harness
// Branch: incident-report-form
//
// PROVES, against the real SANDBOX schema:
//   1. An incident whose assign_due_at is already in the past gets ONE
//      escalation_raised event + one user_notifications row per recipient.
//   2. Running the engine AGAIN adds NOTHING (idempotency — the core
//      safety property, since cron runs every 5 min).
//   3. The escalation event lands in the immutable spine with by_role=system.
//   4. Recipient fan-out matches incident_config.notify_roles resolved
//      through org_members.
//
// Then it CLEANS UP everything it created.
//
// REQUIRES env vars (set one line at a time, never echoed):
//   SANDBOX_URL   = https://hbsexcighvjeryumodsn.supabase.co
//   SANDBOX_KEY   = <sandbox service_role key>
//
// RUN (from taksyn/, after `npm i @supabase/supabase-js` already present):
//   SANDBOX_URL=... SANDBOX_KEY=... node scripts/escalation-test.mjs
//
// This harness ONLY touches rows it creates (a throwaway incident in the
// sandbox org) plus reads config. It does not modify existing incidents.
// =====================================================================

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SANDBOX_URL;
const KEY = process.env.SANDBOX_KEY;
if (!URL || !KEY) { console.error('Missing SANDBOX_URL / SANDBOX_KEY'); process.exit(1); }

const db = createClient(URL, KEY, { auth: { persistSession: false } });

const ORG = 'ORG_SANDBOX';           // sandbox org identifier (matches incidents.org convention)
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  \u2713', m); };
const bad = (m) => { fail++; console.log('  \u2717', m); };

// track what we create so we can clean up even on failure
const created = { incidentId: null };

async function cleanup() {
  if (created.incidentId != null) {
    await db.from('incident_events').delete().eq('incident_id', created.incidentId);
    // notifications created by the engine carry our incident ref in the message;
    // safest is to delete by the exact created_at/title we used — but since the
    // engine stamps them, we remove any 'Incident escalation' rows that mention
    // our incident id/ref. We captured the ref; delete by message match.
    if (created.ref) {
      await db.from('user_notifications')
        .delete()
        .eq('title', 'Incident escalation')
        .like('message', `%${created.ref}%`);
    }
    await db.from('incidents').delete().eq('id', created.incidentId);
  }
}

async function main() {
  console.log('\n=== Taksyn escalation engine — sandbox proof ===\n');

  // --- Preconditions: config must exist for the severity we test ---
  const SEV = 3;
  const { data: cfg, error: cfgErr } = await db
    .from('incident_config')
    .select('severity, notify_roles, notify_emails, assign_within_hours')
    .eq('org', ORG).eq('severity', SEV).maybeSingle();
  if (cfgErr) { bad('read incident_config: ' + cfgErr.message); return; }
  if (!cfg)   { bad(`no incident_config for ${ORG} severity ${SEV} — seed it first`); return; }
  ok(`config present for severity ${SEV}, notify_roles=${JSON.stringify(cfg.notify_roles)}`);

  // Expected recipients: org_members whose role is in notify_roles
  const { data: mem, error: memErr } = await db
    .from('org_members').select('user_id, role').eq('org', ORG);
  if (memErr) { bad('read org_members: ' + memErr.message); return; }
  const expectedRecipients = new Set(
    (mem || []).filter(m => (cfg.notify_roles || []).includes(m.role) && m.user_id)
               .map(m => m.user_id)
  );
  ok(`expected recipient count from roles = ${expectedRecipients.size}`);

  // --- Create a throwaway incident already overdue at the ASSIGN stage ---
  const pastDue = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
  const ref = 'TEST-ESC-' + Date.now();
  created.ref = ref;
  const { data: ins, error: insErr } = await db.from('incidents').insert({
    ref,
    org: ORG,
    category: 'near_miss',
    severity: SEV,
    occurred_at: new Date().toISOString(),
    facts: 'harness: overdue-at-assign incident for escalation test',
    reported_by: [...expectedRecipients][0] || null,
    status: 'open',
    assign_due_at: pastDue,        // already passed -> should escalate
    assigned_at: null,             // not yet assigned -> assign stage unmet
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select('id, ref').single();
  if (insErr) { bad('insert test incident: ' + insErr.message); return; }
  created.incidentId = ins.id;
  ok(`created test incident id=${ins.id} ref=${ins.ref}, assign_due 1h in the past`);

  // --- RUN 1 ---
  const { data: run1, error: r1Err } = await db.rpc('run_incident_escalations');
  if (r1Err) { bad('run_incident_escalations() call 1: ' + r1Err.message); return; }
  ok('engine ran once: ' + JSON.stringify(run1));

  // Assert exactly one escalation_raised event for our incident, at assign stage
  const { data: ev1 } = await db.from('incident_events')
    .select('event_type, by_role, from_value, to_value, details')
    .eq('incident_id', created.incidentId)
    .eq('event_type', 'escalation_raised');
  if ((ev1 || []).length === 1) ok('exactly ONE escalation_raised event appended');
  else bad(`expected 1 escalation event, got ${(ev1||[]).length}`);

  if (ev1 && ev1[0]) {
    ev1[0].by_role === 'system' ? ok("event actor by_role='system'") : bad('actor not system: ' + ev1[0].by_role);
    ev1[0].details?.stage === 'assign' ? ok("event details.stage='assign'") : bad('stage wrong: ' + JSON.stringify(ev1[0].details));
  }

  // Assert notification fan-out == expected recipients
  const { data: n1 } = await db.from('user_notifications')
    .select('user_id, title, message')
    .eq('title', 'Incident escalation')
    .like('message', `%${ref}%`);
  if ((n1 || []).length === expectedRecipients.size)
    ok(`notification fan-out = ${n1.length} == expected recipients`);
  else
    bad(`fan-out ${ (n1||[]).length } != expected ${expectedRecipients.size}`);
  const gotRecips = new Set((n1||[]).map(r => r.user_id));
  const match = gotRecips.size === expectedRecipients.size &&
                [...gotRecips].every(u => expectedRecipients.has(u));
  match ? ok('notified user_ids exactly match role-resolved recipients')
        : bad('notified user set does not match expected');

  // --- RUN 2 (idempotency: the whole point) ---
  const { data: run2, error: r2Err } = await db.rpc('run_incident_escalations');
  if (r2Err) { bad('run_incident_escalations() call 2: ' + r2Err.message); return; }
  ok('engine ran a second time: ' + JSON.stringify(run2));

  const { data: ev2 } = await db.from('incident_events')
    .select('id').eq('incident_id', created.incidentId).eq('event_type','escalation_raised');
  (ev2||[]).length === 1 ? ok('STILL exactly one escalation event (idempotent)')
                         : bad(`idempotency broken: ${(ev2||[]).length} events after 2nd run`);

  const { data: n2 } = await db.from('user_notifications')
    .select('id').eq('title','Incident escalation').like('message', `%${ref}%`);
  (n2||[]).length === expectedRecipients.size
    ? ok('STILL one notification per recipient (no duplicate fan-out)')
    : bad(`notifications grew to ${(n2||[]).length} after 2nd run`);
}

main()
  .catch(e => { fail++; console.error('HARNESS ERROR:', e.message); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
    console.log(fail === 0 ? 'GREEN — safe to proceed to App.jsx / go-live pass.' : 'RED — do not proceed.');
    process.exit(fail === 0 ? 0 : 1);
  });
