#!/usr/bin/env python3
"""
Applies all three IncidentReportView edits to App.jsx. Abort-safe:
each edit checks its anchor matches exactly once and that the edit
hasn't already been applied; on any mismatch it changes NOTHING.

Usage (from /workspaces/Taksyn/taksyn):
    python3 apply_incident_edits.py
Requires IncidentReportView.jsx to sit in the same folder.
"""
import sys, os, re

APP = 'src/App.jsx'
COMP_FILE = 'IncidentReportView.jsx'

if not os.path.exists(APP):
    print(f'ABORT: {APP} not found. Run from /workspaces/Taksyn/taksyn.'); sys.exit(1)
if not os.path.exists(COMP_FILE):
    print(f'ABORT: {COMP_FILE} not found beside this script.'); sys.exit(1)

component = open(COMP_FILE).read()
src = open(APP).read()
orig = src

# ---- EDIT 1: insert component before ReportIssueView ----
A1 = 'function ReportIssueView({ user }) {'
if 'function IncidentReportView(' in src:
    print('SKIP edit1: IncidentReportView already present.')
else:
    if src.count(A1) != 1:
        print(f'ABORT edit1: anchor found {src.count(A1)} times (expected 1). No change.'); sys.exit(1)
    src = src.replace(A1, component + '\n' + A1, 1)
    print('OK edit1: component inserted.')

# ---- EDIT 2: add nav item after each role's dashboard entry ----
ITEM = "['report_incident','Report Incident','alert'],"
if 'report_incident' in src and "'report_incident','Report Incident'" in src:
    print('SKIP edit2: nav item already present.')
else:
    roles = ['super_admin','client_admin','manager','supervisor','worker']
    ok = True
    for role in roles:
        pat = re.compile(r"(\n  " + role + r":\s*\[\['dashboard',[^\]]*\],)")
        if not pat.search(src):
            print(f'ABORT edit2: no dashboard item for role "{role}". No change to nav.'); ok = False; break
        src = pat.sub(lambda m: m.group(1) + ITEM, src, count=1)
    if ok:
        print('OK edit2: nav items added to 5 roles.')
    else:
        # revert everything to be safe
        src = orig; open(APP,'w').write(src)
        sys.exit(1)

# ---- EDIT 3: add route before the guide route (whitespace-tolerant) ----
if "page==='report_incident'" in src:
    print('SKIP edit3: route already present.')
else:
    # Find the guide route line by content, preserving its exact indentation.
    m = re.search(r"^([ \t]*)\{page==='guide' && <GettingStartedGuide user=\{user\} setPage=\{setPage\}/>\}", src, re.M)
    if not m:
        print('ABORT edit3: guide route line not found. Reverting all.')
        open(APP,'w').write(orig); sys.exit(1)
    indent = m.group(1)
    guide_line = m.group(0)
    if src.count(guide_line) != 1:
        print(f'ABORT edit3: guide route matched {src.count(guide_line)} times (expected 1). Reverting all.')
        open(APP,'w').write(orig); sys.exit(1)
    route_line = indent + "{page==='report_incident' && <IncidentReportView user={user}/>}"
    src = src.replace(guide_line, route_line + '\n' + guide_line, 1)
    print('OK edit3: route inserted.')

open(APP,'w').write(src)
print('\nDONE. All edits applied. Run: npm run build')
