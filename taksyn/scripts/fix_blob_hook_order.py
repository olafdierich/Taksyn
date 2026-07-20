#!/usr/bin/env python3
# Fix React #310: move the incidentBlob useState ABOVE the early returns.
# It was inserted at ~14374 (below `if(!user) return <AuthView...>`), so on the
# login render the hook never runs -> hook-count mismatch -> #310 white screen.
# Remove it from its wrong spot; re-insert immediately before the first early return.
# Abort-safe: both anchors asserted exactly once; writes only if both succeed.

import sys
PATH = '/workspaces/Taksyn/taksyn/src/App.jsx'

with open(PATH, 'r', encoding='utf-8') as f:
    src = f.read()
orig = src

# The misplaced declaration (exact text as inserted, with trailing newline).
misplaced = "  const [incidentBlob, setIncidentBlob] = useState('none') // 'none'|'ok'|'warn' -> green/orange/red\n"

# The first early-return line (unique anchor) we insert ABOVE.
ret_anchor = "  if(needsPasswordSetup) return <PasswordSetupView onDone={()=>setNeedsPasswordSetup(false)}/>\n"

# --- verify anchors ---
if src.count(misplaced) != 1:
    print(f"ABORT: misplaced useState found {src.count(misplaced)} times (need 1). No changes.")
    sys.exit(1)
if src.count(ret_anchor) != 1:
    print(f"ABORT: early-return anchor found {src.count(ret_anchor)} times (need 1). No changes.")
    sys.exit(1)

# --- sanity: misplaced must currently come AFTER the return (that's the bug) ---
if src.index(misplaced) < src.index(ret_anchor):
    print("ABORT: useState already appears before the early return — nothing to fix. No changes.")
    sys.exit(1)

# 1) remove from wrong location
src = src.replace(misplaced, "", 1)
# 2) insert above the first early return
src = src.replace(ret_anchor, misplaced + ret_anchor, 1)

if src == orig:
    print("ABORT: no change produced.")
    sys.exit(1)

# --- post-check: now it must be BEFORE the return ---
if src.index(misplaced) > src.index(ret_anchor):
    print("ABORT: relocation did not place it before the return. No changes written.")
    sys.exit(1)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(src)
print("OK - moved incidentBlob useState above the early returns (fixes #310)")
