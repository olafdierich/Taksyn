#!/usr/bin/env python3
# Abort-safe: fixes the send-notification 401.
#
# sendEmailNotif was the ONLY caller of an edge function that omitted the
# Authorization header. The function has "Verify JWT with legacy secret"
# ON, so an unauthenticated request is rejected with 401 before the
# function body runs. The other four call sites already use
# getEdgeFunctionAuthHeader(); this makes the fifth match.
#
# Also adds a non-2xx response check so a future failure is visible in the
# console instead of silent. Still fire-and-forget -- a failed email must
# never block a submission.

import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

OLD = (
    "    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL\n"
    "    await fetch(supabaseUrl+'/functions/v1/send-notification', {\n"
    "      method:'POST',\n"
    "      headers:{'Content-Type':'application/json'},\n"
    "      body: JSON.stringify({ to:toEmail, subject, body, secret:import.meta.env.VITE_INVITE_SECRET||'' })\n"
    "    })\n"
)

NEW = (
    "    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL\n"
    "    const res = await fetch(supabaseUrl+'/functions/v1/send-notification', {\n"
    "      method:'POST',\n"
    "      headers:{'Content-Type':'application/json','Authorization': await getEdgeFunctionAuthHeader()},\n"
    "      body: JSON.stringify({ to:toEmail, subject, body, secret:import.meta.env.VITE_INVITE_SECRET||'' })\n"
    "    })\n"
    "    if(!res.ok) console.log('Email notif failed:', res.status, await res.text().catch(()=>''))\n"
)


def abort(msg):
    print("ABORT: " + msg)
    print("Nothing was written.")
    sys.exit(1)


with open(PATH, "r", encoding="utf-8") as f:
    s = f.read()

n = s.count(OLD)
if n != 1:
    abort("anchor matched %d times, expected 1" % n)

# guard: the helper must be defined before we reference it
if "const getEdgeFunctionAuthHeader = async () =>" not in s:
    abort("getEdgeFunctionAuthHeader not found in file")

out = s.replace(OLD, NEW, 1)
if out == s:
    abort("result identical to input")

with open(PATH, "w", encoding="utf-8") as f:
    f.write(out)

print("OK: applied 1 edit")
print("  sendEmailNotif now sends Authorization + checks the response")
