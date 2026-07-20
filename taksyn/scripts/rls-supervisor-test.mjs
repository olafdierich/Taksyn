import { createClient } from '@supabase/supabase-js'

const URL = process.env.SB_URL, KEY = process.env.SB_ANON
const mk = () => createClient(URL, KEY, { auth: { persistSession: false } })

async function as(email, pw) {
  const c = mk()
  const { data, error } = await c.auth.signInWithPassword({ email, password: pw })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return { c, uid: data.user.id }
}

let failures = 0
const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`)
const fail = (m) => { console.log(`  \x1b[31mFAIL\x1b[0m ${m}`); failures++ }

const run = async () => {
console.log('\n=== SUPERVISOR + CROSS-ORG TEST ===\n')

const s = await as('supervisor@sandbox.test', process.env.PW_SUPER)
const a = await as('admin@sandbox.test', process.env.PW_ADMIN)

// existing incident from the last test
const { data: inc } = await a.c.from('incidents').select('id,ref').limit(1)
if (!inc?.length) { fail('no incident found to test against'); return }
const ID = inc[0].id
console.log(`  (testing against ${inc[0].ref}, id ${ID})\n`)

// 1. supervisor, NOT assigned -> must see nothing
const { data: s1 } = await s.c.from('incidents').select('id').eq('id', ID)
;(s1?.length ? fail : pass)(`unassigned supervisor: ${s1?.length ?? 0} rows (expect 0)`)

const { data: sAll } = await s.c.from('incidents').select('id')
;(sAll?.length ? fail : pass)(`unassigned supervisor org-wide: ${sAll?.length ?? 0} (expect 0)`)

// 2. admin names the supervisor as INVESTIGATOR (not assignee - tests the other clause)
const { error: invErr } = await a.c.from('incidents')
  .update({ investigator_id: s.uid, investigator_name: 'Sample Supervisor' })
  .eq('id', ID)
;(invErr ? fail : pass)(`admin set supervisor as investigator${invErr ? ': ' + invErr.message : ''}`)

// 3. supervisor NOW sees it (via investigator_id clause)
const { data: s2 } = await s.c.from('incidents').select('id,ref,clinical').eq('id', ID)
;(s2?.length === 1 ? pass : fail)(`investigator supervisor: ${s2?.length ?? 0} rows (expect 1)`)

// 4. supervisor can see the audit trail of their own incident
const { data: sEv } = await s.c.from('incident_events').select('event_type').eq('incident_id', ID)
;(sEv?.length >= 2 ? pass : fail)(`supervisor sees ${sEv?.length ?? 0} audit events (expect >=2)`)

// 5. supervisor can UPDATE their incident (record root cause)
const { error: rcErr } = await s.c.from('incidents').update({ root_cause: 'test root cause' }).eq('id', ID)
;(rcErr ? fail : pass)(`supervisor recorded root cause${rcErr ? ': ' + rcErr.message : ''}`)

// 6. supervisor CANNOT delete it
await s.c.from('incidents').delete().eq('id', ID)
const { data: still } = await a.c.from('incidents').select('id').eq('id', ID)
;(still?.length === 1 ? pass : fail)('supervisor could NOT delete the incident')

// 7. supervisor cannot tamper with the audit spine
await s.c.from('incident_events').update({ event_type: 'tampered' }).eq('incident_id', ID)
const { data: evChk } = await a.c.from('incident_events').select('event_type').eq('incident_id', ID)
;(evChk?.some(e => e.event_type === 'tampered') ? fail : pass)('supervisor could NOT rewrite audit events')

// 8. CROSS-ORG READ: admin of ORG_SANDBOX must not read ORG_NAMETEST config
const { data: xCfg } = await a.c.from('incident_config').select('id').eq('org', 'ORG_NAMETEST')
;(xCfg?.length ? fail : pass)(`admin reading ORG_NAMETEST config: ${xCfg?.length ?? 0} rows (expect 0)`)

// 9. admin CAN read own org config
const { data: oCfg } = await a.c.from('incident_config').select('id').eq('org', 'ORG_SANDBOX')
;(oCfg?.length === 5 ? pass : fail)(`admin reads own org config: ${oCfg?.length ?? 0} rows (expect 5)`)

console.log(`\n=== ${failures === 0 ? '\x1b[32mALL PASSED\x1b[0m' : `\x1b[31m${failures} FAILURE(S)\x1b[0m`} ===\n`)
}
run().catch(e => { console.error('HARNESS ERROR:', e.message); process.exit(1) })
