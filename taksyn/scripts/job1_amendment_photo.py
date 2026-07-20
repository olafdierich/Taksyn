#!/usr/bin/env python3
# job1_amendment_photo.py
# -----------------------------------------------------------------------------
# JOB 1, STEP 3b of 3 -- the last write path.
#
# The amendment photo input inside AmendmentPanel (~4396) compresses a picked
# file and writes the resulting base64 data URL straight into tasks.evidence.
# Convert it to upload to the task-evidence bucket and store
# { path, size, ts, by, by_id, role }, matching addSubPhoto and addSubDoc.
#
# Uses the module-scope helpers promoted in step 3a (AmendmentPanel is a
# separate component and cannot see the component-scoped versions).
#
# Also reorders: the 5-image cap is now checked BEFORE compressing/uploading,
# so a rejected photo no longer does the work first.
#
# SAFETY: exact-anchor match, asserts count == 1, writes NOTHING on mismatch.
# Run from /workspaces/Taksyn/taksyn.
# -----------------------------------------------------------------------------

import sys, io

PATH = "src/App.jsx"

OLD = """            const inp=e.target; const f=inp.files[0]; if(!f) return
            const compressed=await compressImage(f)
            const curr=parseSafe(sel.evidence)
            if(curr.length>=5){ alert('Maximum 5 images reached'); inp.value=''; return }
            await update(sel.id,{evidence:[...curr,{url:compressed,ts:new Date().toISOString(),by:user.name,by_id:await authUserId(),role:user.role}]})"""

NEW = """            const inp=e.target; const f=inp.files[0]; if(!f) return
            const curr=parseSafe(sel.evidence)
            if(curr.length>=5){ alert('Maximum 5 images reached'); inp.value=''; return }
            const compressed=await compressImage(f)
            // Amendment evidence goes to Storage as a path, never inline base64.
            // Surface failures rather than silently falling back to base64.
            let evObj
            try {
              const orgId = await resolveTaskOrgId(sel)
              if (!orgId) throw new Error(`could not resolve organisation id for "${sel?.org}"`)
              const file = await dataUrlToFile(compressed, `amendment_${Date.now()}`)
              const { path } = await uploadEvidence(file, orgId, sel.id)
              evObj = { path, size:file.size, ts:new Date().toISOString(), by:user.name, by_id:await authUserId(), role:user.role }
            } catch (err) {
              alert(`Photo not saved -- ${err?.message || 'upload failed'}. Please try again.`)
              inp.value=''
              return
            }
            await update(sel.id,{evidence:[...curr,evObj]})"""


def main():
    try:
        with io.open(PATH, "r", encoding="utf-8") as f:
            src = f.read()
    except OSError as e:
        print(f"ABORT: cannot read {PATH}: {e}")
        sys.exit(1)

    # Helpers must already be at module scope (step 3a).
    if "\nconst resolveTaskOrgId = async" not in src:
        print("ABORT: resolveTaskOrgId not at module scope -- run job1_promote_helpers.py first. NOTHING WRITTEN.")
        sys.exit(1)

    if "const orgId = await resolveTaskOrgId(sel)" in src:
        print("ABORT: amendment edit appears already applied. NOTHING WRITTEN.")
        sys.exit(1)

    n = src.count(OLD)
    if n != 1:
        print(f"ABORT: anchor matched {n} times (expected exactly 1). NOTHING WRITTEN.")
        sys.exit(1)

    out = src.replace(OLD, NEW, 1)

    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(out)

    print("OK: applied 1 edit (amendment photo -> Storage path)")


if __name__ == "__main__":
    main()
