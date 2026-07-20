#!/usr/bin/env python3
"""
Wires IncidentsAdminView into App.jsx. Abort-safe: each edit verifies its
anchor matches exactly once and isn't already applied; on mismatch, NOTHING changes.
Run from /workspaces/Taksyn/taksyn, with IncidentsAdminView.jsx beside it.
"""
import sys, os, re
APP='src/App.jsx'; COMP='IncidentsAdminView.jsx'
if not os.path.exists(APP): print(f'ABORT: {APP} not found.'); sys.exit(1)
if not os.path.exists(COMP): print(f'ABORT: {COMP} not found beside script.'); sys.exit(1)
component=open(COMP).read(); src=open(APP).read(); orig=src

# EDIT 1: insert component before IncidentsAdminView's natural neighbour, IssueReportsAdminView
A1='function IssueReportsAdminView({ user }) {'
if 'function IncidentsAdminView(' in src:
    print('SKIP edit1: IncidentsAdminView already present.')
else:
    if src.count(A1)!=1: print(f'ABORT edit1: anchor x{src.count(A1)} (expect 1). No change.'); sys.exit(1)
    src=src.replace(A1, component+'\n'+A1, 1); print('OK edit1: component inserted.')

# EDIT 2: client_admin nav — add ['incidents','Incidents','alert'] right after the Requests item
ITEM="['incidents','Incidents','alert'],"
if "'incidents','Incidents'" in src:
    print('SKIP edit2: nav item already present.')
else:
    # The client_admin nav is the ONLY role whose array contains the Requests item
    # labelled 'Requests' (managers/supervisors use 'Log a Request'). Insert our item
    # immediately after that exact token, which appears once.
    base="['issue_reports','Requests','clipboard']"
    if src.count(base)!=1:
        print(f'ABORT edit2: Requests nav item x{src.count(base)} (expect 1). No change.'); open(APP,'w').write(orig); sys.exit(1)
    src=src.replace(base, base+",['incidents','Incidents','alert']", 1); print('OK edit2: nav item added to client_admin.')

# EDIT 3: route — client_admin only, beside the issue_reports admin route
if "page==='incidents'" in src:
    print('SKIP edit3: route already present.')
else:
    m=re.search(r"^([ \t]*)\{page==='issue_reports' && user\.role==='client_admin' && <IssueReportsAdminView user=\{user\}/>\}", src, re.M)
    if not m:
        print('ABORT edit3: issue_reports admin route not found. Reverting.'); open(APP,'w').write(orig); sys.exit(1)
    indent=m.group(1); anchor=m.group(0)
    if src.count(anchor)!=1:
        print(f'ABORT edit3: route anchor x{src.count(anchor)} (expect 1). Reverting.'); open(APP,'w').write(orig); sys.exit(1)
    newline=indent+"{page==='incidents' && user.role==='client_admin' && <IncidentsAdminView user={user}/>}"
    src=src.replace(anchor, newline+'\n'+anchor, 1); print('OK edit3: route inserted.')

open(APP,'w').write(src)
print('\nDONE. Run: npm run build')
