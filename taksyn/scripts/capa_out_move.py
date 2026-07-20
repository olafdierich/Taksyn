#!/usr/bin/env python3
# CAPA "Out" move — ATOMIC abort-safe edit to src/App.jsx
# All four edits apply together or NOTHING is written.
#   1. declare capaStaff state (beside actions state)
#   2. populate capaStaff (all-roles) after the existing members fetch
#   3. replace the simple corrective-action add with <CapaActionForm/>
#   4. insert the CapaActionForm component definition before IncidentHubView
# Every anchor must match exactly once; on ANY mismatch, the file is left untouched.

import sys, io

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"
with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()
orig = src

edits = []

# 1. capaStaff state
A1 = "  const [actions, setActions] = useState([])"
A1_NEW = A1 + "\n  const [capaStaff, setCapaStaff] = useState([])"
edits.append(("capaStaff state", A1, A1_NEW))

# 2. all-roles fetch after members fetch
A2 = """      setMembers(mem.filter(m=>['supervisor','manager','client_admin'].includes(m.role))
        .map(m=>({ ...m, name: nameMap[m.user_id]||'—' })))"""
A2_NEW = A2 + """
      setCapaStaff(mem.map(m=>({ ...m, name: nameMap[m.user_id]||'—' })))"""
edits.append(("all-roles capaStaff fetch", A2, A2_NEW))

# 3. seam replacement
A3 = """          <div style={{display:'flex',gap:8,marginTop:10}}>
            <input id="inc-action" placeholder="Add a corrective action…"
              style={{flex:1,padding:'8px 10px',borderRadius:8,border:'1px solid var(--border2)',background:'var(--card)',color:'var(--text)'}}/>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={async ()=>{
              const el=document.getElementById('inc-action'); const desc=el.value.trim()
              if(!desc) return
              const { data: sess } = await supabase.auth.getSession()
              await supabase.from('incident_actions').insert({ incident_id:sel.id, org:orgId, description:desc, action_type:'corrective' })
              await supabase.from('incident_events').insert({ incident_id:sel.id, org:orgId, event_type:'action_created',
                by_id:sess?.session?.user?.id, by_name:user.name, by_role:user.role, to_value:desc.slice(0,60) })
              el.value=''
              const { data: act } = await supabase.from('incident_actions').select('*').eq('incident_id',sel.id).order('created_at',{ascending:true})
              setActions(act||[])
              const { data: ev } = await supabase.from('incident_events').select('*').eq('incident_id',sel.id).order('at',{ascending:false})
              setEvents(ev||[])
            }}>Add</button>
          </div>"""
A3_NEW = """          <CapaActionForm sel={sel} orgId={orgId} user={user} busy={busy} setBusy={setBusy}
            capaStaff={capaStaff} isAdmin={isAdmin}
            onDone={async ()=>{
              const { data: act } = await supabase.from('incident_actions').select('*').eq('incident_id',sel.id).order('created_at',{ascending:true})
              setActions(act||[])
              const { data: ev } = await supabase.from('incident_events').select('*').eq('incident_id',sel.id).order('at',{ascending:false})
              setEvents(ev||[])
            }}/>"""
edits.append(("seam -> CapaActionForm", A3, A3_NEW))

