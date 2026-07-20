import { createClient } from '@supabase/supabase-js'

const URL = process.env.SB_URL, KEY = process.env.SB_ANON
const mk = () => createClient(URL, KEY, { auth: { persistSession: false } })

let failures = 0
const pass = m => console.log(`  \x1b[32mPASS\x1b[0m ${m}`)
const fail = m => { console.log(`  \x1b[31mFAIL\x1b[0m ${m}`); failures++ }

// ---- mirror of the form's submit logic ----
// This reproduces exactly what IncidentReportView does on Submit, so we test the
// real data contract: org resolution + payload shape + rpc call.
async function formSubmit(client, formState) {
  // 1. resolve org ID from org_members (same idiom as the component)
  const { data: sess } = await client.auth.getSession()
  const authId = sess?.session?.user?.id
  const { data: members } = await client.from('org_members').select('org').eq('user_id', authId)
  const orgId = (members||[]).map(m=>m.org).find(o => /^ORG/i.test(o||''))
  if (!orgId) throw new Error('org not resolved')

  const {
    category, harmType, outcome, severity, suggested, overrideReason,
    affectedType, affectedInitials, occurredAt, shift, department,
    locationText, gps, facts, immediateActions, hazardPresent, clinicalNote, evidence
  } = formState
  const isHarm = category === 'injury_harm'
  const effectiveSeverity = severity || suggested
  const overrideNeeded = severity && suggested && severity !== suggested

  const payload = {
    severity_suggested: suggested || null,
    severity_override_reason: overrideNeeded ? overrideReason : null,
    shift: shift||null, department: department||null, location_text: locationText||null,
    gps: gps||null, immediate_actions: immediateActions||null, hazard_present: !!hazardPresent,
    affected_type: affectedType||null, affected_initials: affectedInitials||null,
    outcome_level: outcome||null, harm_type: isHarm ? harmType : null,
    clinical: (isHarm && clinicalNote) ? { note: clinicalNote } : null,
  }

  const { data, error } = await client.rpc('create_incident', {
    p_org: orgId,
    p_category: category,
    p_severity: effectiveSeverity,
    p_occurred_at: new Date(occurredAt).toISOString(),
    p_facts: facts,
    p_payload: payload,
    p_evidence: (evidence||[]).map(e => ({ kind:e.kind, url:e.url, name:e.name||null })),
  })
  if (error) throw error
  return data // { id, ref }
}

const run = async () => {
console.log('\n=== FORM DATA-CONTRACT TEST (headless) ===\n')

// sign in as the worker, exactly as the form's user would be
const worker = mk()
const { error: sErr } = await worker.auth.signInWithPassword({ email:'worker@sandbox.test', password: process.env.PW_WORKER })
if (sErr) { fail('worker sign-in: '+sErr.message); return }
pass('worker signed in')

// ---- Scenario 1: a harm incident with clinical detail + override ----
// worker fills the form: injury, infection, antibiotics, but overrides severity up to 4
const form1 = {
  category:'injury_harm', harmType:'infection_illness',
  outcome:4,                       // "Antibiotics commenced" -> suggests severity 3
  severity:4,                      // worker overrides UP to 4
  suggested:3, overrideReason:'Resident deteriorating, GP escalating to hospital',
  affectedType:'client', affectedInitials:'A.B.',
  occurredAt:'2026-07-14T09:30', shift:'Morning', department:'Ward 2',
  locationText:'Room 14', gps:{lat:-27.4698,lng:153.0251},
  facts:'Resident developed wound infection; antibiotics commenced.',
  immediateActions:'GP notified, wound dressed, obs increased',
  hazardPresent:false,
  clinicalNote:'Amoxicillin 500mg TDS commenced 14/7',
  evidence:[],
}
let r1
try { r1 = await formSubmit(worker, form1); pass(`form submitted -> ${r1.ref} (id ${r1.id})`) }
catch(e) { fail('form1 submit: '+e.message); return }

// worker gets receipt only — must NOT be able to read the incident back
const { data: wRead } = await worker.from('incidents').select('id').eq('id', r1.id)
;(wRead?.length ? fail : pass)(`worker cannot read own report back: ${wRead?.length??0} rows (expect 0)`)

// ---- verify via admin that the payload landed with correct field mapping ----
const admin = mk()
await admin.auth.signInWithPassword({ email:'admin@sandbox.test', password: process.env.PW_ADMIN })
const { data: inc } = await admin.from('incidents').select('*').eq('id', r1.id).single()

const checks = [
  ['category', inc.category==='injury_harm'],
  ['severity is the OVERRIDE (4), not suggested (3)', inc.severity===4],
  ['severity_suggested recorded (3)', inc.severity_suggested===3],
  ['override reason stored', !!inc.severity_override_reason],
  ['harm_type', inc.harm_type==='infection_illness'],
  ['outcome_level', inc.outcome_level===4],
  ['affected_type', inc.affected_type==='client'],
  ['affected_initials (not full name)', inc.affected_initials==='A.B.'],
  ['department', inc.department==='Ward 2'],
  ['gps stored as jsonb', inc.gps && inc.gps.lat===-27.4698],
  ['clinical note in jsonb', inc.clinical && inc.clinical.note && inc.clinical.note.includes('Amoxicillin')],
  ['status = reported', inc.status==='reported'],
  ['ref format INC-2026-####', /^INC-2026-\d{4}$/.test(inc.ref)],
  ['reporter recorded', !!inc.reported_by],
  ['due dates stamped from config (sev4 assign_within_hours=4)', !!inc.assign_due_at],
]
checks.forEach(([label, ok]) => (ok?pass:fail)(label))

// audit spine: should have reported + severity_set events
const { data: ev } = await admin.from('incident_events').select('event_type').eq('incident_id', r1.id)
const types = (ev||[]).map(e=>e.event_type)
;(types.includes('reported') ? pass : fail)(`audit: 'reported' event present`)
;(types.includes('severity_set') ? pass : fail)(`audit: 'severity_set' event present`)

// ---- Scenario 2: a simple property-damage incident, no harm branch ----
const form2 = {
  category:'property_damage', harmType:'', outcome:0,
  severity:2, suggested:0, overrideReason:'',
  affectedType:'', affectedInitials:'',
  occurredAt:'2026-07-14T14:00', shift:'', department:'Kitchen',
  locationText:'Cool room', gps:null,
  facts:'Cool room door hinge broken, door not sealing.',
  immediateActions:'Taped shut, maintenance called', hazardPresent:true,
  clinicalNote:'', evidence:[],
}
let r2
try { r2 = await formSubmit(worker, form2); pass(`property form submitted -> ${r2.ref}`) }
catch(e) { fail('form2 submit: '+e.message) }
if (r2) {
  const { data: inc2 } = await admin.from('incidents').select('category,severity,harm_type,outcome_level,hazard_present,clinical').eq('id', r2.id).single()
  ;(inc2.category==='property_damage' ? pass : fail)('property: category correct')
  ;(inc2.severity===2 ? pass : fail)('property: severity 2 (no ladder)')
  ;(inc2.harm_type===null ? pass : fail)('property: harm_type null (not a harm incident)')
  ;(inc2.clinical===null ? pass : fail)('property: clinical null')
  ;(inc2.hazard_present===true ? pass : fail)('property: hazard_present flag carried')
}

console.log(`\n=== ${failures===0 ? '\x1b[32mALL PASSED\x1b[0m' : `\x1b[31m${failures} FAILURE(S)\x1b[0m`} ===\n`)
}
run().catch(e => { console.error('HARNESS ERROR:', e.message); process.exit(1) })
