import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
const URL=process.env.SB_URL, KEY=process.env.SB_ANON
const mk=()=>createClient(URL,KEY,{auth:{persistSession:false}})
let failures=0
const pass=m=>console.log(`  \x1b[32mPASS\x1b[0m ${m}`)
const fail=m=>{console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);failures++}

// mirror of the view's manager-side capabilities
const run=async()=>{
console.log('\n=== MANAGER/SUPERVISOR VIEW: scope + capability contract ===\n')

// sign in as admin to set up, manager + supervisor to test
const admin=mk(); await admin.auth.signInWithPassword({email:'admin@sandbox.test',password:process.env.PW_ADMIN})
const mgr=mk(); const {data:ms,error:me}=await mgr.auth.signInWithPassword({email:'manager@sandbox.test',password:process.env.PW_MANAGER})
if(me){fail('manager sign-in: '+me.message);return}
const sup=mk(); await sup.auth.signInWithPassword({email:'supervisor@sandbox.test',password:process.env.PW_SUPER})
pass('admin, manager, supervisor signed in')

const ORG='ORG_SANDBOX'
const mgrUid=ms.user.id

// admin creates two fresh incidents: one assigned to manager, one to nobody
const { data:sess } = await admin.auth.getSession()
async function adminCreate(facts){
  const { data } = await admin.rpc('create_incident',{p_org:ORG,p_category:'other',p_severity:2,p_occurred_at:new Date().toISOString(),p_facts:facts,p_payload:{},p_evidence:[]})
  return data.id
}
const mineId = await adminCreate('MANAGER-SCOPE-TEST assigned to manager')
const notMineId = await adminCreate('MANAGER-SCOPE-TEST not assigned')
await admin.from('incidents').update({assigned_to:mgrUid,assigned_to_name:'Sample Manager',assigned_role:'manager',assigned_at:new Date().toISOString()}).eq('id',mineId)
pass(`set up: incident ${mineId} assigned to manager, ${notMineId} unassigned`)

// 1. SCOPE: manager's full incident query returns only assigned/investigator rows (RLS)
const { data:mgrList } = await mgr.from('incidents').select('id,status').eq('org',ORG)
const ids=(mgrList||[]).map(i=>i.id)
;(ids.includes(mineId)?pass:fail)(`manager sees assigned incident ${mineId}`)
;(!ids.includes(notMineId)?pass:fail)(`manager does NOT see unassigned incident ${notMineId}`)

// 2. CAPABILITY: manager CAN record root cause (investigation work) + audit event
async function mgrPatch(id,patch,ev,extra={}){
  const {error:up}=await mgr.from('incidents').update({...patch,updated_at:new Date().toISOString()}).eq('id',id)
  if(up) throw up
  const {error:e}=await mgr.from('incident_events').insert({incident_id:id,org:ORG,event_type:ev,by_id:mgrUid,by_name:'Sample Manager',by_role:'manager',...extra})
  if(e) throw e
}
try{ await mgrPatch(mineId,{root_cause:'Manager investigated'},'root_cause_recorded',{to_value:'recorded'}); pass('manager recorded root cause on own incident') }
catch(e){ fail('manager root cause: '+e.message) }

// 3. CAPABILITY: manager CAN move to review
try{ await mgrPatch(mineId,{status:'review'},'status_changed',{from_value:'reported',to_value:'review'}); pass('manager moved incident to review') }
catch(e){ fail('manager -> review: '+e.message) }

// 4. GOVERNANCE (DB-level): manager CANNOT touch an incident not assigned to them
const { error:crossErr } = await mgr.from('incidents').update({root_cause:'should fail'}).eq('id',notMineId)
const { data:check } = await admin.from('incidents').select('root_cause').eq('id',notMineId).single()
;(check.root_cause===null?pass:fail)('manager cannot modify an incident not assigned to them (RLS)')

// 5. The "close is admin-only" rule is UI-enforced (managers have no Close button).
//    At DB level a manager assigned to the incident CAN write status='closed' — RLS allows
//    update by the assignee. So closure control is a UI/governance boundary, not RLS.
//    Verify the view correctly withholds it: we assert the component source has isAdmin-gated close.
const src=fs.readFileSync('IncidentsAdminView_v2.jsx','utf8')
;(/isAdmin && \(sel\.status!=='closed'/.test(src)?pass:fail)('view source: Close button is isAdmin-gated')
;(/if \(!isAdmin && !\(i\.assigned_to===currentUid/.test(src)?pass:fail)('view source: list filtered to own assigned for non-admins')
const adminSelectReadonly = src.includes("{isAdmin ? (") && src.includes("— unassigned —')}")
;(adminSelectReadonly?pass:fail)('view source: assignee/investigator read-only for non-admins')

// 6. supervisor path: assign supervisor as investigator, confirm they see it
const { data:ss } = await sup.auth.getSession()
const supUid = ss.session.user.id
await admin.from('incidents').update({investigator_id:supUid,investigator_name:'Sample Supervisor'}).eq('id',mineId)
const { data:supList } = await sup.from('incidents').select('id').eq('org',ORG)
;((supList||[]).some(i=>i.id===mineId)?pass:fail)('supervisor sees incident where they are investigator')

console.log(`\n=== ${failures===0?'\x1b[32mALL PASSED\x1b[0m':`\x1b[31m${failures} FAILURE(S)\x1b[0m`} ===\n`)
}
run().catch(e=>{console.error('HARNESS ERROR:',e.message);process.exit(1)})
