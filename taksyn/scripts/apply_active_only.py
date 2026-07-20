#!/usr/bin/env python3
# Abort-safe: make the incident admin list "Active incidents" (open-only) + rename hub tile.
# 1. Hub tile: "Review incidents" -> "Active incidents" (+ subtitle).
# 2. Admin list: remove 'closed' and 'all' status pills (closed lives in Register only).
# 3. Admin list header: "Incidents" -> "Active Incidents" with matching sub.
# Matches exact anchors, asserts count==1 each, writes only if all match. Else ABORT.

import sys
p = "/workspaces/Taksyn/taksyn/src/App.jsx"
s = open(p, encoding="utf-8").read()
edits = []

# --- 1. Hub tile rename + subtitle (in IncidentHubView we added) ---
tile_old = ('''        {canReview && <Tile icon="📋" title="Review incidents"
          sub={isCA?'View, assign, investigate and close incidents across the organisation.':'View and progress the incidents assigned to you.'}
          onClick={()=>setPage('incidents')}/>}''')
tile_new = ('''        {canReview && <Tile icon="📋" title="Active incidents"
          sub={isCA?'Open incidents currently being handled — assign, investigate and close them. Closed ones move to the register.':'The open incidents assigned to you.'}
          onClick={()=>setPage('incidents')}/>}''')
edits.append(("hub tile rename", tile_old, tile_new))

# --- 2. Trim status pills: drop 'closed' and 'all' ---
pills_old = "{[['open','Open'],['reported','Reported'],['investigating','Investigating'],['review','Review'],['closed','Closed'],['all','All']].map(([v,l])=>("
pills_new = "{[['open','Open'],['reported','Reported'],['investigating','Investigating'],['review','Review']].map(([v,l])=>("
edits.append(("trim status pills", pills_old, pills_new))

# --- 3. Admin list header rename ---
hdr_old = '<div className="ph"><div className="ph-title">Incidents</div><div className="ph-sub">Reported incidents and their resolution</div></div>'
hdr_new = '<div className="ph"><div className="ph-title">Active Incidents</div><div className="ph-sub">Open incidents currently being handled. Closed incidents are in the Register.</div></div>'
edits.append(("admin list header", hdr_old, hdr_new))

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
print("OK: all 3 edits applied (tile rename, pill trim, header).")
