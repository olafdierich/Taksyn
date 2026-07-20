#!/usr/bin/env python3
# Taksyn — fix worker task visibility, part 2
# The "unassigned open worker task" clause ignored assigned_user_ids, so a task
# assigned via the plural array (team/template creation) looked unassigned and
# was shown to EVERY worker in the org. Require the array to be empty too.
# Abort-safe: asserts the anchor appears exactly once; writes nothing otherwise.

import sys, io

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

OLD = """      (!t.assigned_user_id&&!t.assigned_user_name&&t.assigned_role==='worker') ||
      (t.team_id && userTeamIds.includes(t.team_id) && !t.assigned_user_id"""

NEW = """      (!t.assigned_user_id&&!t.assigned_user_name&&!(t.assigned_user_ids&&t.assigned_user_ids.length)&&t.assigned_role==='worker') ||
      (t.team_id && userTeamIds.includes(t.team_id) && !t.assigned_user_id"""

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

print("OK: applied 1 edit (open-pool clause now respects assigned_user_ids).")
