import { createClient } from '@supabase/supabase-js'

const URL = process.env.SB_URL, KEY = process.env.SB_ANON
const ORG = 'ORG_SANDBOX'
const mk = () => createClient(URL, KEY, { auth: { persistSession: false } })

async function as(email, pw) {
  const c = mk()
  const { data, error } = await c.auth.signInWithPassword({ email, password: pw })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return { c, uid: data.user.id }
}

const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`)
const fail = (m) => { console.log(`  \x1b[31mFAIL\x1b[0m ${m}`); failures++ }
let failures = 0

const run = async () => {
console.log('\n=== RLS ISOLATION TEST — incidents ===\n')

// --- 1. worker creates an incident via the RPC
const w = await as('worker@sandbox.test', process.env.PW_WORKER)
const { data: created, error: cErr } = await w.c.rpc('create_incident', {
  p_org: ORG,
  p_category: 'injury_harm',
  p_severity: 4,
  p_occurred_at: new Date().toISOString(),
  p_facts: 'RLS test incident — resident fall, hospital admission.',
  p_payload: { outcome_level: 6, harm_type: 'physical', affected_type: 'client',
               affected_initials: 'JD', department: 'Ward 2',
               clinical: { hospital: { name: 'Test Hosp' } } },
  p_evidence: []
})
if (cErr) { fail(`worker could NOT create incident: ${cErr.message}`); return }
pass(`worker created incident ${created.ref} (id ${created.id})`)
const ID = created.id

// --- 2. worker must NOT read it back
const { data: wRead } = await w.c.from('incidents').select('id').eq('id', ID)
;(wRead?.length ? fail : pass)(`worker read-back: ${wRead?.length ?? 0} rows (expect 0)`)

const { data: wEv } = await w.c.from('incident_events').select('id').eq('incident_id', ID)
;(wEv?.length ? fail : pass)(`worker events: ${wEv?.length ?? 0} rows (expect 0)`)

// --- 3. worker must not see ANY incident in the org
const { data: wAll } = await w.c.from('incidents').select('id')
;(wAll?.length ? fail : pass)(`worker sees ${wAll?.length ?? 0} incidents org-wide (expect 0)`)

// --- 4. manager, NOT assigned, must see nothing
const m = await as('manager@sandbox.test', process.env.PW_MANAGER)
const { data: mBefore } = await m.c.from('incidents').select('id').eq('id', ID)
;(mBefore?.length ? fail : pass)(`unassigned manager: ${mBefore?.length ?? 0} rows (expect 0)`)

// --- 5. client_admin sees everything
const a = await as('admin@sandbox.test', process.env.PW_ADMIN)
const { data: aRead } = await a.c.from('incidents').select('id,ref,severity,clinical').eq('id', ID)
;(aRead?.length === 1 ? pass : fail)(`client_admin reads incident: ${aRead?.length ?? 0} rows (expect 1)`)
if (aRead?.length) pass(`client_admin sees clinical block: ${JSON.stringify(aRead[0].clinical)}`)

const { data: aEv } = await a.c.from('incident_events').select('event_type').eq('incident_id', ID)
;(aEv?.length >= 2 ? pass : fail)(`client_admin sees ${aEv?.length ?? 0} audit events (expect >=2)`)

// --- 6. client_admin assigns the manager
const { error: asgErr } = await a.c.from('incidents')
  .update({ assigned_to: m.uid, assigned_to_name: 'Sample Manager', assigned_role: 'manager', assigned_at: new Date().toISOString() })
  .eq('id', ID)
;(asgErr ? fail : pass)(`client_admin assigned manager${asgErr ? ': ' + asgErr.message : ''}`)

// --- 7. manager NOW sees it
const { data: mAfter } = await m.c.from('incidents').select('id,ref').eq('id', ID)
;(mAfter?.length === 1 ? pass : fail)(`assigned manager: ${mAfter?.length ?? 0} rows (expect 1)`)

// --- 8. worker STILL sees nothing
const { data: wStill } = await w.c.from('incidents').select('id').eq('id', ID)
;(wStill?.length ? fail : pass)(`worker after assignment: ${wStill?.length ?? 0} rows (expect 0)`)

// --- 9. audit spine is immutable
const { error: upErr } = await a.c.from('incident_events').update({ event_type: 'tampered' }).eq('incident_id', ID)
const { data: evAfter } = await a.c.from('incident_events').select('event_type').eq('incident_id', ID)
;(evAfter?.some(e => e.event_type === 'tampered') ? fail : pass)('audit events could NOT be rewritten')

const { error: delErr } = await a.c.from('incident_events').delete().eq('incident_id', ID)
const { data: evLeft } = await a.c.from('incident_events').select('id').eq('incident_id', ID)
;(evLeft?.length >= 2 ? pass : fail)(`audit events could NOT be deleted (${evLeft?.length ?? 0} remain)`)

// --- 10. incident cannot be deleted
const { data: dLeft } = await (async () => { await a.c.from('incidents').delete().eq('id', ID); return a.c.from('incidents').select('id').eq('id', ID) })()
;(dLeft?.length === 1 ? pass : fail)('incident could NOT be deleted')

// --- 11. cross-org: nobody can write into ORG_NAMETEST
const { error: xErr } = await a.c.rpc('create_incident', {
  p_org: 'ORG_NAMETEST', p_category: 'other', p_severity: 1,
  p_occurred_at: new Date().toISOString(), p_facts: 'cross-org attempt'
})
;(xErr ? pass : fail)(`cross-org create blocked${xErr ? '' : ' — LEAK!'}`)

console.log(`\n=== ${failures === 0 ? '\x1b[32mALL PASSED\x1b[0m' : `\x1b[31m${failures} FAILURE(S)\x1b[0m`} ===\n`)
}
run().catch(e => { console.error('HARNESS ERROR:', e.message); process.exit(1) })
