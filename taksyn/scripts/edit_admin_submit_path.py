#!/usr/bin/env python3
# Abort-safe: adds a client_admin submit path for complaints/feedback.
#
# Op 1: ReportIssueView gains an `embedded` prop
# Op 2: page heading suppressed when embedded
# Op 3: "My Reported Issues" list suppressed when embedded
# Op 4: small-org identifiability note when an embedded user ticks anonymous
# Op 5: IssueReportsAdminView gains a showForm state
# Op 6: toggle + embedded form rendered above the admin queue
#
# Writes ONLY if every assertion holds. Nothing else is touched --
# the worker/supervisor/manager page is behaviourally identical.

import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

OPS = []

# --- Op 1: prop ------------------------------------------------------
OPS.append((
    "function ReportIssueView({ user }) {",
    "function ReportIssueView({ user, embedded }) {",
))

# --- Op 2: heading ---------------------------------------------------
PH_OLD = (
    '      <div className="ph"><div className="ph-title">Log a Complaint / Feedback</div>'
    '<div className="ph-sub">Raise a complaint, share feedback, or log a request that needs attention</div></div>\n'
)
PH_NEW = (
    '      {!embedded && <div className="ph"><div className="ph-title">Log a Complaint / Feedback</div>'
    '<div className="ph-sub">Raise a complaint, share feedback, or log a request that needs attention</div></div>}\n'
)
OPS.append((PH_OLD, PH_NEW))

# --- Op 3: personal list ---------------------------------------------
LIST_OLD = (
    '      {issues.length>0&&(\n'
    '        <div>\n'
    '          <div className="section-title">My Reported Issues</div>\n'
)
LIST_NEW = (
    '      {!embedded && issues.length>0&&(\n'
    '        <div>\n'
    '          <div className="section-title">My Reported Issues</div>\n'
)
OPS.append((LIST_OLD, LIST_NEW))

# --- Op 4: small-org note --------------------------------------------
NOTE_OLD = (
    '              Your name and identity will not be stored. This cannot be undone or traced back to you '
    '\u2014 an anonymous submission will not appear in your list below.\n'
    '            </span>\n'
    '          </label>\n'
    '        </div>\n'
)
NOTE_NEW = (
    '              Your name and identity will not be stored. This cannot be undone or traced back to you '
    '\u2014 an anonymous submission will not appear in your list below.\n'
    '            </span>\n'
    '          </label>\n'
    '          {embedded && anon && (\n'
    '            <div style={{marginTop:8,padding:\'9px 12px\',borderRadius:8,background:\'rgba(245,158,11,.1)\','
    'border:\'1px solid rgba(245,158,11,.3)\',fontSize:12,color:\'var(--t2)\',lineHeight:1.5}}>\n'
    '              Note: no identity is stored, but if your organisation has only one or two administrators, '
    'an anonymous submission may still be identifiable by elimination.\n'
    '            </div>\n'
    '          )}\n'
    '        </div>\n'
)
OPS.append((NOTE_OLD, NOTE_NEW))

# --- Op 5: admin state -----------------------------------------------
STATE_OLD = (
    "  const [customFrom, setCustomFrom] = useState('')\n"
    "  const [customTo, setCustomTo] = useState('')\n"
)
STATE_NEW = (
    "  const [customFrom, setCustomFrom] = useState('')\n"
    "  const [customTo, setCustomTo] = useState('')\n"
    "  const [showForm, setShowForm] = useState(false)\n"
)
OPS.append((STATE_OLD, STATE_NEW))

# --- Op 6: toggle ----------------------------------------------------
HUB_OLD = (
    '      <div className="ph"><div className="ph-title">Complaints & Feedback</div>'
    '<div className="ph-sub">Complaints, feedback and requests from your team</div></div>\n'
)
HUB_NEW = (
    '      <div className="ph"><div className="ph-title">Complaints & Feedback</div>'
    '<div className="ph-sub">Complaints, feedback and requests from your team</div></div>\n'
    '      <div style={{marginBottom:20}}>\n'
    '        <button className="btn btn-secondary" style={{fontSize:13}} onClick={()=>setShowForm(v=>!v)}>\n'
    "          {showForm ? '\u00d7 Close form' : '+ Submit a complaint or feedback'}\n"
    '        </button>\n'
    '        {showForm && <div style={{marginTop:16}}><ReportIssueView user={user} embedded/></div>}\n'
    '      </div>\n'
)
OPS.append((HUB_OLD, HUB_NEW))


def abort(msg):
    print("ABORT: " + msg)
    print("Nothing was written.")
    sys.exit(1)


with open(PATH, "r", encoding="utf-8") as f:
    s = f.read()

# assert every anchor is unique BEFORE changing anything
for i, (old, new) in enumerate(OPS, 1):
    n = s.count(old)
    if n != 1:
        abort("op %d anchor matched %d times, expected 1" % (i, n))

out = s
for old, new in OPS:
    out = out.replace(old, new, 1)

if out == s:
    abort("result identical to input")

with open(PATH, "w", encoding="utf-8") as f:
    f.write(out)

print("OK: applied %d edits" % len(OPS))
print("  1. ReportIssueView gains `embedded` prop")
print("  2. page heading suppressed when embedded")
print("  3. My Reported Issues suppressed when embedded")
print("  4. small-org anonymity note added")
print("  5. showForm state added to admin view")
print("  6. toggle + embedded form added above admin queue")
