#!/usr/bin/env python3
"""
Wires the Incidents view for manager + supervisor:
  edit1 — replace IncidentsAdminView.jsx body with the role-aware v2
  edit2 — add ['incidents','Incidents','alert'] to manager + supervisor nav
  edit3 — broaden the route guard to include manager/supervisor
Abort-safe: verifies each anchor; on mismatch, NOTHING changes.
Run from /workspaces/Taksyn/taksyn with IncidentsAdminView_v2.jsx beside it.
"""
import sys, os, re
APP='src/App.jsx'; V2='IncidentsAdminView_v2.jsx'
if not os.path.exists(APP): print(f'ABORT: {APP} not found.'); sys.exit(1)
if not os.path.exists(V2): print(f'ABORT: {V2} not found beside script.'); sys.exit(1)
v2=open(V2).read(); src=open(APP).read(); orig=src

# EDIT 1: swap the existing IncidentsAdminView definition for the role-aware v2.
# Find from "// ============ INCIDENT MANAGEMENT (client_admin) ============" through the end of the
# IncidentsAdminView function (just before "function IssueReportsAdminView").
start_marker='// ============ INCIDENT MANAGEMENT (client_admin) ============'
end_marker='function IssueReportsAdminView({ user }) {'
if 'const isAdmin = user.role === ' in src:
    print('SKIP edit1: role-aware version already present.')
else:
    si=src.find(start_marker); ei=src.find(end_marker)
    if si==-1 or ei==-1 or ei<si:
        print('ABORT edit1: could not locate existing IncidentsAdminView block. No change.'); sys.exit(1)
    src=src[:si] + v2.rstrip() + '\n\n' + src[ei:]
    print('OK edit1: swapped in role-aware IncidentsAdminView.')

# EDIT 2: add Incidents nav to manager + supervisor (after their 'Log a Request' item)
mgr_item="['issue_reports','Log a Request','flag']"
inc_item="['incidents','Incidents','alert']"
if src.count(inc_item) >= 3:
    print('SKIP edit2: manager/supervisor nav already has Incidents.')
else:
    # manager and supervisor each have the 'Log a Request' item; client_admin does NOT (it has 'Requests').
    # There should be exactly 3 occurrences of the mgr_item (manager, supervisor, worker).
    # We only want manager + supervisor, NOT worker. So we target by role line.
    changed=0
    for role in ['manager','supervisor']:
        pat=re.compile(r"(\n  "+role+r":\s*\[.*?\['issue_reports','Log a Request','flag'\])", re.S)
        m=pat.search(src)
        if not m:
            print(f'ABORT edit2: {role} nav not found. No change.'); open(APP,'w').write(orig); sys.exit(1)
        src=pat.sub(lambda mm: mm.group(1)+","+inc_item, src, count=1); changed+=1
    print(f'OK edit2: Incidents nav added to {changed} roles (manager, supervisor).')

# EDIT 3: broaden route guard from client_admin-only to include manager/supervisor
old_route="{page==='incidents' && user.role==='client_admin' && <IncidentsAdminView user={user}/>}"
new_route="{page==='incidents' && ['client_admin','manager','supervisor'].includes(user.role) && <IncidentsAdminView user={user}/>}"
if new_route in src:
    print('SKIP edit3: route already broadened.')
elif old_route in src:
    if src.count(old_route)!=1:
        print(f'ABORT edit3: route x{src.count(old_route)} (expect 1). Reverting.'); open(APP,'w').write(orig); sys.exit(1)
    src=src.replace(old_route, new_route, 1); print('OK edit3: route guard broadened to manager/supervisor.')
else:
    print('ABORT edit3: incidents route not found. Reverting.'); open(APP,'w').write(orig); sys.exit(1)

open(APP,'w').write(src)
print('\nDONE. Run: npm run build')
