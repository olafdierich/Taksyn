#!/usr/bin/env python3
# ============================================================
# [CODESPACE]
# Derive LIVE variants of the bulk import migrations.
#
# Reads the five proven SANDBOX migrations and writes LIVE copies
# into migrations/live/.
#
# ONE change is made: the environment guard is INVERTED. The
# sandbox originals abort ABOVE 30 auth users to protect LIVE;
# these copies abort BELOW 30, so they cannot be run against
# sandbox and report a success that means nothing.
#
# Nothing else is altered. Every assertion, guard and comment is
# carried across unchanged, so a diff of each pair shows exactly
# two things: the added header and the flipped guard.
#
# An earlier draft also relaxed a foreign-key-count assertion,
# on the belief that stage 4 required exactly two FKs referencing
# org_people. Grep proved no such assertion exists in any of the
# five migrations; it lived in stage 3 v2, deleted when v3
# superseded it. The LIVE FK difference is real — incidents
# carries no foreign keys there, with zero orphaned values — but
# no migration tests for it, so no migration needs relaxing.
#
# Run from /workspaces/Taksyn/taksyn:
#   python3 scripts/derive_live_migrations.py
# ============================================================
import sys, os, re

SRC_DIR = 'migrations'
OUT_DIR = 'migrations/live'

FILES = [
    '2026-08-11-bulk-import-stage1.sql',
    '2026-08-11-bulk-import-stage2-function.sql',
    '2026-08-11-bulk-import-stage3-undo-v3.sql',
    '2026-08-11-bulk-import-stage4-client-admin.sql',
    '2026-08-11-bulk-import-stage5-date-format.sql',
]

SANDBOX_GUARD = """  if n > 30 then
    raise exception 'ABORT P1: % auth users looks like LIVE, not SANDBOX', n;
  end if;"""

LIVE_GUARD = """  -- INVERTED for LIVE. The sandbox originals abort ABOVE 30 to
  -- protect production; this copy aborts BELOW 30 so it cannot be
  -- run against sandbox and report success that means nothing.
  if n < 30 then
    raise exception 'ABORT P1: only % auth users — this looks like SANDBOX. This is the LIVE variant.', n;
  end if;"""

HEADER = """-- ============================================================
-- !! LIVE VARIANT — yylvtvbhddcepilzwpaw (Tokyo) !!
--
-- Derived from the proven SANDBOX migration by
-- scripts/derive_live_migrations.py. Do not edit by hand:
-- re-run the script so the difference stays auditable.
--
-- Differences from the sandbox original:
--   * environment guard inverted (aborts BELOW 30 auth users)
--
-- Nothing else differs. Verify with diff against the original.
-- ============================================================
"""


def main():
    if not os.path.isdir(SRC_DIR):
        print('ABORT: %s not found. Run from /workspaces/Taksyn/taksyn.' % SRC_DIR)
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)
    made = []

    for fn in FILES:
        src_path = os.path.join(SRC_DIR, fn)
        if not os.path.exists(src_path):
            print('ABORT: missing %s' % src_path)
            sys.exit(1)

        s = open(src_path, encoding='utf-8').read()

        n = s.count(SANDBOX_GUARD)
        if n != 1:
            print('ABORT: %s — guard matched %d times, expected 1. '
                  'The file has changed; re-derive the anchor.' % (fn, n))
            sys.exit(1)
        s = s.replace(SANDBOX_GUARD, LIVE_GUARD)

        out_name = fn.replace('.sql', '-LIVE.sql')
        out_path = os.path.join(OUT_DIR, out_name)
        open(out_path, 'w', encoding='utf-8').write(HEADER + s)
        made.append(out_name)
        print('wrote %s' % out_path)

    print('')
    print('Apply in this order:')
    for i, m in enumerate(made, 1):
        print('  %d. %s' % (i, m))
    print('')
    print('Each is transactional and idempotent. Stop at the first failure.')


if __name__ == '__main__':
    main()