# 4. component definition before IncidentHubView
A4 = "function IncidentHubView({ user, setPage }) {"
COMPONENT = r'''function CapaActionForm({ sel, orgId, user, busy, setBusy, capaStaff, isAdmin, onDone }) {
  const [desc, setDesc] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [evidence, setEvidence] = useState(true)
  const [err, setErr] = useState('')

  const sev = Number(sel?.severity) || 0
  const risk = Number(sel?.risk_rating) || 0
  const gated = sev >= 3 || risk >= 9
  const blocked = gated && !isAdmin

  const create = async () => {
    setErr('')
    const d = desc.trim()
    if (!d) { setErr('Enter a description.'); return }
    if (!ownerId) { setErr('Choose who will do this action.'); return }
    if (blocked) { setErr('High severity/risk — a client admin must assign this action.'); return }
    setBusy(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const uid = sess?.session?.user?.id
      const owner = capaStaff.find(m => m.user_id === ownerId)
      const ownerName = owner?.name || ''
      const now = new Date().toISOString()
      const taskId = 'T' + Date.now()
      const subtasks = [{ id: 's' + Date.now(), text: 'Complete corrective action and attach evidence', done: false, requirePhoto: !!evidence }]
      const taskPayload = {
        id: taskId, title: d, category: 'Corrective action', status: 'pending',
        priority: 'high', compliance: !!evidence, recurrence: 'once',
        assigned_role: owner?.role || 'worker',
        assigned_user_id: ownerId, assigned_user_name: ownerName,
        assigned_user_ids: [ownerId], assigned_user_names: [ownerName],
        due_date: dueDate || null,
        subtasks: JSON.stringify(subtasks), evidence: '[]', comments: '[]',
        escalation: false, created_by: user.name, org: user.org, created_at: now
      }
      const { error: tErr } = await supabase.from('tasks').insert(taskPayload)
      if (tErr) { setErr('Could not create task: ' + tErr.message); setBusy(false); return }
      const { error: aErr } = await supabase.from('incident_actions').insert({
        incident_id: sel.id, org: orgId, description: d, action_type: 'corrective',
        task_id: taskId, owner_id: ownerId, owner_name: ownerName,
        due_date: dueDate || null, status: 'open'
      })
      if (aErr) { setErr('Task created but link failed: ' + aErr.message); setBusy(false); return }
      await supabase.from('incident_events').insert({
        incident_id: sel.id, org: orgId, event_type: 'action_created',
        by_id: uid, by_name: user.name, by_role: user.role,
        to_value: d.slice(0, 60), details: { task_id: taskId, owner: ownerName }
      })
      setDesc(''); setOwnerId(''); setDueDate(''); setEvidence(true)
      if (onDone) await onDone()
    } catch (e) {
      setErr('Unexpected error: ' + (e?.message || e))
    }
    setBusy(false)
  }

  return (
    <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--border)'}}>
      <div style={{fontSize:12,fontWeight:600,marginBottom:6}}>Create a corrective action (becomes a task)</div>
      <div style={{fontSize:11,color:'#DC2626',background:'rgba(220,38,38,.08)',padding:'6px 8px',borderRadius:6,marginBottom:8}}>
        &#9888;&#65039; This title is visible to the assigned worker — do not include incident detail (category, people involved, or clinical information).
      </div>
      <textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder="What needs to be done (worker-safe wording)…"
        style={{width:'100%',minHeight:52,padding:'8px 10px',borderRadius:8,border:'1px solid var(--border2)',background:'var(--card)',color:'var(--text)',boxSizing:'border-box',marginBottom:8}}/>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
        <select value={ownerId} onChange={e=>setOwnerId(e.target.value)} disabled={blocked}
          style={{flex:'1 1 180px',padding:'8px 10px',borderRadius:8,border:'1px solid var(--border2)',background:'var(--card)',color:'var(--text)'}}>
          <option value="">— Assign to —</option>
          {capaStaff.map(m=><option key={m.user_id} value={m.user_id}>{m.name} ({ROLE_LABELS[m.role]||m.role})</option>)}
        </select>
        <input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}
          style={{flex:'0 1 150px',padding:'8px 10px',borderRadius:8,border:'1px solid var(--border2)',background:'var(--card)',color:'var(--text)'}}/>
      </div>
      <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,marginBottom:8,cursor:'pointer'}}>
        <input type="checkbox" checked={evidence} onChange={e=>setEvidence(e.target.checked)}/>
        Require photo evidence
      </label>
      {blocked && <div style={{fontSize:11,color:'#EA580C',marginBottom:8}}>High severity or high risk — a client admin must assign this action.</div>}
      {err && <div style={{fontSize:11,color:'#DC2626',marginBottom:8}}>{err}</div>}
      <button className="btn btn-primary btn-sm" disabled={busy||blocked} onClick={create}>
        {busy?'Creating…':'Create corrective action'}
      </button>
    </div>
  )
}

'''
A4_NEW = COMPONENT + A4
edits.append(("CapaActionForm component", A4, A4_NEW))

# ---- verify all anchors match exactly once BEFORE writing anything ----
for name, anchor, _ in edits:
    c = src.count(anchor)
    if c != 1:
        print(f"ABORT: anchor '{name}' matched {c} times (need exactly 1). No changes written.")
        sys.exit(1)

# all good — apply
for name, anchor, repl in edits:
    src = src.replace(anchor, repl)

if src == orig:
    print("ABORT: no net change. Nothing written.")
    sys.exit(1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(src)
print("OK: CAPA Out move applied — 4 edits (capaStaff state, all-roles fetch, seam->CapaActionForm, component def).")
