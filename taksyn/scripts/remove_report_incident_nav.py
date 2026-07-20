#!/usr/bin/env python3
# Remove the standalone "Report Incident" nav entry from super_admin, client_admin,
# manager, and supervisor. PRESERVE it on worker (the only role without an Incidents hub).
# The nav entry string is identical across all five role lines, so we operate
# per-line by unique role prefix and assert exactly-once removal on each of the 4
# targets, and assert the worker line is UNCHANGED.
#
# Abort-safe: verifies every precondition before writing; changes NOTHING on any mismatch.

import sys, re

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"
ENTRY = "['report_incident','Report Incident','alert'],"

# Role prefixes as they appear at the start of each nav line (after leading spaces).
TARGET_ROLES = ["super_admin:", "client_admin:", "manager:", "supervisor:"]
KEEP_ROLE = "worker:"

def find_line(lines, role_prefix):
    hits = [i for i, ln in enumerate(lines) if ln.lstrip().startswith(role_prefix)]
    return hits

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        text = f.read()
    lines = text.split("\n")

    # 1. Locate each role line uniquely.
    line_idx = {}
    for role in TARGET_ROLES + [KEEP_ROLE]:
        hits = find_line(lines, role)
        if len(hits) != 1:
            print(f"ABORT: role line '{role}' matched {len(hits)} times (expected 1). No changes written.")
            sys.exit(1)
        line_idx[role] = hits[0]

    # 2. Each of the 4 target lines must contain the entry exactly once.
    for role in TARGET_ROLES:
        i = line_idx[role]
        c = lines[i].count(ENTRY)
        if c != 1:
            print(f"ABORT: '{role}' line has {c} copies of the entry (expected 1). No changes written.")
            sys.exit(1)

    # 3. Worker line must contain it (we are preserving it) — sanity check.
    if lines[line_idx[KEEP_ROLE]].count(ENTRY) != 1:
        print("ABORT: worker line does not contain exactly one entry to preserve. No changes written.")
        sys.exit(1)

    # 4. Perform removal on the 4 target lines only.
    worker_before = lines[line_idx[KEEP_ROLE]]
    for role in TARGET_ROLES:
        i = line_idx[role]
        lines[i] = lines[i].replace(ENTRY, "", 1)

    # 5. Assert worker line untouched.
    if lines[line_idx[KEEP_ROLE]] != worker_before:
        print("ABORT: worker line changed unexpectedly. No changes written.")
        sys.exit(1)

    new_text = "\n".join(lines)

    # 6. Global sanity: exactly one report_incident nav entry should remain (worker's).
    remaining = new_text.count(ENTRY)
    if remaining != 1:
        print(f"ABORT: after removal, {remaining} nav entries remain (expected exactly 1 = worker). No changes written.")
        sys.exit(1)

    if new_text == text:
        print("ABORT: no change produced. No changes written.")
        sys.exit(1)

    with open(PATH, "w", encoding="utf-8") as f:
        f.write(new_text)

    print("OK: removed 'Report Incident' nav entry from super_admin, client_admin, manager, supervisor (4 lines); worker preserved.")

if __name__ == "__main__":
    main()
