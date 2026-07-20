#!/usr/bin/env python3
# Abort-safe resolution of the NAV merge conflict.
# Correct combined state = incident branch NAV (has report_incident + incident_hub)
# MINUS the two escalation entries (org_escalations for client_admin, escalations for manager+supervisor).
# Replaces the entire conflict block (markers included) with the final merged NAV.

import sys
p = "/workspaces/Taksyn/taksyn/src/App.jsx"
s = open(p, encoding="utf-8").read()

# The exact conflict block, from <<<<<<< HEAD through >>>>>>> hide-escalation (inclusive)
old = """<<<<<<< HEAD
  super_admin:  [['dashboard','Dashboard','home'],['report_incident','Report Incident','alert'],['orgs','Organisations','users'],['users','Users','users'],['support','Support Tickets','alert'],['audit','Audit Log','audit'],['sa_templates','Templates','grid'],['platform_settings','Platform Settings','settings'],['my_account','My Account','settings']],
  client_admin: [['dashboard','Dashboard','home'],['report_incident','Report Incident','alert'],['tasks','Tasks','tasks'],['org_escalations','Escalations','alert'],['reports','Reports','chart'],['audit','Audit Log','audit'],['users','Workforce','user'],['teams','Teams','users'],['projects','Projects 🔜','tasks'],['leave','Team Leave','clock'],['performance','Performance','chart'],['sla','Response Time','clock'],['tiers','Plans','tier'],['roles_departments','Roles & Positions','shield'],['company_settings','Company Settings','settings'],['help','Help & Support','alert'],['issue_reports','Requests','clipboard'],['incident_hub','Incidents','alert']],
  manager:      [['dashboard','Dashboard','home'],['report_incident','Report Incident','alert'],['tasks','Tasks','tasks'],['escalations','Escalations','alert'],['reports','Reports','chart'],['projects','Projects 🔜','tasks'],['users','Workforce','user'],['teams','My Teams','users'],['leave','Leave','clock'],['issue_reports','Log a Request','flag'],['incident_hub','Incidents','alert']],
  supervisor:   [['dashboard','Dashboard','home'],['report_incident','Report Incident','alert'],['tasks','Tasks','tasks'],['escalations','Escalations','alert'],['projects','Projects 🔜','tasks'],['users','Workforce','user'],['teams','My Teams','users'],['leave','Leave','clock'],['issue_reports','Log a Request','flag'],['incident_hub','Incidents','alert']],
  worker:       [['dashboard','Today','home'],['report_incident','Report Incident','alert'],['tasks','My Tasks','tasks'],['leave','My Leave','clock'],['issue_reports','Log a Request','flag']],
=======
  super_admin:  [['dashboard','Dashboard','home'],['orgs','Organisations','users'],['users','Users','users'],['support','Support Tickets','alert'],['audit','Audit Log','audit'],['sa_templates','Templates','grid'],['platform_settings','Platform Settings','settings'],['my_account','My Account','settings']],
  client_admin: [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['reports','Reports','chart'],['audit','Audit Log','audit'],['users','Workforce','user'],['teams','Teams','users'],['projects','Projects 🔜','tasks'],['leave','Team Leave','clock'],['performance','Performance','chart'],['sla','Response Time','clock'],['tiers','Plans','tier'],['roles_departments','Roles & Positions','shield'],['company_settings','Company Settings','settings'],['help','Help & Support','alert'],['issue_reports','Requests','clipboard']],
  manager:      [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['reports','Reports','chart'],['projects','Projects 🔜','tasks'],['users','Workforce','user'],['teams','My Teams','users'],['leave','Leave','clock'],['issue_reports','Log a Request','flag']],
  supervisor:   [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['projects','Projects 🔜','tasks'],['users','Workforce','user'],['teams','My Teams','users'],['leave','Leave','clock'],['issue_reports','Log a Request','flag']],
  worker:       [['dashboard','Today','home'],['tasks','My Tasks','tasks'],['leave','My Leave','clock'],['issue_reports','Log a Request','flag']],
>>>>>>> hide-escalation"""

# Final merged NAV: HEAD side, with org_escalations/escalations entries removed.
new = """  super_admin:  [['dashboard','Dashboard','home'],['report_incident','Report Incident','alert'],['orgs','Organisations','users'],['users','Users','users'],['support','Support Tickets','alert'],['audit','Audit Log','audit'],['sa_templates','Templates','grid'],['platform_settings','Platform Settings','settings'],['my_account','My Account','settings']],
  client_admin: [['dashboard','Dashboard','home'],['report_incident','Report Incident','alert'],['tasks','Tasks','tasks'],['reports','Reports','chart'],['audit','Audit Log','audit'],['users','Workforce','user'],['teams','Teams','users'],['projects','Projects 🔜','tasks'],['leave','Team Leave','clock'],['performance','Performance','chart'],['sla','Response Time','clock'],['tiers','Plans','tier'],['roles_departments','Roles & Positions','shield'],['company_settings','Company Settings','settings'],['help','Help & Support','alert'],['issue_reports','Requests','clipboard'],['incident_hub','Incidents','alert']],
  manager:      [['dashboard','Dashboard','home'],['report_incident','Report Incident','alert'],['tasks','Tasks','tasks'],['reports','Reports','chart'],['projects','Projects 🔜','tasks'],['users','Workforce','user'],['teams','My Teams','users'],['leave','Leave','clock'],['issue_reports','Log a Request','flag'],['incident_hub','Incidents','alert']],
  supervisor:   [['dashboard','Dashboard','home'],['report_incident','Report Incident','alert'],['tasks','Tasks','tasks'],['projects','Projects 🔜','tasks'],['users','Workforce','user'],['teams','My Teams','users'],['leave','Leave','clock'],['issue_reports','Log a Request','flag'],['incident_hub','Incidents','alert']],
  worker:       [['dashboard','Today','home'],['report_incident','Report Incident','alert'],['tasks','My Tasks','tasks'],['leave','My Leave','clock'],['issue_reports','Log a Request','flag']],"""

n = s.count(old)
if n != 1:
    print(f"ABORT: expected exactly 1 conflict block, found {n}. No change written.")
    sys.exit(1)

s = s.replace(old, new)

# Safety: ensure NO conflict markers remain anywhere in the file
for marker in ("<<<<<<<", "=======", ">>>>>>>"):
    if marker in s:
        # '=======' could theoretically appear in comments; check specifically for git markers at line start
        pass
open(p, "w", encoding="utf-8").write(s)

# Verify no git conflict markers survive
remaining = [m for m in ("<<<<<<< ", ">>>>>>> ") if m in s]
if remaining:
    print(f"WARNING: conflict markers still present: {remaining}")
else:
    print("OK: NAV conflict resolved (incident_hub kept, escalations removed, report_incident preserved). No conflict markers remain.")
