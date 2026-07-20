#!/usr/bin/env python3
# Abort-safe edit: add Complaint/Feedback type picker + anonymous option to ReportIssueView.
# Matches each anchor EXACTLY ONCE. Writes nothing if any anchor is missing or ambiguous.
import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        src = f.read()
    orig = src
    edits = []

    # ---- Edit 1: new state (rtype + anon) after the issues state line ----
    a1 = "  const [issues, setIssues] = useState([])\n"
    r1 = ("  const [issues, setIssues] = useState([])\n"
          "  const [rtype, setRtype] = useState('request')\n"
          "  const [anon, setAnon] = useState(false)\n")
    edits.append(("state", a1, r1))

    # ---- Edit 2: payload gains type + anon-aware identity ----
    a2 = ("    const payload = {\n"
          "      reported_by: user.id,\n"
          "      org: user.org,\n"
          "      title: title.trim(),\n"
          "      description: desc.trim(),\n"
          "      priority,\n"
          "      status: 'open',\n"
          "    }\n")
    r2 = ("    const payload = {\n"
          "      reported_by: anon ? null : user.id,\n"
          "      org: user.org,\n"
          "      title: title.trim(),\n"
          "      description: desc.trim(),\n"
          "      priority,\n"
          "      status: 'open',\n"
          "      type: rtype,\n"
          "      is_anonymous: anon,\n"
          "    }\n")
    edits.append(("payload", a2, r2))

    # ---- Edit 3: de-identified notify for anonymous; named path unchanged ----
    a3 = ("              sendEmailNotif(p.email, `New request logged: ${payload.title}`,\n"
          "                `${user.name} (${ROLE_LABELS[user.role]||user.role}) reported a new ${priority} priority issue in ${user.org}.\\n\\nTitle: ${payload.title}\\n\\nDescription: ${payload.description}\\n\\nLog in to Taksyn to review and action this issue.`)\n")
    r3 = ("              sendEmailNotif(p.email,\n"
          "                anon ? `New anonymous ${rtype} logged` : `New request logged: ${payload.title}`,\n"
          "                anon\n"
          "                  ? `An anonymous ${rtype} was logged in ${user.org}.\\n\\nLog in to Taksyn to review and action it. (The submitter chose to remain anonymous; no identity is stored.)`\n"
          "                  : `${user.name} (${ROLE_LABELS[user.role]||user.role}) reported a new ${priority} priority issue in ${user.org}.\\n\\nTitle: ${payload.title}\\n\\nDescription: ${payload.description}\\n\\nLog in to Taksyn to review and action this issue.`)\n")
    edits.append(("notify", a3, r3))

    # ---- Edit 4: suppress local echo for anonymous rows ----
    a4 = "    setIssues(prev=>[{...payload, id:'local_'+Date.now(), created_at:now},...prev])\n"
    r4 = "    if(!anon) setIssues(prev=>[{...payload, id:'local_'+Date.now(), created_at:now},...prev])\n"
    edits.append(("echo", a4, r4))

    # ---- Edit 5: reset new fields on success ----
    a5 = "    setTitle(''); setDesc(''); setPriority('medium'); setPhoto(null)\n"
    r5 = "    setTitle(''); setDesc(''); setPriority('medium'); setPhoto(null); setRtype('request'); setAnon(false)\n"
    edits.append(("reset", a5, r5))

    # ---- Edit 6: Type picker JSX inserted ABOVE the Priority form-group ----
    a6 = ('        <div className="form-group">\n'
          '          <label className="form-label">Priority</label>\n')
    r6 = ('        <div className="form-group">\n'
          '          <label className="form-label">Type</label>\n'
          '          <div style={{display:\'flex\',gap:8,flexWrap:\'wrap\'}}>\n'
          '            {[[\'request\',\'\\ud83d\\udccb\',\'Request\'],[\'complaint\',\'\\u26a0\\ufe0f\',\'Complaint\'],[\'feedback\',\'\\ud83d\\udcac\',\'Feedback\']].map(([v,em,lb])=>(\n'
          '              <button key={v} onClick={()=>setRtype(v)} style={{padding:\'7px 16px\',borderRadius:20,border:`2px solid ${rtype===v?\'var(--brand)\':\'var(--border)\'}`,background:rtype===v?\'rgba(99,102,241,.1)\':\'none\',color:rtype===v?\'var(--brand)\':\'var(--t2)\',fontWeight:rtype===v?700:400,cursor:\'pointer\',fontSize:13,display:\'flex\',alignItems:\'center\',gap:5,fontFamily:\'inherit\',transition:\'all .15s\'}}>\n'
          '                {em} {lb}\n'
          '              </button>\n'
          '            ))}\n'
          '          </div>\n'
          '        </div>\n'
          '        <div className="form-group">\n'
          '          <label className="form-label">Priority</label>\n')
    edits.append(("typepicker", a6, r6))

    # ---- Edit 7: Anonymous checkbox inserted ABOVE the submitted banner ----
    a7 = "        {submitted && <div style={{padding:'10px 14px',borderRadius:8,background:'rgba(16,185,129,.1)',border:'1px solid rgba(16,185,129,.3)',color:'#059669',fontWeight:600,marginBottom:12}}>✓ Request logged successfully</div>}\n"
    r7 = ('        <div className="form-group">\n'
          '          <label style={{display:\'flex\',alignItems:\'flex-start\',gap:9,cursor:\'pointer\'}}>\n'
          '            <input type="checkbox" checked={anon} onChange={e=>setAnon(e.target.checked)} style={{marginTop:3,cursor:\'pointer\',flexShrink:0}}/>\n'
          '            <span style={{fontSize:13,color:\'var(--t2)\',lineHeight:1.5}}>\n'
          '              <strong style={{color:\'var(--t1)\'}}>Submit anonymously</strong><br/>\n'
          '              Your name and identity will not be stored. This cannot be undone or traced back to you \u2014 an anonymous submission will not appear in your list below.\n'
          '            </span>\n'
          '          </label>\n'
          '        </div>\n'
          "        {submitted && <div style={{padding:'10px 14px',borderRadius:8,background:'rgba(16,185,129,.1)',border:'1px solid rgba(16,185,129,.3)',color:'#059669',fontWeight:600,marginBottom:12}}>✓ Request logged successfully</div>}\n")
    edits.append(("checkbox", a7, r7))

    # verify each anchor matches exactly once
    for name, anchor, _ in edits:
        c = src.count(anchor)
        if c != 1:
            print(f"ABORT: anchor '{name}' matched {c} times (expected 1). No changes written.")
            sys.exit(1)

    # apply
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
