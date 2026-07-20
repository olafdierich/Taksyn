#!/usr/bin/env python3
"""
Wires the Incident Register (client_admin):
  edit1 — insert IncidentRegisterView before IncidentsAdminView
  edit2 — add auto-open hook to the existing IncidentsAdminView (open incident from register)
  edit3 — add ['incident_register','Incident Register','chart'] to client_admin nav
  edit4 — add route, passing setPage
Abort-safe. Run from /workspaces/Taksyn/taksyn with IncidentRegisterView.jsx beside it.
"""
import sys, os, re
APP='src/App.jsx'; REG='IncidentRegisterView.jsx'
if not os.path.exists(APP): print(f'ABORT: {APP} not found.'); sys.exit(1)
if not os.path.exists(REG): print(f'ABORT: {REG} not found beside script.'); sys.exit(1)
reg=open(REG).read(); src=open(APP).read(); orig=src

# EDIT 1: insert register component just before the incident management block
marker='// ============ INCIDENT MANAGEMENT (client_admin) ============'
if 'function IncidentRegisterView(' in src:
    print('SKIP edit1: register already present.')
else:
    if src.count(marker)!=1:
        print(f'ABORT edit1: management marker x{src.count(marker)} (expect 1). No change.'); sys.exit(1)
    src=src.replace(marker, reg.rstrip()+'\n\n'+marker, 1); print('OK edit1: register component inserted.')

# EDIT 2: auto-open hook inside IncidentsAdminView (after its load() useEffect)
hook_anchor='  useEffect(()=>{ load() },[])'
if 'taksyn-open-incident' in src and 'find(i=>i.ref===ref)' in src:
    print('SKIP edit2: auto-open hook already present.')
else:
    # the admin view's load effect is the FIRST occurrence; the register also has useEffect(()=>{ load() },[])
    # so target specifically the one inside IncidentsAdminView by finding it AFTER the management marker.
    mi=src.find(marker)
    if mi==-1: print('ABORT edit2: management marker missing. No change.'); open(APP,'w').write(orig); sys.exit(1)
    rel=src.find(hook_anchor, mi)
    if rel==-1:
        print('ABORT edit2: load() effect not found in IncidentsAdminView. No change.'); open(APP,'w').write(orig); sys.exit(1)
    addition=hook_anchor+'''
  useEffect(()=>{
    if(!incidents.length) return
    let ref=null; try{ ref=sessionStorage.getItem('taksyn-open-incident') }catch(e){}
    if(ref){ try{ sessionStorage.removeItem('taksyn-open-incident') }catch(e){}
      const target=incidents.find(i=>i.ref===ref); if(target) openIncident(target) }
  },[incidents])'''
    src=src[:rel]+addition+src[rel+len(hook_anchor):]
    print('OK edit2: auto-open hook added to IncidentsAdminView.')

# EDIT 3: client_admin nav — add Incident Register right after the Incidents item
inc_item="['incidents','Incidents','alert']"
reg_item="['incident_register','Incident Register','chart']"
if "'incident_register'" in src:
    print('SKIP edit3: register nav already present.')
else:
    if src.count(inc_item) < 1:
        print(f'ABORT edit3: Incidents nav item not found. No change.'); open(APP,'w').write(orig); sys.exit(1)
    # client_admin is the ONLY role whose array has Incidents followed by (comma or ]] ) AND is client_admin.
    # Insert after the client_admin Incidents item specifically: it's the one preceded by 'Requests'.
    ca_pat=re.compile(r"(\['issue_reports','Requests','clipboard'\],\['incidents','Incidents','alert'\])")
    if not ca_pat.search(src):
        print('ABORT edit3: client_admin Incidents item not found in expected position. No change.'); open(APP,'w').write(orig); sys.exit(1)
    src=ca_pat.sub(lambda m: m.group(1)+","+reg_item, src, count=1)
    print('OK edit3: Incident Register nav added to client_admin.')

# EDIT 4: route (client_admin only), passing setPage
route_new="{page==='incident_register' && user.role==='client_admin' && <IncidentRegisterView user={user} setPage={setPage}/>}"
if "page==='incident_register'" in src:
    print('SKIP edit4: register route already present.')
else:
    m=re.search(r"^([ \t]*)\{page==='incidents' && \['client_admin','manager','supervisor'\]\.includes\(user\.role\) && <IncidentsAdminView user=\{user\}/>\}", src, re.M)
    if not m:
        print('ABORT edit4: incidents route not found. Reverting.'); open(APP,'w').write(orig); sys.exit(1)
    indent=m.group(1); anchor=m.group(0)
    src=src.replace(anchor, indent+route_new+'\n'+anchor, 1)
    print('OK edit4: register route inserted.')

open(APP,'w').write(src)
print('\nDONE. Run: npm run build')
