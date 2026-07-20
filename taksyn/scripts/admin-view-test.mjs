import { createClient } from '@supabase/supabase-js'
const URL=process.env.SB_URL, KEY=process.env.SB_ANON
const mk=()=>createClient(URL,KEY,{auth:{persistSession:false}})
let failures=0
const pass=m=>console.log(`  \x1b[32mPASS\x1b[0m ${m}`)
const fail=m=>{console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);failures++}

// mirror of the view's patchIncident: update incident + append an audit event
async function patchIncident(client, orgId, id, patch, eventType, extra={}, actor){
  const now=new Date().toISOString()
  const { error:upErr }=await client.from('incidents').update({...patch,updated_at:now}).eq('id',id)
  if(upErr) throw upErr
  const { error:evErr }=await client.from('incident_events').insert({
    incident_id:id, org:orgId, event_type:eventType,
    by_id:actor.uid, by_name:actor.name, by_role:actor.role,
    from_value:extra.from??null, to_value:extra.to??null, details:extra.details??null,
  })
  if(evErr) throw evErr
}

const run=async()=>{
console.log('\n=== ADMIN VIEW: write + audit-event contract ===\n')

const admin=mk()
const { data:sa, error:se }=await admin.auth.signInWithPassword({email:'admin@sandbox.test',password:process.env.PW_ADMIN})
if(se){ fail('admin sign-in: '+se.message); return }
const actor={ uid:sa.user.id, name:'Sample Admin', role:'client_admin' }
pass('admin signed in')

const ORG='ORG_SANDBOX'
// grab an existing incident to drive through the workflow
const { data:incs }=await admin.from('incidents').select('*').eq('org',ORG).order('created_at',{ascending:true})
if(!incs?.length){ fail('no incidents to test against'); return }
const inc=incs[0]
console.log(`  (driving ${inc.ref}, id ${inc.id})\n`)

const eventsBefore=(await admin.from('incident_events').select('id').eq('incident_id',inc.id)).data?.length||0

// need a manager to assign to
const { data:mem }=await admin.from('org_members').select('user_id,role').eq('org',ORG)
const mgr=mem.find(m=>m.role==='manager')
const { data:mp }=await admin.from('profiles').select('id,name').eq('id',mgr.user_id).single()

// 1. ASSIGN
await patchIncident(admin,ORG,inc.id,
  { assigned_to:mgr.user_id, assigned_to_name:mp.name, assigned_role:'manager', assigned_at:new Date().toISOString() },
  'assigned', { to:mp.name }, actor)
let row=(await admin.from('incidents').select('assigned_to,status').eq('id',inc.id).single()).data
;(row.assigned_to===mgr.user_id?pass:fail)('assign: incident.assigned_to updated')

// 2. STATUS -> investigating
await patchIncident(admin,ORG,inc.id,{status:'investigating'},'investigation_started',{from:inc.status,to:'investigating'},actor)
row=(await admin.from('incidents').select('status').eq('id',inc.id).single()).data
;(row.status==='investigating'?pass:fail)('status: -> investigating')

// 3. ROOT CAUSE
await patchIncident(admin,ORG,inc.id,{root_cause:'Wet floor, no signage'},'root_cause_recorded',{to:'recorded'},actor)
row=(await admin.from('incidents').select('root_cause').eq('id',inc.id).single()).data
;(row.root_cause==='Wet floor, no signage'?pass:fail)('root cause saved')

// 4. RISK RATING
await patchIncident(admin,ORG,inc.id,{risk_likelihood:3,risk_consequence:4,risk_rating:12},'risk_rated',{to:'12',details:{likelihood:3,consequence:4}},actor)
row=(await admin.from('incidents').select('risk_rating,risk_likelihood,risk_consequence').eq('id',inc.id).single()).data
;(row.risk_rating===12&&row.risk_likelihood===3&&row.risk_consequence===4?pass:fail)('risk rating 3×4=12 saved')

// 5. ADD CORRECTIVE ACTION (+ its event)
await admin.from('incident_actions').insert({incident_id:inc.id,org:ORG,description:'Install signage',action_type:'corrective'})
await admin.from('incident_events').insert({incident_id:inc.id,org:ORG,event_type:'action_created',by_id:actor.uid,by_name:actor.name,by_role:actor.role,to_value:'Install signage'})
const { data:acts }=await admin.from('incident_actions').select('id').eq('incident_id',inc.id)
;(acts?.length>=1?pass:fail)(`corrective action created (${acts?.length} total)`)

// 6. CLOSE
await patchIncident(admin,ORG,inc.id,{status:'closed',closed_at:new Date().toISOString(),closure_note:'Signage installed, staff briefed'},'closed',{from:'investigating',to:'closed',details:{note:'Signage installed'}},actor)
row=(await admin.from('incidents').select('status,closure_note').eq('id',inc.id).single()).data
;(row.status==='closed'&&row.closure_note?pass:fail)('incident closed with note')

// ---- THE KEY CHECK: audit spine captured every step ----
const { data:evAll }=await admin.from('incident_events').select('event_type,by_name,at').eq('incident_id',inc.id).order('at',{ascending:true})
const eventsAfter=evAll.length
const types=evAll.map(e=>e.event_type)
console.log(`\n  audit events: ${eventsBefore} before -> ${eventsAfter} after`)
;(eventsAfter-eventsBefore>=6?pass:fail)(`>=6 new audit events written (got ${eventsAfter-eventsBefore})`)
;['assigned','investigation_started','root_cause_recorded','risk_rated','action_created','closed'].forEach(t=>
  (types.includes(t)?pass:fail)(`audit contains '${t}'`))
;(evAll.every(e=>e.by_name)?pass:fail)('every event has an actor name')

// 7. IMMUTABILITY still holds through the view's client
const { error:tamperErr }=await admin.from('incident_events').update({event_type:'x'}).eq('incident_id',inc.id)
const stillClean=!(await admin.from('incident_events').select('event_type').eq('incident_id',inc.id)).data.some(e=>e.event_type==='x')
;(stillClean?pass:fail)('audit events cannot be rewritten by admin')

console.log(`\n=== ${failures===0?'\x1b[32mALL PASSED\x1b[0m':`\x1b[31m${failures} FAILURE(S)\x1b[0m`} ===\n`)
}
run().catch(e=>{console.error('HARNESS ERROR:',e.message);process.exit(1)})
