#!/usr/bin/env python3
# Places the profiles.email <- auth.email sync in the SESSION RESTORE path.
#
# Why: the earlier edit put the sync inside the USER_UPDATED branch of
# onAuthStateChange, which fires when a password is set (and when an email change
# is confirmed) but NOT on ordinary sign-in. So a stale profiles.email never
# self-corrected on login. The getSession() restore path runs on every page load
# with a persisted session, which is the right home for it.
#
# Placement detail: inserted BEFORE the `if (savedOrgName && savedRole) { ...; return }`
# early return, otherwise anyone with a saved org context would skip the sync.
#
# auth.users.email is the source of truth for sign-in; profiles.email is only a
# display mirror. This makes the mirror follow the truth.
#
# Anchor must match EXACTLY ONCE. Writes nothing on mismatch.
import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        src = f.read()
    orig = src

    anchor = (
        "            localStorage.setItem(TAKSYN_LAST_ACTIVITY_KEY, Date.now().toString())\n"
        "            const savedOrgName = sessionStorage.getItem('currentOrgName')\n"
        "            const savedRole = sessionStorage.getItem('currentRole')\n"
        "            if (savedOrgName && savedRole) { setUser({...data, email:session.user.email, org:savedOrgName, role:savedRole}); return }\n"
        "            setUser({...data, email:session.user.email})\n"
    )

    repl = (
        "            localStorage.setItem(TAKSYN_LAST_ACTIVITY_KEY, Date.now().toString())\n"
        "            // auth.users.email is the source of truth for sign-in; profiles.email is only a\n"
        "            // display mirror. Keep the mirror in step on every restored session. Must run\n"
        "            // BEFORE the saved-org early return below, or it would be skipped for most users.\n"
        "            if(isConfigured() && data.email!==session.user.email) supabase.from('profiles').update({email:session.user.email}).eq('id',session.user.id).then(()=>{})\n"
        "            const savedOrgName = sessionStorage.getItem('currentOrgName')\n"
        "            const savedRole = sessionStorage.getItem('currentRole')\n"
        "            if (savedOrgName && savedRole) { setUser({...data, email:session.user.email, org:savedOrgName, role:savedRole}); return }\n"
        "            setUser({...data, email:session.user.email})\n"
    )

    c = src.count(anchor)
    if c != 1:
        print(f"ABORT: anchor matched {c} times (expected 1). No changes written.")
        sys.exit(1)

    src = src.replace(anchor, repl, 1)
    if src == orig:
        print("ABORT: no net change. No file written.")
        sys.exit(1)

    with open(PATH, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"OK: applied 1 edit to {PATH}")

if __name__ == "__main__":
    main()
