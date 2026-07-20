#!/usr/bin/env python3
# Taksyn — fix worker task visibility (Option B)
# A team-stamped task is team-visible ONLY when nobody specific is assigned.
# Abort-safe: asserts the anchor appears exactly once; writes nothing otherwise.

import sys, io

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

OLD = """      (!t.assigned_user_id&&!t.assigned_user_name&&t.assigned_role==='worker') ||
      (t.team_id && userTeamIds.includes(t.team_id))
    )"""

NEW = """      (!t.assigned_user_id&&!t.assigned_user_name&&t.assigned_role==='worker') ||
      (t.team_id && userTeamIds.includes(t.team_id) && !t.assigned_user_id && !(t.assigned_user_ids&&t.assigned_user_ids.length) && !t.assigned_user_name)
    )"""

with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()

n = src.count(OLD)
if n != 1:
    print("ABORT: anchor matched %d times (expected 1). Nothing written." % n)
    sys.exit(1)

if NEW in src:
    print("ABORT: replacement already present. Nothing written.")
    sys.exit(1)

src = src.replace(OLD, NEW, 1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(src)

print("OK: applied 1 edit (worker team-visibility clause).")
