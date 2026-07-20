#!/usr/bin/env python3
# Blob rollout: Tasks blob (all roles) + Requests blob (client_admin only).
# Reuses the incident blob's dot pattern. Leave intentionally excluded (no pending
# status exists - leave is inserted as 'approved'). Incidents already shipped.
# - Tasks: red = a visible pending task past due; orange = any visible open task; else none.
#          (mirrors Dashboard overdue rule: status==='pending' && due_date && due_date < today)
# - Requests: orange = open issue_reports exist (client_admin only); else none. No red.
# Abort-safe: every anchor asserted exactly once; writes only if all succeed.

import sys
PATH = '/workspaces/Taksyn/taksyn/src/App.jsx'

with open(PATH, 'r', encoding='utf-8') as f:
    src = f.read()
orig = src

# ---------------------------------------------------------------
# EDIT 1 - state declarations, placed next to the incident blob useState
# (which is already ABOVE the early returns, so hook order stays valid).
# Anchor: the incident blob useState line (unique).
# ---------------------------------------------------------------
anchor1 = "  const [incidentBlob, setIncidentBlob] = useState('none') // 'none'|'ok'|'warn' -> green/orange/red\n"
state_decl = ("  const [requestsBlob, setRequestsBlob] = useState('none') // 'none'|'ok' -> green/orange (no red)\n")

# ---------------------------------------------------------------
# EDIT 2 - Requests fetch effect (client_admin only), placed right after the
# incident blob effect's closing. Anchor: the incident effect dependency array line.
# ---------------------------------------------------------------
anchor2 = "  },[user, page])\n"  # closes the incident blob effect (unique in this region)

requests_effect = r"""  // Requests sidebar blob (client_admin only): orange = open requests exist, else none. No red.
  useEffect(()=>{
    let cancelled = false
    ;(async()=>{
      try {
        if(!user || user.role!=='client_admin') { setRequestsBlob('none'); return }
        const { count } = await supabase.from('issue_reports')
          .select('id',{count:'exact',head:true}).eq('org',user.org).eq('status','open')
        if(cancelled) return
        setRequestsBlob((count||0)>0 ? 'ok' : 'none')
      } catch(e) { /* leave as-is on error */ }
    })()
    return ()=>{ cancelled = true }
  },[user, page])
"""

# ---------------------------------------------------------------
# EDIT 3 - Tasks blob computed value (role-scoped, no fetch), placed next to the
# other inline nav counts. Anchor: the myReviewCount line (unique).
# ---------------------------------------------------------------
anchor3 = "  const myReviewCount = ['supervisor','manager','client_admin'].includes(user.role) ? tasks.filter(t=>t.status==='awaiting_review'&&visibleTasks([t],user).length>0).length : 0\n"

tasks_blob_calc = r"""  const _blobToday = new Date().toISOString().split('T')[0]
  const _visTasks = tasks.filter(t=>visibleTasks([t],user).length>0)
  const _tasksOverdue = _visTasks.some(t=>t.status==='pending' && t.due_date && t.due_date < _blobToday)
  const _tasksOpen = _visTasks.some(t=>['pending','in_progress','overdue','rejected','awaiting_review'].includes(t.status))
  const tasksBlob = _tasksOverdue ? 'warn' : (_tasksOpen ? 'ok' : 'none')
"""

# ---------------------------------------------------------------
# EDIT 4 - the two nav dots (Tasks + Requests), placed after the existing
# tasks myReview badge line inside the nav map. Anchor: the incident_hub dot line
# (added in Phase A.2, unique) - we add the new dots right after it.
# ---------------------------------------------------------------
anchor4 = "                    {key==='incident_hub'&&incidentBlob!=='none'&&<span title={incidentBlob==='warn'?'An incident needs attention':'Active incidents, on track'} style={{marginLeft:'auto',width:9,height:9,borderRadius:'50%',flexShrink:0,background:incidentBlob==='warn'?'#EF4444':'#F59E0B'}}/>}\n"

nav_dots = r"""                    {key==='tasks'&&tasksBlob!=='none'&&<span title={tasksBlob==='warn'?'Overdue tasks need attention':'Open tasks, on track'} style={{marginLeft:'auto',width:9,height:9,borderRadius:'50%',flexShrink:0,background:tasksBlob==='warn'?'#EF4444':'#F59E0B'}}/>}
                    {key==='issue_reports'&&requestsBlob!=='none'&&<span title="Open requests" style={{marginLeft:'auto',width:9,height:9,borderRadius:'50%',flexShrink:0,background:'#F59E0B'}}/>}
"""

# --- verify all anchors unique ---
for name, a in [('anchor1',anchor1),('anchor2',anchor2),('anchor3',anchor3),('anchor4',anchor4)]:
    if src.count(a) != 1:
        print(f"ABORT: {name} matched {src.count(a)} times (need 1). No changes written.")
        sys.exit(1)

# --- apply ---
src = src.replace(anchor1, anchor1 + state_decl, 1)
src = src.replace(anchor2, anchor2 + requests_effect, 1)
src = src.replace(anchor3, anchor3 + tasks_blob_calc, 1)
src = src.replace(anchor4, anchor4 + nav_dots, 1)

if src == orig:
    print("ABORT: no change produced.")
    sys.exit(1)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(src)
print("OK - blob rollout applied: Tasks blob (all roles) + Requests blob (client_admin only)")
