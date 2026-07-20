#!/usr/bin/env python3
# Taksyn — client_admin complaint/feedback notification fix
#   1. ROLES_ABOVE gains a client_admin key -> notifies peer client_admins
#   2. Anonymous client_admin submissions notify NOBODY (option B)
#   3. Submitter excluded from their own notification email
# Abort-safe: asserts exactly one match per op, writes nothing on mismatch.

import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

OPS = []

# ---- Op 1: add client_admin key to ROLES_ABOVE -----------------------------
OPS.append((
    "ROLES_ABOVE constant",
"""const ROLES_ABOVE = {
  worker:     ['supervisor','manager','client_admin'],
  supervisor: ['manager','client_admin'],
  manager:    ['client_admin'],
}""",
"""const ROLES_ABOVE = {
  worker:      ['supervisor','manager','client_admin'],
  supervisor:  ['manager','client_admin'],
  manager:     ['client_admin'],
  client_admin:['client_admin'],
}"""
))

# ---- Op 2: anon guard, self-exclusion, select id ---------------------------
OPS.append((
    "notify block",
"""      const notifyRoles = ROLES_ABOVE[user.role]||[]
      if(notifyRoles.length && user.org) {
        supabase.from('profiles').select('email,name,role').eq('org',user.org)
          .then(({data})=>{
            if(!data) return
            data.filter(p=>notifyRoles.includes(p.role)&&p.email).forEach(p=>{""",
"""      // client_admin peers are notified for NAMED submissions only. An anonymous
      // admin submission notifies nobody: in a small admin team an immediate email
      // identifies the submitter by elimination. The Open Requests card still counts it.
      const notifyRoles = (anon && user.role==='client_admin') ? [] : (ROLES_ABOVE[user.role]||[])
      if(notifyRoles.length && user.org) {
        supabase.from('profiles').select('id,email,name,role').eq('org',user.org)
          .then(({data})=>{
            if(!data) return
            data.filter(p=>notifyRoles.includes(p.role)&&p.email&&p.id!==user.id).forEach(p=>{"""
))

try:
    src = open(PATH, encoding="utf-8").read()
except OSError as e:
    print("ABORT: cannot read file:", e); sys.exit(1)

out = src
for label, old, new in OPS:
    n = out.count(old)
    if n != 1:
        print(f"ABORT: '{label}' matched {n} times (expected 1). Nothing written.")
        sys.exit(1)
    out = out.replace(old, new, 1)

if out == src:
    print("ABORT: no change produced. Nothing written."); sys.exit(1)

open(PATH, "w", encoding="utf-8").write(out)
print(f"OK: applied {len(OPS)} edits")
