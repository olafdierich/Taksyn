#!/usr/bin/env python3
"""
Adds incident cards + counts to DashboardView. Abort-safe.
- client_admin/manager: "Open Incidents" + "Breached" cards
- manager/supervisor: "My Incidents" card
Run from /workspaces/Taksyn/taksyn.
"""
import sys, os, re
APP='src/App.jsx'
if not os.path.exists(APP): print(f'ABORT: {APP} not found.'); sys.exit(1)
src=open(APP).read(); orig=src

# EDIT 1: add state vars right after openIssuesCount state
anchor_state='  const [openIssuesCount, setOpenIssuesCount] = useState(0)'
if 'const [openIncidents,' in src:
    print('SKIP edit1: incident count state already present.')
else:
    if src.count(anchor_state)!=1:
        print(f'ABORT edit1: openIssuesCount state anchor x{src.count(anchor_state)} (expect 1). No change.'); sys.exit(1)
    add='''  const [openIssuesCount, setOpenIssuesCount] = useState(0)
  const [openIncidents, setOpenIncidents] = useState(0)
  const [breachedIncidents, setBreachedIncidents] = useState(0)
  const [myIncidents, setMyIncidents] = useState(0)'''
    src=src.replace(anchor_state, add, 1); print('OK edit1: incident count state added.')

# EDIT 2: add the loading effect right after the openIssuesCount effect
anchor_effect='''  useEffect(()=>{
    if (!(isCA||isMgr||isSup) || !isConfigured() || !user?.org) return
    supabase.from('issue_reports').select('id', {count:'exact',head:true}).eq('org',user.org).eq('status','open')
      .then(({count})=>{ if(count!=null) setOpenIssuesCount(count) }).catch(()=>{})
  }, [user?.org, user?.role])'''
if 'setOpenIncidents(' in src:
    print('SKIP edit2: incident count effect already present.')
else:
    if anchor_effect not in src:
        print('ABORT edit2: openIssuesCount effect anchor not found. No change.'); open(APP,'w').write(orig); sys.exit(1)
    add_effect=anchor_effect+'''
  useEffect(()=>{
    if (!isConfigured()) return
    ;(async()=>{
      const { data: sess } = await supabase.auth.getSession()
      const authId = sess?.session?.user?.id
      if (!authId) return
      const { data: mem } = await supabase.from('org_members').select('org').eq('user_id', authId)
      const oid = (mem||[]).map(m=>m.org).find(o=>/^ORG/i.test(o||''))
      if (!oid) return
      if (isCA||isMgr) {
        // count open incidents + compute breached from minimal columns
        const { data: rows } = await supabase.from('incidents')
          .select('status,assigned_at,root_cause,assign_due_at,investigate_due_at,close_due_at,closed_at')
          .eq('org', oid)
        const now = Date.now(); const od=(d)=>d&&new Date(d).getTime()<now
        const open = (rows||[]).filter(i=>i.status!=='closed')
        setOpenIncidents(open.length)
        const breached = (rows||[]).filter(i=>{
          if(i.status==='closed') return i.close_due_at&&i.closed_at&&new Date(i.closed_at)>new Date(i.close_due_at)
          return (od(i.assign_due_at)&&!i.assigned_at)||(od(i.investigate_due_at)&&!i.root_cause)||od(i.close_due_at)
        })
        setBreachedIncidents(breached.length)
      }
      if (isMgr||isSup) {
        // RLS scopes to assigned/investigator, so a plain count is "my incidents"
        const { count } = await supabase.from('incidents').select('id',{count:'exact',head:true}).eq('org', oid).neq('status','closed')
        if (count!=null) setMyIncidents(count)
      }
    })().catch(()=>{})
  }, [user?.org, user?.role])'''
    src=src.replace(anchor_effect, add_effect, 1); print('OK edit2: incident count effect added.')

# EDIT 3: client_admin/manager cards — append to the (isCA||isMgr) stat block, before its closing </>}
# The block ends with the Open Requests card then </>}. Insert our two cards right before that </>}.
ca_open_requests_end='''<div className="sc-val" style={{color:openIssuesCount>0?'#EF4444':'#6B7280'}}>{openIssuesCount}</div><div className="sc-sub">need attention</div></div></>}'''
if 'Open Incidents' in src:
    print('SKIP edit3: incident cards already present.')
else:
    if src.count(ca_open_requests_end)!=2:
        print(f'ABORT edit3: Open Requests card end x{src.count(ca_open_requests_end)} (expect 2). No change.'); open(APP,'w').write(orig); sys.exit(1)
    # the FIRST occurrence is the (isCA||isMgr) block; the SECOND is the isSup block.
    inc_cards_ca='''<div className="sc-val" style={{color:openIssuesCount>0?'#EF4444':'#6B7280'}}>{openIssuesCount}</div><div className="sc-sub">need attention</div></div><div className="stat-card" style={{cursor:'pointer'}} onClick={()=>setPage('incidents')}><div className="sc-top"><span className="sc-label">Open Incidents</span><div className="sc-icon" style={{background:openIncidents>0?'rgba(239,68,68,.1)':'rgba(107,114,128,.1)',color:openIncidents>0?'#EF4444':'#6B7280'}}>🚨</div></div><div className="sc-val" style={{color:openIncidents>0?'#EF4444':'#6B7280'}}>{openIncidents}</div><div className="sc-sub">being handled</div></div><div className="stat-card" style={{cursor:'pointer'}} onClick={()=>setPage('incident_register')}><div className="sc-top"><span className="sc-label">Breached</span><div className="sc-icon" style={{background:breachedIncidents>0?'rgba(239,68,68,.1)':'rgba(16,185,129,.1)',color:breachedIncidents>0?'#EF4444':'#10B981'}}>⏱</div></div><div className="sc-val" style={{color:breachedIncidents>0?'#EF4444':'#10B981'}}>{breachedIncidents}</div><div className="sc-sub">target missed</div></div></>}'''
    # replace only the FIRST occurrence (isCA||isMgr block)
    idx=src.find(ca_open_requests_end)
    src=src[:idx]+inc_cards_ca+src[idx+len(ca_open_requests_end):]
    print('OK edit3: client_admin/manager incident cards added.')

# EDIT 4: manager/supervisor "My Incidents" — add to the isSup block (now the remaining occurrence)
# The isSup block still ends with the original Open Requests end string (only 1 left now).
if 'My Incidents' in src:
    print('SKIP edit4: My Incidents card already present.')
else:
    if src.count(ca_open_requests_end)!=1:
        print(f'ABORT edit4: isSup Open Requests end x{src.count(ca_open_requests_end)} (expect 1). Reverting.'); open(APP,'w').write(orig); sys.exit(1)
    my_card='''<div className="sc-val" style={{color:openIssuesCount>0?'#EF4444':'#6B7280'}}>{openIssuesCount}</div><div className="sc-sub">need attention</div></div><div className="stat-card" style={{cursor:'pointer'}} onClick={()=>setPage('incidents')}><div className="sc-top"><span className="sc-label">My Incidents</span><div className="sc-icon" style={{background:myIncidents>0?'rgba(245,158,11,.1)':'rgba(107,114,128,.1)',color:myIncidents>0?'#F59E0B':'#6B7280'}}>🚨</div></div><div className="sc-val" style={{color:myIncidents>0?'#F59E0B':'#6B7280'}}>{myIncidents}</div><div className="sc-sub">assigned to me</div></div></>}'''
    src=src.replace(ca_open_requests_end, my_card, 1)
    print('OK edit4: My Incidents card added to supervisor block.')

open(APP,'w').write(src)
print('\nDONE. Run: npm run build')
