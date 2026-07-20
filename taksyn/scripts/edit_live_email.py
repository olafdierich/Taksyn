#!/usr/bin/env python3
# Fixes the email-change dialog/message quoting a STALE sign-in address.
#
# The problem: user.email comes from session.user.email, which is read from the
# cached access token. After an email change is confirmed, that token still
# carries the OLD address until the next full sign-in. So the reassurance text
# ("keep signing in with X") named an address that no longer works - actively
# wrong guidance at exactly the moment the user needs it to be right.
#
# The fix: call supabase.auth.getUser() at click time. That is a server
# round-trip returning the live identity. One extra network call, only when the
# user clicks Update Email, only on the screen where being wrong matters.
# Falls back to user.email if the call fails, so behaviour never gets worse.
#
# Anchor must match EXACTLY ONCE. Writes nothing on mismatch.
import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        src = f.read()
    orig = src

    anchor = (
        "                    if(!newEmail.trim()||newEmail===user.email) return\n"
        "                    // Confirm the destination before sending. The field can be pre-filled by the\n"
        "                    // browser's saved credentials, so show the user exactly where the link will go.\n"
        "                    if(!window.confirm('Send a confirmation link to '+newEmail.trim()+'?\\n\\nYour sign-in email changes to this address only after you click the link in that inbox. Until then, keep signing in with '+user.email+'.')) return\n"
        "                    const {error} = await supabase.auth.updateUser({email:newEmail.trim()})\n"
        "                    if(error) { setProfileMsg('\u2717 '+error.message); return }\n"
    )

    repl = (
        "                    if(!newEmail.trim()||newEmail===user.email) return\n"
        "                    // user.email comes from the cached access token, which can be one change behind\n"
        "                    // after a confirmed email change. Ask the server for the live identity so we never\n"
        "                    // tell someone to sign in with an address that no longer works.\n"
        "                    let currentEmail = user.email\n"
        "                    try { const {data:_au} = await supabase.auth.getUser(); if(_au?.user?.email) currentEmail = _au.user.email } catch(_e) {}\n"
        "                    if(newEmail.trim()===currentEmail) { setProfileMsg('\u2717 That is already your sign-in email'); return }\n"
        "                    // Confirm the destination before sending. The field can be pre-filled by the\n"
        "                    // browser's saved credentials, so show the user exactly where the link will go.\n"
        "                    if(!window.confirm('Send a confirmation link to '+newEmail.trim()+'?\\n\\nYour sign-in email changes to this address only after you click the link in that inbox. Until then, keep signing in with '+currentEmail+'.')) return\n"
        "                    const {error} = await supabase.auth.updateUser({email:newEmail.trim()})\n"
        "                    if(error) { setProfileMsg('\u2717 '+error.message); return }\n"
    )

    c = src.count(anchor)
    if c != 1:
        print(f"ABORT: anchor matched {c} times (expected 1). No changes written.")
        sys.exit(1)

    src = src.replace(anchor, repl, 1)

    # Second op: the pending message must also quote the live address, not the cached one.
    a2 = ("                    setProfileMsg('\u2713 Confirmation sent to '+newEmail.trim()+' \u2014 click the link in that inbox to finish. Until you do, keep signing in with '+user.email)\n")
    r2 = ("                    setProfileMsg('\u2713 Confirmation sent to '+newEmail.trim()+' \u2014 click the link in that inbox to finish. Until you do, keep signing in with '+currentEmail)\n")
    c2 = src.count(a2)
    if c2 != 1:
        print(f"ABORT: anchor 'pending_msg' matched {c2} times (expected 1). No changes written.")
        sys.exit(1)
    src = src.replace(a2, r2, 1)

    if src == orig:
        print("ABORT: no net change. No file written.")
        sys.exit(1)

    with open(PATH, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"OK: applied 2 edits to {PATH}")

if __name__ == "__main__":
    main()
