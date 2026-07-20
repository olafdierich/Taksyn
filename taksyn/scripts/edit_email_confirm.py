#!/usr/bin/env python3
# Adds a confirmation prompt before an email change is submitted.
#
# Why: the New Email field can be pre-filled by the browser's password manager
# (a saved credential for this domain), which is outside the app's control -
# autoComplete="off", type="text" and readOnly were all ignored by Chrome.
# Rather than fight the browser, confirm the destination with the user. This
# defends against a wrong address however it got there: autofill, typo, mis-tap.
#
# Deliberately uses window.confirm rather than a custom modal: no new state, no
# JSX, one inserted line. Blocking and plain-looking, but reliable everywhere.
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
        "                    const {error} = await supabase.auth.updateUser({email:newEmail.trim()})\n"
    )

    repl = (
        "                    if(!newEmail.trim()||newEmail===user.email) return\n"
        "                    // Confirm the destination before sending. The field can be pre-filled by the\n"
        "                    // browser's saved credentials, so show the user exactly where the link will go.\n"
        "                    if(!window.confirm('Send a confirmation link to '+newEmail.trim()+'?\\n\\nYour sign-in email changes to this address only after you click the link in that inbox. Until then, keep signing in with '+user.email+'.')) return\n"
        "                    const {error} = await supabase.auth.updateUser({email:newEmail.trim()})\n"
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
