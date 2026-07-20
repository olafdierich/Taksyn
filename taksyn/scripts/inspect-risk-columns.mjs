// READ-ONLY: inspect existing risk columns on sandbox incidents table. Writes NOTHING.
import { createClient } from '@supabase/supabase-js';
const URL = process.env.SANDBOX_URL, KEY = process.env.SANDBOX_KEY;
if (!URL || !KEY) { console.error('Missing SANDBOX_URL / SANDBOX_KEY'); process.exit(1); }
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const { data, error } = await db.from('incidents')
  .select('id, ref, risk_likelihood, risk_consequence, risk_rating')
  .limit(5);
if (error) { console.error('READ ERROR:', error.message); process.exit(1); }

console.log('Sample incident rows (risk columns):');
for (const r of (data||[])) {
  console.log(`  ${r.ref||r.id}: L=${r.risk_likelihood} (${typeof r.risk_likelihood}), C=${r.risk_consequence} (${typeof r.risk_consequence}), rating=${r.risk_rating} (${typeof r.risk_rating})`);
}
if (!(data||[]).length) console.log('  (no incident rows in sandbox)');

const { error: resErr } = await db.from('incidents')
  .select('residual_likelihood, residual_consequence, residual_rating').limit(1);
if (resErr && /column/i.test(resErr.message)) {
  console.log('\nresidual_* columns: NOT present yet (expected — we will add them).');
} else if (resErr) {
  console.log('\nresidual_* check error:', resErr.message);
} else {
  console.log('\nresidual_* columns: ALREADY present (migration may have been run before).');
}
