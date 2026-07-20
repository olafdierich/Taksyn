#!/usr/bin/env python3
# job1_addsubdoc.py
# -----------------------------------------------------------------------------
# JOB 1, STEP 2 of 3.
#
# Edit A: add `size` to the photoObj written by addSubPhoto (step 1). The 5 MB
#         per-item guard sums photos as well as attachments, and with paths
#         instead of base64 urls it would otherwise read every photo as 0 bytes.
#
# Edit B: convert addSubDoc (~2709) from writing inline base64 data URLs into
#         tasks.subtasks[].attachments, to uploading to the task-evidence bucket
#         and storing { path, name, size, ts, by, by_id, role }. The 5 MB guard
#         is rewritten to sum e.size, falling back to the old url-length
#         arithmetic for legacy base64 entries.
#
# Requires step 1 (job1_addsubphoto.py) to have been applied.
# SAFETY: exact-anchor match, asserts count == 1 for EACH edit, writes NOTHING
# unless BOTH anchors match. Run from /workspaces/Taksyn/taksyn.
# -----------------------------------------------------------------------------

import sys, io

PATH = "src/App.jsx"

# ---- Edit A: size on the photo object ----------------------------------------
OLD_A = """      photoObj = { path, ts:new Date().toISOString(), by:user.name, by_id:uid, role:user.role }"""
NEW_A = """      photoObj = { path, size:file.size, ts:new Date().toISOString(), by:user.name, by_id:uid, role:user.role }"""

# ---- Edit B: addSubDoc -------------------------------------------------------
OLD_B = """  const addSubDoc = async (tid, idx, docUrl, docName) => {
    const task = tasks.find(t=>t.id===tid)
    const subs = parseSafe(task.subtasks)
    const uid = await authUserId()
    const _cur = subs[idx]||{}; const _used = [...(_cur.photos||[]),...(_cur.photo?[_cur.photo]:[]),...(_cur.attachments||[]),...(_cur.attachment?[_cur.attachment]:[])].reduce((a,e)=>a+((e&&e.url?e.url.length:0)*0.75),0)
    if (_used + (docUrl?docUrl.length*0.75:0) > 5*1024*1024) { alert('Attachments for this item would exceed the 5 MB total. Please attach a smaller file or remove one.'); return }
    const docObj = { url:docUrl, name:docName||'document', ts:new Date().toISOString(), by:user.name, by_id:uid, role:user.role }
    const histEntry = { action:'doc_added', by:user.name, byId:uid, at:new Date().toISOString() }
    update(tid, { subtasks: subs.map((x,i)=>i===idx?{...x,attachments:[...(x.attachments||[]),docObj],history:[...(x.history||[]),histEntry]}:x) })
  }"""

NEW_B = """  // Bytes already held against an item's 5 MB budget. Storage-backed entries
  // carry an explicit `size`; legacy base64 entries are measured from the data
  // URL length as before. Without the `size` branch the cap silently reads 0.
  const entryBytes = (e) => {
    if (!e || typeof e !== 'object') return 0
    if (typeof e.size === 'number') return e.size
    return e.url ? e.url.length * 0.75 : 0
  }

  const addSubDoc = async (tid, idx, docUrl, docName) => {
    const task = tasks.find(t=>t.id===tid)
    const subs = parseSafe(task.subtasks)
    const uid = await authUserId()
    const _cur = subs[idx]||{}; const _used = [...(_cur.photos||[]),...(_cur.photo?[_cur.photo]:[]),...(_cur.attachments||[]),...(_cur.attachment?[_cur.attachment]:[])].reduce((a,e)=>a+entryBytes(e),0)
    if (_used + (docUrl?docUrl.length*0.75:0) > 5*1024*1024) { alert('Attachments for this item would exceed the 5 MB total. Please attach a smaller file or remove one.'); return }
    // Documents go to Storage as a path, same as photos. dataUrlToFile is not
    // reused here: its extension logic is image-only and would name a PDF .jpg.
    let docObj
    try {
      const orgId = await resolveTaskOrgId(task)
      if (!orgId) throw new Error(`could not resolve organisation id for "${task?.org}"`)
      const blob = await (await fetch(docUrl)).blob()
      const safeName = String(docName || 'document').replace(/[^\\w.\\-]+/g, '_')
      const file = new File([blob], safeName, { type: blob.type || 'application/octet-stream' })
      const { path } = await uploadEvidence(file, orgId, tid)
      docObj = { path, name:docName||'document', size:blob.size, ts:new Date().toISOString(), by:user.name, by_id:uid, role:user.role }
    } catch (err) {
      alert(`Document not saved -- ${err?.message || 'upload failed'}. Please try again.`)
      return
    }
    const histEntry = { action:'doc_added', by:user.name, byId:uid, at:new Date().toISOString() }
    update(tid, { subtasks: subs.map((x,i)=>i===idx?{...x,attachments:[...(x.attachments||[]),docObj],history:[...(x.history||[]),histEntry]}:x) })
  }"""


def main():
    try:
        with io.open(PATH, "r", encoding="utf-8") as f:
            src = f.read()
    except OSError as e:
        print(f"ABORT: cannot read {PATH}: {e}")
        sys.exit(1)

    if "const resolveTaskOrgId = async" not in src:
        print("ABORT: resolveTaskOrgId not found -- run job1_addsubphoto.py first. NOTHING WRITTEN.")
        sys.exit(1)

    if "const entryBytes = (e)" in src:
        print("ABORT: entryBytes already present -- edit appears already applied. NOTHING WRITTEN.")
        sys.exit(1)

    na = src.count(OLD_A)
    nb = src.count(OLD_B)
    if na != 1 or nb != 1:
        print(f"ABORT: anchor A matched {na} times, anchor B matched {nb} times (expected 1 each). NOTHING WRITTEN.")
        sys.exit(1)

    out = src.replace(OLD_A, NEW_A, 1).replace(OLD_B, NEW_B, 1)

    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(out)

    print("OK: applied 2 edits (photoObj size; addSubDoc -> Storage path + guard repair)")


if __name__ == "__main__":
    main()
