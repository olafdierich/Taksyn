#!/usr/bin/env python3
# Abort-safe: gates the Open Requests count + card to client_admin only.
# Op 1: count fetch effect  isCA||isMgr||isSup  ->  isCA
# Op 2: card in the (isCA||isMgr) block -> wrapped in {isCA&& ... }
# Op 3: card in the isSup block -> removed
# Writes ONLY if every assertion holds.

import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

GATE_OLD = "if (!(isCA||isMgr||isSup) || !isConfigured() || !user?.org) return"
GATE_NEW = "if (!isCA || !isConfigured() || !user?.org) return"

CARD = (
    "<div className=\"stat-card\" style={{cursor:'pointer'}} "
    "onClick={()=>setPage('issue_reports')}><div className=\"sc-top\">"
    "<span className=\"sc-label\">Open Requests</span>"
    "<div className=\"sc-icon\" style={{background:openIssuesCount>0?"
    "'rgba(239,68,68,.1)':'rgba(107,114,128,.1)',color:openIssuesCount>0?"
    "'#EF4444':'#6B7280'}}>\u26a0\ufe0f</div></div>"
    "<div className=\"sc-val\" style={{color:openIssuesCount>0?"
    "'#EF4444':'#6B7280'}}>{openIssuesCount}</div>"
    "<div className=\"sc-sub\">need attention</div></div>"
)

def abort(msg):
    print("ABORT: " + msg)
    print("Nothing was written.")
    sys.exit(1)

with open(PATH, "r", encoding="utf-8") as f:
    s = f.read()

# --- assertions -------------------------------------------------------
if s.count(GATE_OLD) != 1:
    abort("gate anchor matched %d times, expected 1" % s.count(GATE_OLD))

n_cards = s.count(CARD)
if n_cards != 2:
    abort("Open Requests card matched %d times, expected 2" % n_cards)

i1 = s.find(CARD)
i2 = s.find(CARD, i1 + len(CARD))
if i1 == -1 or i2 == -1:
    abort("could not locate both card occurrences")

# sanity: first occurrence must sit in the isCA||isMgr block,
# second in the isSup block. Check the nearest preceding role gate.
before1 = s[:i1]
before2 = s[i1 + len(CARD):i2]
if "{(isCA||isMgr)&&" not in before1[-4000:]:
    abort("first card is not inside the (isCA||isMgr) block")
if "{isSup&&" not in before2:
    abort("second card is not inside the isSup block")

# --- build ------------------------------------------------------------
out = (
    s[:i1]
    + "{isCA&&" + CARD + "}"
    + s[i1 + len(CARD):i2]
    + s[i2 + len(CARD):]
)
out = out.replace(GATE_OLD, GATE_NEW, 1)

if out == s:
    abort("result identical to input")

with open(PATH, "w", encoding="utf-8") as f:
    f.write(out)

print("OK: applied 3 edits")
print("  1. count effect gated to isCA")
print("  2. manager/admin card wrapped in {isCA&& ...}")
print("  3. supervisor card removed")
