#!/usr/bin/env python3
# Abort-safe edit: add rolling time-period filter (365/90/30/custom) to IssueReportsAdminView.
# periodIssues = issues within window; visible + all counts derive from it. Default 365 (Annually).
# Each anchor must match EXACTLY ONCE. Writes nothing on mismatch.
import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        src = f.read()
    orig = src
    edits = []

    # ---- Edit 1: period state (anchor: filterType state line, added by the type-edit) ----
    a1 = "  const [filterType, setFilterType] = useState('all')\n"
    r1 = ("  const [filterType, setFilterType] = useState('all')\n"
          "  const [period, setPeriod] = useState('365')\n"
          "  const [customFrom, setCustomFrom] = useState('')\n"
          "  const [customTo, setCustomTo] = useState('')\n")
    edits.append(("period_state", a1, r1))

    # ---- Edit 2: periodIssues helper + rewire visible to derive from it ----
    a2 = "  const visible = issues.filter(i=> (filterStatus==='all' ? true : i.status===filterStatus) && (filterType==='all' ? true : (i.type||'request')===filterType))\n"
    r2 = ("  const periodIssues = (()=>{\n"
          "    if(period==='custom'){\n"
          "      const from = customFrom ? new Date(customFrom+'T00:00:00') : null\n"
          "      const to = customTo ? new Date(customTo+'T23:59:59') : null\n"
          "      return issues.filter(i=>{ const d=new Date(i.created_at); return (!from||d>=from) && (!to||d<=to) })\n"
          "    }\n"
          "    const days = parseInt(period,10)||365\n"
          "    const cutoff = new Date(Date.now() - days*86400000)\n"
          "    return issues.filter(i=> new Date(i.created_at) >= cutoff)\n"
          "  })()\n"
          "  const visible = periodIssues.filter(i=> (filterStatus==='all' ? true : i.status===filterStatus) && (filterType==='all' ? true : (i.type||'request')===filterType))\n")
    edits.append(("periodissues_visible", a2, r2))

    # ---- Edit 3: status counts derive from periodIssues ----
    a3 = "            {l} {v!=='all'&&<span style={{fontSize:10,opacity:.7}}>({issues.filter(i=>i.status===v).length})</span>}\n"
    r3 = "            {l} {v!=='all'&&<span style={{fontSize:10,opacity:.7}}>({periodIssues.filter(i=>i.status===v).length})</span>}\n"
    edits.append(("status_counts", a3, r3))

    # ---- Edit 4: type counts derive from periodIssues, and insert the period selector row AFTER the type filter row ----
    # Anchor: the whole type-filter row closing (unique). We replace the count expr AND append the period row.
    a4 = ("            {l} {v!=='all'&&<span style={{fontSize:10,opacity:.7}}>({issues.filter(i=>(i.type||'request')===v).length})</span>}\n"
          "          </button>\n"
          "        ))}\n"
          "      </div>\n")
    r4 = ("            {l} {v!=='all'&&<span style={{fontSize:10,opacity:.7}}>({periodIssues.filter(i=>(i.type||'request')===v).length})</span>}\n"
          "          </button>\n"
          "        ))}\n"
          "      </div>\n"
          "      <div style={{display:'flex',gap:8,marginBottom:period==='custom'?12:20,flexWrap:'wrap',alignItems:'center'}}>\n"
          "        {[['365','Annually'],['90','Quarterly'],['30','Monthly'],['custom','Custom']].map(([v,l])=>(\n"
          "          <button key={v} onClick={()=>setPeriod(v)} style={{padding:'6px 14px',borderRadius:20,border:`2px solid ${period===v?'var(--brand)':'var(--border)'}`,background:period===v?'var(--brand-lt)':'none',color:period===v?'var(--brand)':'var(--t2)',fontWeight:period===v?700:400,cursor:'pointer',fontSize:12,fontFamily:'inherit',transition:'all .15s'}}>\n"
          "            {l}\n"
          "          </button>\n"
          "        ))}\n"
          "        <span style={{fontSize:11,color:'var(--t3)',marginLeft:4}}>{periodIssues.length} in period</span>\n"
          "      </div>\n"
          "      {period==='custom' && (\n"
          "        <div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap',alignItems:'center'}}>\n"
          "          <label style={{fontSize:12,color:'var(--t2)',display:'flex',alignItems:'center',gap:6}}>From <input type=\"date\" value={customFrom} onChange={e=>setCustomFrom(e.target.value)} style={{padding:'5px 8px',borderRadius:8,border:'1px solid var(--border)',fontFamily:'inherit',fontSize:12}}/></label>\n"
          "          <label style={{fontSize:12,color:'var(--t2)',display:'flex',alignItems:'center',gap:6}}>To <input type=\"date\" value={customTo} onChange={e=>setCustomTo(e.target.value)} style={{padding:'5px 8px',borderRadius:8,border:'1px solid var(--border)',fontFamily:'inherit',fontSize:12}}/></label>\n"
          "          {(customFrom||customTo) && <button onClick={()=>{setCustomFrom('');setCustomTo('')}} style={{fontSize:11,color:'var(--t2)',background:'none',border:'none',cursor:'pointer',textDecoration:'underline',fontFamily:'inherit'}}>clear</button>}\n"
          "        </div>\n"
          "      )}\n")
    edits.append(("type_counts_and_period_row", a4, r4))

    # verify
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
