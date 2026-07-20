#!/usr/bin/env python3
# job1_addsubphoto.py
# -----------------------------------------------------------------------------
# JOB 1, STEP 1 of 3: convert addSubPhoto (~2719) from writing inline base64
# data URLs into tasks.subtasks[].photos, to uploading to the task-evidence
# bucket and storing { path, ts, by, by_id, role }.
#
# Also inserts two small shared helpers (resolveTaskOrgId, dataUrlToFile) that
# steps 2 and 3 (addSubDoc, amendment photo) will reuse.
#
# SAFETY: exact-anchor match, asserts count == 1, writes NOTHING on mismatch.
# Run from /workspaces/Taksyn/taksyn as its OWN command and read the output.
# -----------------------------------------------------------------------------

import sys, io

PATH = "src/App.jsx"

OLD = """  const addSubPhoto = async (tid, idx, photoUrl) => {
    const task = tasks.find(t=>t.id===tid)
    const subs = parseSafe(task.subtasks)
    const uid = await authUserId()
    const photoObj = { url:photoUrl, ts:new Date().toISOString(), by:user.name, by_id:uid, role:user.role }
    const histEntry = { action:'photo_added', by:user.name, byId:uid, at:new Date().toISOString() }
    update(tid, { subtasks: subs.map((x,i)=>i===idx?{...x,photos:[...(x.photos||[]),photoObj],history:[...(x.history||[]),histEntry]}:x) })
  }"""

NEW = """  // Resolve a task's org to the org ID. tasks.org stores the org NAME on live
  // (e.g. "Kemrose") but the task-evidence bucket policy keys on the ID
  // (e.g. ORG1780482520610). Same pattern as the reviewer evidence path (~452).
  // Returns null when it cannot be resolved -- callers must refuse to upload.
  const resolveTaskOrgId = async (task) => {
    let orgId = (task?.org && String(task.org).startsWith('ORG')) ? task.org : null
    if (!orgId && task?.org && isConfigured()) {
      const { data: orgRow } = await supabase.from('organisations').select('id').eq('name', task.org).maybeSingle()
      orgId = orgRow?.id || null
    }
    return orgId
  }

  // Turn a captured data URL into a File. uploadEvidence builds its filename from
  // file.name, so a bare Blob would land in the bucket as "<ts>_undefined".
  const dataUrlToFile = async (dataUrl, stem) => {
    const blob = await (await fetch(dataUrl)).blob()
    const mime = blob.type || 'image/jpeg'
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
    return new File([blob], `${stem}.${ext}`, { type: mime })
  }

  const addSubPhoto = async (tid, idx, photoUrl) => {
    const task = tasks.find(t=>t.id===tid)
    const subs = parseSafe(task.subtasks)
    const uid = await authUserId()
    // Evidence goes to Storage as a path -- never inline base64, which is what
    // inflated the tasks table. Surface failures rather than silently falling
    // back to base64 (silent fallback is how the original defect persisted).
    let photoObj
    try {
      const orgId = await resolveTaskOrgId(task)
      if (!orgId) throw new Error(`could not resolve organisation id for "${task?.org}"`)
      const file = await dataUrlToFile(photoUrl, `evidence_${Date.now()}_sub${idx}`)
      const { path } = await uploadEvidence(file, orgId, tid)
      photoObj = { path, ts:new Date().toISOString(), by:user.name, by_id:uid, role:user.role }
    } catch (err) {
      alert(`Photo not saved -- ${err?.message || 'upload failed'}. Please try again.`)
      return
    }
    const histEntry = { action:'photo_added', by:user.name, byId:uid, at:new Date().toISOString() }
    update(tid, { subtasks: subs.map((x,i)=>i===idx?{...x,photos:[...(x.photos||[]),photoObj],history:[...(x.history||[]),histEntry]}:x) })
  }"""


def main():
    try:
        with io.open(PATH, "r", encoding="utf-8") as f:
            src = f.read()
    except OSError as e:
        print(f"ABORT: cannot read {PATH}: {e}")
        sys.exit(1)

    n = src.count(OLD)
    if n != 1:
        print(f"ABORT: anchor matched {n} times (expected exactly 1). NOTHING WRITTEN.")
        sys.exit(1)

    # Guard against a double-run.
    if "const resolveTaskOrgId = async" in src:
        print("ABORT: resolveTaskOrgId already present -- edit appears already applied. NOTHING WRITTEN.")
        sys.exit(1)

    out = src.replace(OLD, NEW, 1)

    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(out)

    print("OK: applied 1 edit (addSubPhoto -> Storage path, + resolveTaskOrgId/dataUrlToFile helpers)")


if __name__ == "__main__":
    main()
