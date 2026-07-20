#!/usr/bin/env python3
# Abort-safe edit: add Team dropdown + Name search box to PerformanceView.
# Filters BOTH the per-person list and the team cards. Composes with existing role + period filters.
# Each anchor must match EXACTLY ONCE. Writes nothing on mismatch.
import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        src = f.read()
    orig = src
    edits = []

    # ---- Edit 1: new state alongside selectedRole ----
    a1 = "  const [selectedRole, setSelectedRole] = useState('all')\n"
    r1 = ("  const [selectedRole, setSelectedRole] = useState('all')\n"
          "  const [selectedTeam, setSelectedTeam] = useState('all')\n"
          "  const [nameQuery, setNameQuery] = useState('')\n")
    edits.append(("perf_state", a1, r1))

    # ---- Edit 2: hoist memberTeams above `people`, add team+name filters to the people chain ----
    # Original block: people (3 lines) then memberTeams then teamMap.
    a2 = ("  const people = Object.values(peopleMap)\n"
          "    .filter(p=>selectedRole==='all'||p.role===selectedRole)\n"
          "    .sort((a,b)=>b.total-a.total)\n"
          "  const memberTeams={}; teamMembers.forEach(m=>{ (memberTeams[m.user_id]=memberTeams[m.user_id]||[]).push(m.team_id) })\n"
          "  const teamMap={}; teamsList.forEach(t=>{ teamMap[t.id]={name:t.name,total:0,done:0} })\n")
    r2 = ("  const memberTeams={}; teamMembers.forEach(m=>{ (memberTeams[m.user_id]=memberTeams[m.user_id]||[]).push(m.team_id) })\n"
          "  const _nq = nameQuery.trim().toLowerCase()\n"
          "  const people = Object.values(peopleMap)\n"
          "    .filter(p=>selectedRole==='all'||p.role===selectedRole)\n"
          "    .filter(p=>selectedTeam==='all'||(memberTeams[p.id]||[]).includes(selectedTeam))\n"
          "    .filter(p=>!_nq||(p.name||'').toLowerCase().includes(_nq))\n"
          "    .sort((a,b)=>b.total-a.total)\n"
          "  const teamMap={}; teamsList.forEach(t=>{ teamMap[t.id]={id:t.id,name:t.name,total:0,done:0} })\n")
    edits.append(("people_filters", a2, r2))

    # ---- Edit 3: filter team cards by selected team / matching names ----
    a3 = "  const teams=Object.values(teamMap).sort((a,b)=>b.total-a.total)\n"
    r3 = ("  const _teamIdsWithMatches = new Set()\n"
          "  people.forEach(p=>{ (memberTeams[p.id]||[]).forEach(tid=>_teamIdsWithMatches.add(tid)) })\n"
          "  const teams=Object.values(teamMap)\n"
          "    .filter(tm=>selectedTeam==='all'||tm.id===selectedTeam)\n"
          "    .filter(tm=>(selectedRole==='all'&&!_nq)||_teamIdsWithMatches.has(tm.id))\n"
          "    .sort((a,b)=>b.total-a.total)\n")
    edits.append(("teams_filter", a3, r3))

    # ---- Edit 4: Team dropdown + Name search box in the filter bar (after the Roles select) ----
    a4 = ('        <select className="form-input" value={selectedRole} onChange={e=>setSelectedRole(e.target.value)} style={{fontSize:12,padding:\'5px 10px\',maxWidth:160}}>\n'
          '          <option value="all">All Roles</option>\n'
          "          {['manager','supervisor','worker'].map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}\n"
          "        </select>\n")
    r4 = ('        <select className="form-input" value={selectedRole} onChange={e=>setSelectedRole(e.target.value)} style={{fontSize:12,padding:\'5px 10px\',maxWidth:160}}>\n'
          '          <option value="all">All Roles</option>\n'
          "          {['manager','supervisor','worker'].map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}\n"
          "        </select>\n"
          '        <select className="form-input" value={selectedTeam} onChange={e=>setSelectedTeam(e.target.value)} style={{fontSize:12,padding:\'5px 10px\',maxWidth:160}}>\n'
          '          <option value="all">All Teams</option>\n'
          "          {teamsList.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}\n"
          "        </select>\n"
          '        <input className="form-input" type="text" value={nameQuery} onChange={e=>setNameQuery(e.target.value)} placeholder="Search name…" style={{fontSize:12,padding:\'5px 10px\',maxWidth:180}}/>\n'
          "        {(selectedRole!=='all'||selectedTeam!=='all'||nameQuery.trim()) && (\n"
          "          <button className=\"btn btn-sm btn-secondary\" onClick={()=>{setSelectedRole('all');setSelectedTeam('all');setNameQuery('')}} style={{fontSize:11}}>Clear</button>\n"
          "        )}\n")
    edits.append(("filter_bar", a4, r4))

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
