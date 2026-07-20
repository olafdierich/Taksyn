#!/usr/bin/env python3
# Abort-safe: HIDE (not delete) the task-escalation pathway (path 2).
# 1. Remove 'Escalations' nav item from client_admin, manager, supervisor.
# 2. Remove the "Escalate" trigger button in the task detail.
# Keeps: escalations table, modal, submitEscalation handler, audit wiring, dashboard overdue.
# Matches exact anchors, asserts count==1 each, writes only if ALL match. Else ABORT, no change.

import sys
p = "/workspaces/Taksyn/taksyn/src/App.jsx"
s = open(p, encoding="utf-8").read()
edits = []

# --- 1. client_admin nav: drop org_escalations ---
ca_old = "['tasks','Tasks','tasks'],['org_escalations','Escalations','alert'],['reports','Reports','chart'],['audit','Audit Log','audit']"
ca_new = "['tasks','Tasks','tasks'],['reports','Reports','chart'],['audit','Audit Log','audit']"
edits.append(("nav client_admin", ca_old, ca_new))

# --- 2. manager nav: drop escalations (uniqueness via 'reports' tail that follows) ---
mgr_old = "['tasks','Tasks','tasks'],['escalations','Escalations','alert'],['reports','Reports','chart'],['projects','Projects 🔜','tasks'],['users','Workforce','user'],['teams','My Teams','users'],['leave','Leave','clock'],['issue_reports','Log a Request','flag']],\n  supervisor:"
mgr_new = "['tasks','Tasks','tasks'],['reports','Reports','chart'],['projects','Projects 🔜','tasks'],['users','Workforce','user'],['teams','My Teams','users'],['leave','Leave','clock'],['issue_reports','Log a Request','flag']],\n  supervisor:"
edits.append(("nav manager", mgr_old, mgr_new))

# --- 3. supervisor nav: drop escalations (uniqueness via 'projects' tail, no reports) ---
sup_old = "['tasks','Tasks','tasks'],['escalations','Escalations','alert'],['projects','Projects 🔜','tasks'],['users','Workforce','user'],['teams','My Teams','users'],['leave','Leave','clock'],['issue_reports','Log a Request','flag']],\n  worker:"
sup_new = "['tasks','Tasks','tasks'],['projects','Projects 🔜','tasks'],['users','Workforce','user'],['teams','My Teams','users'],['leave','Leave','clock'],['issue_reports','Log a Request','flag']],\n  worker:"
edits.append(("nav supervisor", sup_old, sup_new))

# --- 4. Escalate trigger button (leave modal + handler intact) ---
btn_old = '''              <button className="btn btn-amber" onClick={()=>{setShowEscalate(sel.id);setEscalateReason('')}}>⚠️ Escalate</button>'''
btn_new = '''              {/* Escalate button hidden (path 2): pathway retained in code, not user-reachable */}'''
edits.append(("escalate button", btn_old, btn_new))

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
print("OK: all 4 edits applied (nav x3, escalate button hidden).")
