#!/usr/bin/env python3
# Abort-safe edit: add type filter + type pill + anonymity-aware reporter to IssueReportsAdminView.
# Each anchor must match EXACTLY ONCE. Writes nothing on any mismatch.
import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        src = f.read()
    orig = src
    edits = []

    # ---- Edit 1: filterType state (anchor widened with reporterNames+loading lines,
    # unique to IssueReportsAdminView; another view also has a filterStatus='open' line) ----
    a1 = ("  const [reporterNames, setReporterNames] = useState({})\n"
          "  const [loading, setLoading] = useState(true)\n"
          "  const [filterStatus, setFilterStatus] = useState('open')\n")
    r1 = ("  const [reporterNames, setReporterNames] = useState({})\n"
          "  const [loading, setLoading] = useState(true)\n"
          "  const [filterStatus, setFilterStatus] = useState('open')\n"
          "  const [filterType, setFilterType] = useState('all')\n")
    edits.append(("filtertype_state", a1, r1))

    # ---- Edit 2: extend `visible` to honour filterType ----
    a2 = "  const visible = issues.filter(i=> filterStatus==='all' ? true : i.status===filterStatus)\n"
    r2 = ("  const visible = issues.filter(i=> (filterStatus==='all' ? true : i.status===filterStatus) && (filterType==='all' ? true : (i.type||'request')===filterType))\n")
    edits.append(("visible_filter", a2, r2))

    # ---- Edit 3: type-filter pill row, inserted right after the status-filter row's closing ----
    # Anchor: the closing of the status-filter block (the map + wrapper div close), unique.
    a3 = ("            {l} {v!=='all'&&<span style={{fontSize:10,opacity:.7}}>({issues.filter(i=>i.status===v).length})</span>}\n"
          "          </button>\n"
          "        ))}\n"
          "      </div>\n")
    r3 = ("            {l} {v!=='all'&&<span style={{fontSize:10,opacity:.7}}>({issues.filter(i=>i.status===v).length})</span>}\n"
          "          </button>\n"
          "        ))}\n"
          "      </div>\n"
          "      <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap'}}>\n"
          "        {[['all','All types'],['request','📋 Requests'],['complaint','⚠️ Complaints'],['feedback','💬 Feedback']].map(([v,l])=>(\n"
          "          <button key={v} onClick={()=>setFilterType(v)} style={{padding:'6px 14px',borderRadius:20,border:`2px solid ${filterType===v?'var(--brand)':'var(--border)'}`,background:filterType===v?'var(--brand-lt)':'none',color:filterType===v?'var(--brand)':'var(--t2)',fontWeight:filterType===v?700:400,cursor:'pointer',fontSize:12,fontFamily:'inherit',transition:'all .15s'}}>\n"
          "            {l} {v!=='all'&&<span style={{fontSize:10,opacity:.7}}>({issues.filter(i=>(i.type||'request')===v).length})</span>}\n"
          "          </button>\n"
          "        ))}\n"
          "      </div>\n")
    edits.append(("typefilter_row", a3, r3))

    # ---- Edit 4: type pill on each row, next to the title ----
    a4 = '                          <div style={{fontWeight:700,marginBottom:2}}>{issue.title}</div>\n'
    r4 = ('                          <div style={{display:\'flex\',alignItems:\'center\',gap:7,marginBottom:2,flexWrap:\'wrap\'}}>\n'
          '                            <span style={{fontWeight:700}}>{issue.title}</span>\n'
          '                            {(()=>{ const t=issue.type||\'request\'; const tc={request:[\'📋\',\'#6366F1\'],complaint:[\'⚠️\',\'#EF4444\'],feedback:[\'💬\',\'#10B981\']}[t]||[\'📋\',\'#6366F1\']; return <span style={{fontSize:10,fontWeight:700,padding:\'2px 8px\',borderRadius:10,background:tc[1]+\'1a\',color:tc[1],textTransform:\'capitalize\'}}>{tc[0]} {t}</span> })()}\n'
          '                          </div>\n')
    edits.append(("type_pill", a4, r4))

    # ---- Edit 5: anonymity-aware reporter line ----
    a5 = "                            <span>👤 {reporterNames[issue.reported_by]||'Team member'}</span>\n"
    r5 = "                            {issue.is_anonymous ? <span style={{color:'var(--t2)',fontWeight:600}}>🔒 Anonymous</span> : <span>👤 {reporterNames[issue.reported_by]||'Team member'}</span>}\n"
    edits.append(("anon_reporter", a5, r5))

    # verify each anchor matches exactly once
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
