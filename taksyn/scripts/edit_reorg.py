#!/usr/bin/env python3
# Abort-safe edit: reorder IssueReportsAdminView from priority-grouped to type-grouped
# (Complaints -> Feedback -> Requests), flat newest-first within each, empty sections hidden.
# Card render is preserved; per-card border uses the issue's OWN priority color.
# Each anchor must match EXACTLY ONCE. Writes nothing on mismatch.
import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        src = f.read()
    orig = src
    edits = []

    # ---- Edit 1: grouped by TYPE, newest-first within each ----
    a1 = "  const grouped = { high: visible.filter(i=>i.priority==='high'), medium: visible.filter(i=>i.priority==='medium'), low: visible.filter(i=>i.priority==='low') }\n"
    r1 = ("  const byRecent = (a,b)=> new Date(b.created_at) - new Date(a.created_at)\n"
          "  const grouped = {\n"
          "    complaint: visible.filter(i=>(i.type||'request')==='complaint').sort(byRecent),\n"
          "    feedback:  visible.filter(i=>(i.type||'request')==='feedback').sort(byRecent),\n"
          "    request:   visible.filter(i=>(i.type||'request')==='request').sort(byRecent),\n"
          "  }\n"
          "  const TYPE_SECTION = { complaint:['⚠️','Complaints','#EF4444'], feedback:['💬','Feedback','#10B981'], request:['📋','Requests','#6366F1'] }\n")
    edits.append(("grouped_by_type", a1, r1))

    # ---- Edit 2: outer loop over types + type section header. Anchor spans the loop
    # opening through the section-header block, so the card body below is untouched. ----
    a2 = ("        ['high','medium','low'].map(pri=>{\n"
          "          const grp = grouped[pri]\n"
          "          if(!grp.length) return null\n"
          "          const pc = ISSUE_PRIORITY_CFG[pri]\n"
          "          return (\n"
          "            <div key={pri} style={{marginBottom:28}}>\n"
          "              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>\n"
          "                <span style={{fontSize:13,fontWeight:700,color:pc.color}}>{pc.emoji} {pc.label} Priority</span>\n"
          "                <span style={{fontSize:11,color:'var(--t2)'}}>({grp.length})</span>\n"
          "              </div>\n")
    r2 = ("        ['complaint','feedback','request'].map(typ=>{\n"
          "          const grp = grouped[typ]\n"
          "          if(!grp.length) return null\n"
          "          const [tEmoji,tLabel,tColor] = TYPE_SECTION[typ]\n"
          "          return (\n"
          "            <div key={typ} style={{marginBottom:28}}>\n"
          "              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>\n"
          "                <span style={{fontSize:13,fontWeight:700,color:tColor}}>{tEmoji} {tLabel}</span>\n"
          "                <span style={{fontSize:11,color:'var(--t2)'}}>({grp.length})</span>\n"
          "              </div>\n")
    edits.append(("type_loop_header", a2, r2))

    # ---- Edit 3: card border used the section's `pc.color`; pc no longer exists.
    # Derive a per-card priority color from the issue's own priority. ----
    a3 = "                {grp.map(issue=>{\n                  const sc = ISSUE_STATUS_CFG[issue.status]||ISSUE_STATUS_CFG.open\n"
    r3 = ("                {grp.map(issue=>{\n"
          "                  const sc = ISSUE_STATUS_CFG[issue.status]||ISSUE_STATUS_CFG.open\n"
          "                  const pc = ISSUE_PRIORITY_CFG[issue.priority]||ISSUE_PRIORITY_CFG.medium\n")
    edits.append(("percard_pc", a3, r3))

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
