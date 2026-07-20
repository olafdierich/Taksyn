#!/usr/bin/env python3
"""
Column-scope the exportCSV tasks fetch (App.jsx ~8539).

Replaces select('*') with an explicit column list identical to the `cols`
array used two lines below to build the CSV. Output is unchanged by
construction; the heavy subtasks / evidence / comments blobs are no longer
transferred.

ABORT-SAFE: matches an exact multi-line anchor, asserts exactly one match,
and writes NOTHING on any mismatch.
"""

import sys

PATH = "src/App.jsx"

COLS = ("id,title,status,priority,category,department,assigned_user_name,"
        "assigned_role,due_date,created_at,submitted_at,completed_at,"
        "gps_start,gps_end,compliance")

OLD = (
    "      const { data } = await supabase.from('tasks').select('*').eq('org', user.org)\n"
    "      if (!data?.length) { alert('No tasks to export'); setExporting(false); return }\n"
)

NEW = (
    "      const { data } = await supabase.from('tasks')\n"
    "        .select('" + COLS + "')\n"
    "        .eq('org', user.org)\n"
    "      if (!data?.length) { alert('No tasks to export'); setExporting(false); return }\n"
)


def main():
    try:
        with open(PATH, "r", encoding="utf-8") as f:
            src = f.read()
    except OSError as e:
        print("ABORT: cannot read %s (%s)" % (PATH, e))
        return 1

    if NEW in src:
        print("ABORT: edit already applied — nothing to do.")
        return 1

    n = src.count(OLD)
    if n != 1:
        print("ABORT: anchor matched %d times (expected exactly 1). "
              "No changes written." % n)
        return 1

    src = src.replace(OLD, NEW, 1)

    with open(PATH, "w", encoding="utf-8") as f:
        f.write(src)

    print("OK: applied 1 edit — exportCSV now column-scoped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
