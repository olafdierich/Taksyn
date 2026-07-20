#!/usr/bin/env python3
# job1_promote_helpers.py
# -----------------------------------------------------------------------------
# JOB 1, STEP 3a of 3.
#
# resolveTaskOrgId and dataUrlToFile were introduced in step 1 inside the main
# component. The third write path (the amendment photo input) lives inside
# AmendmentPanel -- a SEPARATE top-level component -- so calling them from there
# would build cleanly and then throw ReferenceError at runtime.
#
# This promotes both helpers to module scope, immediately before compressImage.
# Their dependencies are all module-level already: supabase (line 2),
# authUserId (~140), isConfigured (~325).
#
# Edit A: insert the two helpers at module scope before `const compressImage`.
# Edit B: delete the component-scoped copies inserted by step 1.
#
# SAFETY: exact-anchor match, asserts count == 1 for EACH edit, writes NOTHING
# unless BOTH anchors match. Run from /workspaces/Taksyn/taksyn.
# -----------------------------------------------------------------------------

import sys, io

PATH = "src/App.jsx"

# ---- Edit A: insert at module scope ------------------------------------------
OLD_A = """const compressImage = async (file) => {"""

NEW_A = """// Resolve a task's org to the org ID. tasks.org stores the org NAME on live
// (e.g. "Kemrose") but the task-evidence bucket policy keys on the ID
// (e.g. ORG1780482520610). Module scope: used from more than one component.
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

const compressImage = async (file) => {"""

# ---- Edit B: remove the component-scoped copies from step 1 ------------------
OLD_B = """  // Resolve a task's org to the org ID. tasks.org stores the org NAME on live
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

  const addSubPhoto = async (tid, idx, photoUrl) => {"""

NEW_B = """  const addSubPhoto = async (tid, idx, photoUrl) => {"""


def main():
    try:
        with io.open(PATH, "r", encoding="utf-8") as f:
            src = f.read()
    except OSError as e:
        print(f"ABORT: cannot read {PATH}: {e}")
        sys.exit(1)

    if "const entryBytes = (e)" not in src:
        print("ABORT: entryBytes not found -- run job1_addsubdoc_v2.py first. NOTHING WRITTEN.")
        sys.exit(1)

    na = src.count(OLD_A)
    nb = src.count(OLD_B)
    if na != 1 or nb != 1:
        print(f"ABORT: anchor A matched {na} times, anchor B matched {nb} times (expected 1 each). NOTHING WRITTEN.")
        sys.exit(1)

    out = src.replace(OLD_A, NEW_A, 1).replace(OLD_B, NEW_B, 1)

    # Post-condition: exactly one definition of each helper must survive.
    if out.count("const resolveTaskOrgId = async") != 1 or out.count("const dataUrlToFile = async") != 1:
        print("ABORT: helper definition count wrong after edit. NOTHING WRITTEN.")
        sys.exit(1)

    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(out)

    print("OK: applied 2 edits (helpers promoted to module scope, component copies removed)")


if __name__ == "__main__":
    main()
