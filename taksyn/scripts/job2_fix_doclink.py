#!/usr/bin/env python3
# Job 2 - edit 1 of N: fix the dead attachment link at ~3612.
# Adds module-scope EvidenceDocLink (mirrors EvidenceThumb's lazy-sign pattern)
# and routes the checklist attachment link through it.
# ABORT-SAFE: every anchor must match EXACTLY ONCE or nothing is written.

import io, sys

PATH = "src/App.jsx"

with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()

original = src
edits = 0

# ---------------------------------------------------------------
# Anchor 1: insert EvidenceDocLink immediately BEFORE EvidenceThumb
# ---------------------------------------------------------------
A1 = "function EvidenceThumb({ entry, className, containerStyle, imgStyle, onImgClick, title }) {"

NEW_COMPONENT = """// Renders one document attachment, supporting BOTH shapes:
//   - `url` (base64 / legacy / http) -> link directly (unchanged behaviour)
//   - `path` (private Storage object key) -> sign lazily via signedEvidenceUrl
// Mirrors EvidenceThumb's resolve pattern. Never renders a dead href.
function EvidenceDocLink({ entry }) {
  const direct = (entry && typeof entry === 'object') ? (entry.url || null) : entry
  const path = (entry && typeof entry === 'object') ? (entry.path || null) : null
  const [signed, setSigned] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    if (!direct && path) {
      setSigned(null); setFailed(false)
      signedEvidenceUrl(path).then(u => { if (alive) setSigned(u) }).catch(() => { if (alive) setFailed(true) })
    }
    return () => { alive = false }
  }, [direct, path])
  const href = direct || signed
  const name = (entry && typeof entry === 'object' && entry.name) || (path ? path.split('/').pop() : 'document')
  if (failed || (!direct && !path)) return <span style={{color:'var(--t3)'}}>\U0001F4CE {name} \u00B7 unavailable</span>
  if (!href) return <span style={{color:'var(--t3)'}}>\U0001F4CE {name} \u00B7 loading\u2026</span>
  return <a href={href} download={name} target="_blank" rel="noopener noreferrer" style={{color:'var(--blue)',textDecoration:'none'}}>\U0001F4CE {name}</a>
}
"""

n = src.count(A1)
if n != 1:
    print("ABORT: anchor 1 matched %d times (expected 1). Nothing written." % n)
    sys.exit(1)
src = src.replace(A1, NEW_COMPONENT + A1)
edits += 1

# ---------------------------------------------------------------
# Anchor 2: replace the dead <a href={at.url}> with <EvidenceDocLink/>
# ---------------------------------------------------------------
A2 = ("<a href={at.url} download={at.name} target=\"_blank\" rel=\"noopener noreferrer\" "
      "style={{color:'var(--blue)',textDecoration:'none'}}>\U0001F4CE {at.name}</a>")
R2 = "<EvidenceDocLink entry={at}/>"

n = src.count(A2)
if n != 1:
    print("ABORT: anchor 2 matched %d times (expected 1). Nothing written." % n)
    sys.exit(1)
src = src.replace(A2, R2)
edits += 1

# ---------------------------------------------------------------
if src == original:
    print("ABORT: no change produced. Nothing written.")
    sys.exit(1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(src)

print("OK: applied %d edits" % edits)
