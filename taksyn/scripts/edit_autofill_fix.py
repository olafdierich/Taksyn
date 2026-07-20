#!/usr/bin/env python3
# Stronger anti-autofill fix for the "New Email Address" input.
#
# Why: Chrome and Safari deliberately IGNORE autoComplete="off" on type="email"
# inputs (they treat credential-shaped fields as always-fillable). The reliable
# technique is:
#   - readOnly until the field is focused  -> the browser's autofill pass finds
#     nothing fillable on page load
#   - type="text" instead of type="email"  -> stops the field being recognised as
#     a credential field at all
#   - inputMode="email"                    -> keeps the @-key mobile keyboard
#
# Risk if left unfixed: an autofilled address the user does not notice, then a
# click on Update Email, sends a confirmation link to an unintended inbox.
#
# Anchor must match EXACTLY ONCE. Writes nothing on mismatch.
import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        src = f.read()
    orig = src

    anchor = ('                  <div className="form-field"><label className="form-label">New Email Address</label>'
              '<input className="form-input" type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} '
              'placeholder={user.email} autoComplete="off" name="taksyn-new-email" spellCheck={false}/></div>\n')

    repl = ('                  <div className="form-field"><label className="form-label">New Email Address</label>'
            '<input className="form-input" type="text" inputMode="email" value={newEmail} '
            'onChange={e=>setNewEmail(e.target.value)} placeholder={user.email} '
            'readOnly onFocus={e=>e.target.removeAttribute(\'readonly\')} '
            'autoComplete="off" name="taksyn-new-email" spellCheck={false} autoCorrect="off" autoCapitalize="none"/></div>\n')

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
