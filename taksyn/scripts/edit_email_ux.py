#!/usr/bin/env python3
# Follow-up to the email-change fix:
#   1. autoComplete="off" on the New Email input  -> stops browser autofill dropping a
#      saved address in, which could send a confirmation link somewhere unintended.
#   2. Render profileMsg again directly under the Update Email button -> the existing
#      slot is ~45 lines higher in a long modal, so the confirmation was off-screen.
#   3. Colour the message by content (red for '✗', green otherwise) -> the box was
#      hardcoded green even for errors.
#
# Each anchor must match EXACTLY ONCE. Writes nothing on mismatch.
import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        src = f.read()
    orig = src
    edits = []

    # ---- Edit 1: existing message slot -> colour by content ----
    a1 = ("                {profileMsg&&<div style={{background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.2)',"
          "borderRadius:6,padding:'8px 12px',fontSize:13,color:'var(--green)',marginBottom:14}}>{profileMsg}</div>}\n")
    r1 = ("                {profileMsg&&<div style={{background:profileMsg.startsWith('\u2717')?'rgba(239,68,68,.08)':'rgba(16,185,129,.08)',"
          "border:'1px solid '+(profileMsg.startsWith('\u2717')?'rgba(239,68,68,.25)':'rgba(16,185,129,.2)'),"
          "borderRadius:6,padding:'8px 12px',fontSize:13,color:profileMsg.startsWith('\u2717')?'#DC2626':'var(--green)',"
          "marginBottom:14}}>{profileMsg}</div>}\n")
    edits.append(("msg_colour", a1, r1))

    # ---- Edit 2: autoComplete off on the New Email input ----
    a2 = ('                  <div className="form-field"><label className="form-label">New Email Address</label>'
          '<input className="form-input" type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} '
          'placeholder={user.email}/></div>\n')
    r2 = ('                  <div className="form-field"><label className="form-label">New Email Address</label>'
          '<input className="form-input" type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} '
          'placeholder={user.email} autoComplete="off" name="taksyn-new-email" spellCheck={false}/></div>\n')
    edits.append(("autocomplete_off", a2, r2))

    # ---- Edit 3: second message slot directly under the Update Email button ----
    # Anchor: the closing of the Update Email button + its wrapper div.
    a3 = ("                  }}>Update Email</button>\n"
          "                </div>\n")
    r3 = ("                  }}>Update Email</button>\n"
          "                  {profileMsg&&<div style={{background:profileMsg.startsWith('\u2717')?'rgba(239,68,68,.08)':'rgba(16,185,129,.08)',"
          "border:'1px solid '+(profileMsg.startsWith('\u2717')?'rgba(239,68,68,.25)':'rgba(16,185,129,.2)'),"
          "borderRadius:6,padding:'8px 12px',fontSize:13,color:profileMsg.startsWith('\u2717')?'#DC2626':'var(--green)',"
          "marginBottom:14,lineHeight:1.5}}>{profileMsg}</div>}\n"
          "                </div>\n")
    edits.append(("msg_near_button", a3, r3))

    for name, anchor, _ in edits:
        c = src.count(anchor)
        if c != 1:
            print(f"ABORT: anchor '{name}' matched {c} times (expected 1). No changes written.")
            sys.exit(1)

    for name, anchor, repl in edits:
        src = src.replace(anchor, repl, 1)

    if src == orig:
        print("ABORT: no net change. No file written.")
        sys.exit(1)

    with open(PATH, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"OK: applied {len(edits)} edits to {PATH}")

if __name__ == "__main__":
    main()
