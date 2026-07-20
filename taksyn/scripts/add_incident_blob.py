#!/usr/bin/env python3
# Phase A.2 - three-state incident sidebar blob (green/orange/red).
# Option A: self-contained app-level fetch, mirrors the proven Dashboard breach logic
# (App.jsx lines ~2004-2013). Does NOT touch DashboardView.
# green = no active incidents; orange = active on-track; red = at least one breached.
# Red today = breached timeframe target only (review-based reds arrive with Phase B.3).
# Abort-safe: every anchor asserted exactly once; writes only if all succeed.

import sys
PATH = '/workspaces/Taksyn/taksyn/src/App.jsx'

with open(PATH, 'r', encoding='utf-8') as f:
    src = f.read()
orig = src

# ---------------------------------------------------------------
# EDIT 1 - state declaration.
# Anchor: the inline count line just before navItems (unique).
# We insert the useState right before the escalationCount line.
# ---------------------------------------------------------------
anchor1 = "  const escalationCount = tasks.filter(t=>t.escalation||t.status==='overdue').length"
state_decl = "  const [incidentBlob, setIncidentBlob] = useState('none') // 'none'|'ok'|'warn' -> green/orange/red\n"

# ---------------------------------------------------------------
# EDIT 2 - the fetch effect.
# Anchor: the page->sessionStorage sync effect (unique, seen at ~14332).
# Insert our effect immediately AFTER it.
# ---------------------------------------------------------------
anchor2 = "  useEffect(()=>{ if(page) sessionStorage.setItem('taksyn-page', page) },[page])\n"

blob_effect = r"""  // Incident sidebar blob: green=no active, orange=active on-track, red=breached.
  // Self-contained read (Option A); mirrors the Dashboard breach rule. RLS scopes visibility per role.
  useEffect(()=>{
    let cancelled = false
    ;(async()=>{
      try {
        if(!user || !['client_admin','manager','supervisor'].includes(user.role)) { setIncidentBlob('none'); return }
        const { data: sess } = await supabase.auth.getSession()
        const authId = sess?.session?.user?.id
        if(!authId) return
        const { data: mem } = await supabase.from('org_members').select('org').eq('user_id', authId)
        const oid = (mem||[]).map(m=>m.org).find(o=>/^ORG/i.test(o||''))
        if(!oid) return
        const { data: rows } = await supabase.from('incidents')
          .select('status,assigned_at,root_cause,assign_due_at,investigate_due_at,close_due_at,closed_at')
          .eq('org', oid)
        if(cancelled) return
        const now = Date.now(); const od=(d)=>d&&new Date(d).getTime()<now
        const active = (rows||[]).filter(i=>i.status!=='closed')
        const breached = active.filter(i=>(od(i.assign_due_at)&&!i.assigned_at)||(od(i.investigate_due_at)&&!i.root_cause)||od(i.close_due_at))
        setIncidentBlob(breached.length>0 ? 'warn' : (active.length>0 ? 'ok' : 'none'))
      } catch(e) { /* leave blob as-is on error */ }
    })()
    return ()=>{ cancelled = true }
  },[user, page])
"""

# ---------------------------------------------------------------
# EDIT 3 - render the dot on the incident_hub nav item.
# Anchor: the tasks myReview badge line inside the nav map (unique).
# Insert the blob span right after it (still inside the button map).
# ---------------------------------------------------------------
anchor3 = "                    {key==='tasks'&&myReviewCount>0&&<span className=\"nav-badge amber\">{myReviewCount}</span>}\n"

blob_render = r"""                    {key==='incident_hub'&&incidentBlob!=='none'&&<span title={incidentBlob==='warn'?'An incident needs attention':'Active incidents, on track'} style={{marginLeft:'auto',width:9,height:9,borderRadius:'50%',flexShrink:0,background:incidentBlob==='warn'?'#EF4444':'#F59E0B'}}/>}
"""

# --- verify all anchors unique -------------------------------------------------
for name, a in [('anchor1',anchor1),('anchor2',anchor2),('anchor3',anchor3)]:
    if src.count(a) != 1:
        print(f"ABORT: {name} matched {src.count(a)} times (need 1). No changes written.")
        sys.exit(1)

# --- apply ---------------------------------------------------------------------
src = src.replace(anchor1, state_decl + anchor1, 1)
src = src.replace(anchor2, anchor2 + blob_effect, 1)
src = src.replace(anchor3, anchor3 + blob_render, 1)

if src == orig:
    print("ABORT: no change produced.")
    sys.exit(1)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(src)

print("OK - incident sidebar blob added (state + fetch effect + nav dot)")
