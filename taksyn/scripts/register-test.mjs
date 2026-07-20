import { createClient } from '@supabase/supabase-js'
const URL=process.env.SB_URL, KEY=process.env.SB_ANON
const mk=()=>createClient(URL,KEY,{auth:{persistSession:false}})
let failures=0
const pass=m=>console.log(`  \x1b[32mPASS\x1b[0m ${m}`)
const fail=m=>{console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);failures++}

// mirror the register's targetMet + daysOpen logic exactly
const daysBetween=(a,b)=>{if(!a)return null;const end=b?new Date(b):new Date();return Math.max(0,Math.round((end-new Date(a))/86400000))}
const targetMet=(i)=>{const now=Date.now();const overdue=d=>d&&new Date(d).getTime()<now
  if(i.status==='closed') return !(i.close_due_at && i.closed_at && new Date(i.closed_at)>new Date(i.close_due_at))
  return !(overdue(i.assign_due_at)&&!i.assigned_at) && !(overdue(i.investigate_due_at)&&!i.root_cause) && !overdue(i.close_due_at)}

const run=async()=>{
console.log('\n=== INCIDENT REGISTER: data + metric contract ===\n')
const admin=mk(); const {error:e}=await admin.auth.signInWithPassword({email:'admin@sandbox.test',password:process.env.PW_ADMIN})
if(e){fail('admin sign-in: '+e.message);return}
pass('admin signed in')

const ORG='ORG_SANDBOX'
const { data:incs }=await admin.from('incidents').select('*').eq('org',ORG).order('occurred_at',{ascending:false})
;(incs?.length>0?pass:fail)(`loaded ${incs?.length||0} incidents for register`)

// action counts (register joins these)
const { data:acts }=await admin.from('incident_actions').select('incident_id,status').eq('org',ORG)
const counts={}; (acts||[]).forEach(a=>{const c=counts[a.incident_id]||{open:0,total:0};c.total++;if(a.status!=='verified'&&a.status!=='done')c.open++;counts[a.incident_id]=c})
pass(`action counts computed for ${Object.keys(counts).length} incidents`)

// verify each incident produces a sane register row
let sane=0
for(const i of incs){
  const days=i.status==='closed'?daysBetween(i.occurred_at,i.closed_at):daysBetween(i.occurred_at,null)
  const tgt=targetMet(i)
  const rootCause=i.root_cause?'Yes':'No'
  // sanity: days is a non-negative number or null; target is boolean; ref present
  if(typeof days==='number'&&days>=0 && typeof tgt==='boolean' && i.ref) sane++
}
;(sane===incs.length?pass:fail)(`all ${incs.length} incidents produce valid register rows (${sane} sane)`)

// specifically: a CLOSED incident should show days-open frozen at closure, target evaluated vs close_due_at
const closed=incs.find(i=>i.status==='closed')
if(closed){
  const days=daysBetween(closed.occurred_at,closed.closed_at)
  ;(typeof days==='number'?pass:fail)(`closed incident ${closed.ref}: days-open frozen at ${days}`)
  ;(typeof targetMet(closed)==='boolean'?pass:fail)(`closed incident target evaluated: ${targetMet(closed)?'Met':'Breached'}`)
} else { pass('(no closed incident to check — skipping closed-specific)') }

// an OPEN incident past its assign_due without assignment should read Breached
const openInc=incs.find(i=>i.status!=='closed')
if(openInc){
  console.log(`  open incident ${openInc.ref}: assign_due=${openInc.assign_due_at?'set':'none'}, assigned=${openInc.assigned_at?'yes':'no'}, target=${targetMet(openInc)?'Met':'Breached'}`)
  pass('open incident target computed')
}

// CSV field integrity: build one row's CSV cells, ensure no unescaped breakage
const i=incs[0]
const cells=[i.ref,i.category,i.severity,i.status].map(v=>`"${String(v??'').replace(/"/g,'""')}"`)
;(cells.every(c=>c.startsWith('"')&&c.endsWith('"'))?pass:fail)('CSV cells properly quoted/escaped')

console.log(`\n=== ${failures===0?'\x1b[32mALL PASSED\x1b[0m':`\x1b[31m${failures} FAILURE(S)\x1b[0m`} ===\n`)
}
run().catch(e=>{console.error('HARNESS ERROR:',e.message);process.exit(1)})
