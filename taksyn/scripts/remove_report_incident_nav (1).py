#!/usr/bin/env python3
# Remove the standalone "Report Incident" nav entry from super_admin, client_admin,
# manager, supervisor. PRESERVE it on worker. Robust against duplicate role-prefix
# lines elsewhere in the file: we ONLY consider lines that contain the nav entry
# itself, then decide per-line by which role that nav line belongs to.
#
# Abort-safe: verifies all preconditions before writing; changes NOTHING on mismatch.

import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"
ENTRY = "['report_incident','Report Incident','alert'],"
REMOVE_ROLES = ("super_admin:", "client_admin:", "manager:", "supervisor:")
KEEP_ROLE = "worker:"

def role_of(line):
    s = line.lstrip()
    for r in REMOVE_ROLES + (KEEP_ROLE,):
        if s.startswith(r):
            return r
    return None

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        text = f.read()
    lines = text.split("\n")

    # Candidate lines = those that actually contain the nav entry (unique to nav rows).
    entry_lines = [i for i, ln in enumerate(lines) if ENTRY in ln]
    if len(entry_lines) != 5:
        print(f"ABORT: expected 5 nav lines containing the entry, found {len(entry_lines)}. No changes written.")
        sys.exit(1)

    # Each such line must be identifiable to exactly one of the 5 known roles.
    roles_seen = {}
    for i in entry_lines:
        r = role_of(lines[i])
        if r is None:
            print(f"ABORT: nav line {i+1} has the entry but no recognised role prefix. No changes written.")
            sys.exit(1)
        roles_seen[r] = i

    if set(roles_seen.keys()) != set(REMOVE_ROLES + (KEEP_ROLE,)):
        print(f"ABORT: nav roles found {sorted(roles_seen)} != expected 5 roles. No changes written.")
        sys.exit(1)

    # Remove the entry from the 4 target roles only.
    worker_i = roles_seen[KEEP_ROLE]
    worker_before = lines[worker_i]
    for r in REMOVE_ROLES:
        i = roles_seen[r]
        lines[i] = lines[i].replace(ENTRY, "", 1)

    if lines[worker_i] != worker_before:
        print("ABORT: worker line changed unexpectedly. No changes written.")
        sys.exit(1)

    new_text = "\n".join(lines)
    remaining = new_text.count(ENTRY)
    if remaining != 1:
        print(f"ABORT: after removal {remaining} entries remain (expected 1 = worker). No changes written.")
        sys.exit(1)
    if new_text == text:
        print("ABORT: no change produced. No changes written.")
        sys.exit(1)

    with open(PATH, "w", encoding="utf-8") as f:
        f.write(new_text)
    print("OK: removed 'Report Incident' nav entry from super_admin, client_admin, manager, supervisor (4 lines); worker preserved.")

if __name__ == "__main__":
    main()
