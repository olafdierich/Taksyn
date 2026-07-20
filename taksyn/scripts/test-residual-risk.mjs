// SANDBOX WRITE TEST — residual risk data contract.
// Proves the residual_* columns accept a write, round-trip correctly, and that a
// residual_risk_rated audit event lands in incident_events with the right shape.
// Cleans up the residual_* fields afterwards (nulls them back). The audit event
// is intentionally immutable (no delete policy) — it uses a clearly test-labelled
// detail so it's identifiable. Reads the org ID from the target incident itself.
//
// Requires env: SANDBOX_URL, SANDBOX_KEY (service_role). Writes to SANDBOX only.

import { createClient } from '@supabase/supabase-js';
const URL = process.env.SANDBOX_URL, KEY = process.env.SANDBOX_KEY;
if (!URL || !KEY) { console.error('Missing SANDBOX_URL / SANDBOX_KEY'); process.exit(1); }
const db = createClient(URL, KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  PASS:', m); };
const bad = (m) => { fail++; console.log('  FAIL:', m); };

// 1. Find an incident that already has an initial rating (so residual is meaningful).
const { data: rows, error: findErr } = await db.from('incidents')
  .select('id, ref, org, risk_likelihood, risk_consequence, risk_rating, residual_likelihood, residual_consequence, residual_rating')
  .not('risk_rating', 'is', null).limit(1);
if (findErr) { console.error('FIND ERROR:', findErr.message); process.exit(1); }
if (!rows || !rows.length) { console.error('No initially-rated incident in sandbox to test against.'); process.exit(1); }
const inc = rows[0];
console.log(`Target: ${inc.ref} (id ${inc.id}), org ${inc.org}, initial rating ${inc.risk_rating}`);

// Remember original residual values so we can restore them.
const orig = {
  residual_likelihood: inc.residual_likelihood ?? null,
  residual_consequence: inc.residual_consequence ?? null,
  residual_rating: inc.residual_rating ?? null,
};

const RES_L = 2, RES_C = 2, RES_RATING = 4; // mirrors the UI: rating = l*c

// 2. Write residual values (same shape as patchIncident's .update).
const now = new Date().toISOString();
const { error: upErr } = await db.from('incidents')
  .update({ residual_likelihood: RES_L, residual_consequence: RES_C, residual_rating: RES_RATING, updated_at: now })
  .eq('id', inc.id);
if (upErr) bad('write residual_* → ' + upErr.message); else ok('wrote residual_* to incident');

// 3. Read back and assert round-trip.
const { data: back } = await db.from('incidents')
  .select('residual_likelihood, residual_consequence, residual_rating').eq('id', inc.id).single();
if (back && back.residual_likelihood === RES_L && back.residual_consequence === RES_C && back.residual_rating === RES_RATING)
  ok(`round-trip OK (L=${back.residual_likelihood}, C=${back.residual_consequence}, rating=${back.residual_rating})`);
else bad('round-trip mismatch → ' + JSON.stringify(back));

// 4. Insert the audit event in the exact shape patchIncident uses.
const { error: evErr } = await db.from('incident_events').insert({
  incident_id: inc.id, org: inc.org, event_type: 'residual_risk_rated',
  by_id: null, by_name: 'RESIDUAL-TEST', by_role: 'client_admin',
  from_value: null, to_value: String(RES_RATING),
  details: { likelihood: RES_L, consequence: RES_C, _test: true },
});
if (evErr) bad('insert audit event → ' + evErr.message); else ok('inserted residual_risk_rated audit event');

// 5. Read the event back and assert shape.
const { data: evs } = await db.from('incident_events').select('*')
  .eq('incident_id', inc.id).eq('event_type', 'residual_risk_rated').order('at', { ascending: false }).limit(1);
const ev = evs && evs[0];
if (ev && ev.to_value === String(RES_RATING) && ev.details && ev.details.likelihood === RES_L && ev.details.consequence === RES_C)
  ok(`audit event shape OK (to_value=${ev.to_value}, details L/C=${ev.details.likelihood}/${ev.details.consequence})`);
else bad('audit event shape mismatch → ' + JSON.stringify(ev));

// 6. Confirm the audit spine is immutable — a delete of our test event should be blocked.
if (ev) {
  const { error: delErr } = await db.from('incident_events').delete().eq('id', ev.id);
  if (delErr) ok('audit event delete BLOCKED (immutable spine confirmed) → ' + delErr.message);
  else bad('audit event was DELETABLE — immutability NOT enforced (unexpected)');
}

// 7. Cleanup: restore the incident's residual_* fields to their original values.
const { error: revErr } = await db.from('incidents').update(orig).eq('id', inc.id);
if (revErr) console.log('  WARN: could not revert residual_* →', revErr.message);
else console.log(`  cleanup: residual_* restored to original (${JSON.stringify(orig)})`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed.`);
console.log('Note: the residual_risk_rated audit event is intentionally left behind (immutable, _test:true in details). Harmless test artifact on INC-2026-0001 in SANDBOX only.');
process.exit(fail ? 1 : 0);
