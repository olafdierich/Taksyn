#!/usr/bin/env python3
# Abort-safe edit: consolidate incident nav into a single "Incidents" hub (Option A1).
# - Adds IncidentHubView component (role-aware: Report + Review + Register).
# - Rewrites NAV for client_admin / manager / supervisor to a single 'incident_hub' entry.
# - Leaves worker's direct 'report_incident' link untouched.
# - Adds the 'incident_hub' route.
# Matches exact anchors, asserts each count == 1, writes ONLY if all match. Else ABORT, no change.

import sys

p = "/workspaces/Taksyn/taksyn/src/App.jsx"
s = open(p, encoding="utf-8").read()

edits = []

# ---- 1. NAV: client_admin (line 6141) ----
ca_old = "['issue_reports','Requests','clipboard'],['incidents','Incidents','alert'],['incident_register','Incident Register','chart']]"
ca_new = "['issue_reports','Requests','clipboard'],['incident_hub','Incidents','alert']]"
edits.append(("NAV client_admin", ca_old, ca_new))

# ---- 2. NAV: manager (line 6142) ----
mgr_old = "['issue_reports','Log a Request','flag'],['incidents','Incidents','alert']],\n  supervisor:"
mgr_new = "['issue_reports','Log a Request','flag'],['incident_hub','Incidents','alert']],\n  supervisor:"
edits.append(("NAV manager", mgr_old, mgr_new))

# ---- 3. NAV: supervisor (line 6143) ----
sup_old = "['issue_reports','Log a Request','flag'],['incidents','Incidents','alert']],\n  worker:"
sup_new = "['issue_reports','Log a Request','flag'],['incident_hub','Incidents','alert']],\n  worker:"
edits.append(("NAV supervisor", sup_old, sup_new))

# ---- 4. Add route for incident_hub (before the report_incident route) ----
route_old = "                {page==='report_incident' && <IncidentReportView user={user}/>}"
route_new = ("                {page==='incident_hub' && ['client_admin','manager','supervisor'].includes(user.role) && <IncidentHubView user={user} setPage={setPage}/>}\n"
             "                {page==='report_incident' && <IncidentReportView user={user}/>}")
edits.append(("route incident_hub", route_old, route_new))

# ---- 5. Add IncidentHubView component (just before IncidentReportView) ----
comp_old = "function IncidentReportView({ user }) {"
comp_new = (
'''function IncidentHubView({ user, setPage }) {
  const isCA = user.role==='client_admin'
  const canReview = ['client_admin','manager','supervisor'].includes(user.role)
  const Tile = ({icon,title,sub,onClick,color}) => (
    <div onClick={onClick} style={{cursor:'pointer',flex:'1 1 220px',minWidth:220,background:'var(--s1)',border:'1px solid var(--border)',borderRadius:12,padding:'22px 20px',display:'flex',flexDirection:'column',gap:6,transition:'box-shadow .15s',boxShadow:'0 1px 2px rgba(0,0,0,.04)'}}
      onMouseEnter={e=>e.currentTarget.style.boxShadow='0 4px 14px rgba(0,0,0,.10)'}
      onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,.04)'}>
      <div style={{fontSize:30,lineHeight:1}}>{icon}</div>
      <div style={{fontWeight:700,fontSize:16,color:color||'var(--text)'}}>{title}</div>
      <div style={{fontSize:13,color:'var(--t2)',lineHeight:1.4}}>{sub}</div>
    </div>
  )
  return (
    <div>
      <div className="ph"><div className="ph-title">Incidents</div><div className="ph-sub">Report a new incident, or review and manage existing ones</div></div>
      <div style={{display:'flex',flexWrap:'wrap',gap:16,marginTop:8}}>
        <Tile icon="➕" title="Report an incident" color="#DC2626"
          sub="Log a new incident — injury, near miss, damage or other. Takes a couple of minutes."
          onClick={()=>setPage('report_incident')}/>
        {canReview && <Tile icon="📋" title="Review incidents"
          sub={isCA?'View, assign, investigate and close incidents across the organisation.':'View and progress the incidents assigned to you.'}
          onClick={()=>setPage('incidents')}/>}
        {isCA && <Tile icon="📊" title="Incident register"
          sub="The full compliance record — trends, filters, and CSV / PDF export."
          onClick={()=>setPage('incident_register')}/>}
      </div>
    </div>
  )
}

function IncidentReportView({ user }) {'''
)
edits.append(("IncidentHubView component", comp_old, comp_new))

# Verify every anchor matches exactly once
abort = False
for name, old, new in edits:
    n = s.count(old)
    if n != 1:
        print(f"ABORT [{name}]: expected 1 match, found {n}.")
        abort = True

if abort:
    print("NO CHANGES WRITTEN.")
    sys.exit(1)

for name, old, new in edits:
    s = s.replace(old, new)

open(p, "w", encoding="utf-8").write(s)
print("OK: all 5 edits applied (NAV x3, route, hub component).")
