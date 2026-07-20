// ============ INCIDENT MANAGEMENT (client_admin) ============
const INC_SEVERITY_CFG = {
  1: { label:'Minor',    color:'var(--green)', bg:'var(--brand-lt)' },
  2: { label:'Moderate', color:'var(--blue)',  bg:'var(--brand-lt)' },
  3: { label:'Major',    color:'var(--amber)', bg:'var(--brand-lt)' },
  4: { label:'Severe',   color:'var(--red)',   bg:'var(--brand-lt)' },
  5: { label:'Critical', color:'var(--red)',   bg:'rgba(239,68,68,.14)' },
}
const INC_STATUS_CFG = {
  reported:      { label:'Reported',      color:'var(--amber)' },
  assessing:     { label:'Assessing',     color:'var(--blue)' },
  investigating: { label:'Investigating', color:'var(--blue)' },
  actions_open:  { label:'Actions Open',  color:'var(--blue)' },
  review:        { label:'In Review',     color:'var(--brand)' },
  closed:        { label:'Closed',        color:'var(--t3)' },
}
const INC_CATEGORY_LABEL = {
  injury_harm:'Injury / Harm', near_miss:'Near miss', property_damage:'Property damage',
  complaint:'Complaint', service_quality:'Service quality', clinical_care:'Clinical / Care',
  behaviour_safeguarding:'Behaviour / Safeguarding', medication:'Medication',
  infection_control:'Infection control', security:'Security', privacy_breach:'Privacy / Data breach',
  environmental:'Environmental', equipment_failure:'Equipment failure', vehicle:'Vehicle', other:'Other',
}
const INC_EVENT_LABEL = {
  reported:'Reported', severity_set:'Severity set', severity_overridden:'Severity overridden',
  assigned:'Assigned', reassigned:'Reassigned', notified:'Notified', assessed:'Assessed',
  investigation_started:'Investigation started', root_cause_recorded:'Root cause recorded',
  risk_rated:'Risk rated', action_created:'Action created', action_completed:'Action completed',
  action_verified:'Action verified', regulator_notified:'Regulator notified',
  reopened:'Reopened', closed:'Closed', status_changed:'Status changed',
}

function IncidentsAdminView({ user }) {
  const [orgId, setOrgId] = useState('')
  const [incidents, setIncidents] = useState([])
  const [names, setNames] = useState({})
  const [members, setMembers] = useState([]) // [{user_id,role,name}]
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('open')
  const [breachedOnly, setBreachedOnly] = useState(false)
  const [sel, setSel] = useState(null)          // selected incident (full row)
  const [events, setEvents] = useState([])
  const [actions, setActions] = useState([])
  const [busy, setBusy] = useState(false)

  const fmtDate = (d) => d ? new Date(d).toLocaleString('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'
  const fmtDay  = (d) => d ? new Date(d).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}) : '—'

  // resolve org ID (incidents.org holds the ID, not user.org which is the NAME)
  const resolveOrg = async () => {
    const { data: sess } = await supabase.auth.getSession()
    const authId = sess?.session?.user?.id
    if (!authId) return ''
    const { data: m } = await supabase.from('org_members').select('org').eq('user_id', authId)
    return (m||[]).map(x=>x.org).find(o => /^ORG/i.test(o||'')) || ''
  }

  const load = async () => {
    if (!isConfigured()) { setLoading(false); return }
    setLoading(true)
    const id = orgId || await resolveOrg()
    if (id && id !== orgId) setOrgId(id)
    if (!id) { setLoading(false); return }
    const { data } = await supabase.from('incidents').select('*').eq('org', id).order('created_at',{ascending:false})
    const list = data || []
    setIncidents(list)
    // resolve names for reporters/assignees/investigators
    const ids = [...new Set(list.flatMap(i=>[i.reported_by,i.assigned_to,i.investigator_id]).filter(Boolean))]
    if (ids.length) {
      const { data: p } = await supabase.from('profiles').select('id,name').in('id', ids)
      if (p) setNames(Object.fromEntries(p.map(r=>[r.id,r.name])))
    }
    // org members for the assignee picker (supervisor/manager/client_admin only)
    const { data: mem } = await supabase.from('org_members').select('user_id,role').eq('org', id)
    if (mem) {
      const memIds = mem.map(m=>m.user_id)
      const { data: mp } = await supabase.from('profiles').select('id,name').in('id', memIds)
      const nameMap = Object.fromEntries((mp||[]).map(r=>[r.id,r.name]))
      setMembers(mem.filter(m=>['supervisor','manager','client_admin'].includes(m.role))
        .map(m=>({ ...m, name: nameMap[m.user_id]||'—' })))
    }
    setLoading(false)
  }
  useEffect(()=>{ load() },[])

  const openIncident = async (inc) => {
    setSel(inc); setEvents([]); setActions([])
    const [{ data: ev }, { data: act }] = await Promise.all([
      supabase.from('incident_events').select('*').eq('incident_id', inc.id).order('at',{ascending:false}),
      supabase.from('incident_actions').select('*').eq('incident_id', inc.id).order('created_at',{ascending:true}),
    ])
    setEvents(ev||[]); setActions(act||[])
  }

  // write helper: patch the incident AND append an audit event, then refresh
  const patchIncident = async (patch, eventType, extra={}) => {
    if (!sel) return
    setBusy(true)
    const { data: sess } = await supabase.auth.getSession()
    const uid = sess?.session?.user?.id
    const now = new Date().toISOString()
    const { error: upErr } = await supabase.from('incidents')
      .update({ ...patch, updated_at: now }).eq('id', sel.id)
    if (!upErr) {
      await supabase.from('incident_events').insert({
        incident_id: sel.id, org: orgId, event_type: eventType,
        by_id: uid, by_name: user.name, by_role: user.role,
        from_value: extra.from ?? null, to_value: extra.to ?? null, details: extra.details ?? null,
      })
      const updated = { ...sel, ...patch }
      setSel(updated)
      setIncidents(prev=>prev.map(i=>i.id===sel.id?updated:i))
      const { data: ev } = await supabase.from('incident_events').select('*').eq('incident_id', sel.id).order('at',{ascending:false})
      setEvents(ev||[])
    } else {
      alert('Could not save: ' + upErr.message)
    }
    setBusy(false)
  }

  // ---- derived list ----
  const isOpenStatus = (s) => s !== 'closed'
  const breached = (i) => {
    const now = Date.now()
    const overdue = (d) => d && new Date(d).getTime() < now
    if (i.status==='closed') return false
    return overdue(i.assign_due_at) && !i.assigned_at
        || overdue(i.investigate_due_at) && !i.root_cause
        || overdue(i.close_due_at)
  }
  const visible = incidents.filter(i => {
    if (filterStatus==='open' && !isOpenStatus(i.status)) return false
    if (filterStatus!=='open' && filterStatus!=='all' && i.status!==filterStatus) return false
    if (breachedOnly && !breached(i)) return false
    return true
  })
  const bySeverity = [5,4,3,2,1].map(s => ({ s, items: visible.filter(i=>i.severity===s) })).filter(g=>g.items.length)

  const card = { background:'var(--card)', border:'1px solid var(--border)', borderRadius:10, padding:16, marginBottom:14 }
  const lbl = { display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6, textTransform:'uppercase', letterSpacing:.3 }
  const pill = (color,bg) => ({ fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:12, background:bg||'var(--brand-lt)', color, flexShrink:0 })

  // ============ DETAIL ============
  if (sel) {
    const sev = INC_SEVERITY_CFG[sel.severity] || INC_SEVERITY_CFG[1]
    const st  = INC_STATUS_CFG[sel.status] || INC_STATUS_CFG.reported
    const clinical = sel.clinical || {}
    return (
      <div className="page-wrap anim">
        <button className="btn btn-secondary btn-sm" style={{marginBottom:16}} onClick={()=>{setSel(null); load()}}>← Back to incidents</button>

        {/* header */}
        <div style={card}>
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:8}}>
            <span style={{fontSize:18,fontWeight:800}}>{sel.ref}</span>
            <span style={pill(sev.color,sev.bg)}>{sel.severity} · {sev.label}</span>
            <span style={pill(st.color)}>{st.label}</span>
            {breached(sel) && <span style={pill('#fff','var(--red)')}>⚠ Target breached</span>}
          </div>
          <div style={{fontSize:13,color:'var(--t2)'}}>
            {INC_CATEGORY_LABEL[sel.category]||sel.category} · {fmtDate(sel.occurred_at)}
            {sel.department && ' · '+sel.department}{sel.location_text && ' · '+sel.location_text}
            {sel.gps && ` · 📍 ${sel.gps.lat},${sel.gps.lng}`}
          </div>
        </div>

        {/* who is responsible */}
        <div style={card}>
          <span style={lbl}>Who is responsible</span>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div>
              <div style={{fontSize:12,color:'var(--t3)'}}>Assigned owner</div>
              <select className="inp" value={sel.assigned_to||''} disabled={busy}
                onChange={e=>{
                  const uid=e.target.value; const m=members.find(x=>x.user_id===uid)
                  patchIncident({ assigned_to:uid||null, assigned_to_name:m?.name||null, assigned_role:m?.role||null, assigned_at:new Date().toISOString() },
                    sel.assigned_to?'reassigned':'assigned', { from: names[sel.assigned_to]||null, to: m?.name||null })
                }}
                style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1px solid var(--border2)',background:'var(--card)',color:'var(--text)',marginTop:4}}>
                <option value="">— unassigned —</option>
                {members.map(m=><option key={m.user_id} value={m.user_id}>{m.name} ({m.role})</option>)}
              </select>
            </div>
            <div>
              <div style={{fontSize:12,color:'var(--t3)'}}>Investigator</div>
              <select value={sel.investigator_id||''} disabled={busy}
                onChange={e=>{
                  const uid=e.target.value; const m=members.find(x=>x.user_id===uid)
                  patchIncident({ investigator_id:uid||null, investigator_name:m?.name||null },
                    'assigned', { to: m?.name||null, details:{role:'investigator'} })
                }}
                style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1px solid var(--border2)',background:'var(--card)',color:'var(--text)',marginTop:4}}>
                <option value="">— none —</option>
                {members.map(m=><option key={m.user_id} value={m.user_id}>{m.name} ({m.role})</option>)}
              </select>
            </div>
          </div>
          <div style={{fontSize:11,color:'var(--t3)',marginTop:10}}>
            Reported by {names[sel.reported_by]||'a team member'} · {fmtDate(sel.created_at)}
          </div>
        </div>

        {/* what happened */}
        <div style={card}>
          <span style={lbl}>What happened</span>
          <div style={{fontSize:14,lineHeight:1.5,whiteSpace:'pre-wrap',marginBottom:10}}>{sel.facts}</div>
          {sel.immediate_actions && <><span style={lbl}>Immediate actions taken</span>
            <div style={{fontSize:14,marginBottom:10}}>{sel.immediate_actions}</div></>}
          {sel.hazard_present && <div style={{...pill('#fff','var(--red)'),display:'inline-block',marginBottom:8}}>⚠ Hazard still present</div>}
          {(sel.affected_type||sel.affected_initials) &&
            <div style={{fontSize:13,color:'var(--t2)'}}>Affected: {sel.affected_type||'—'}{sel.affected_initials?` (${sel.affected_initials})`:''}</div>}
        </div>

        {/* clinical block — client_admin only (need to know) */}
        {(sel.harm_type || Object.keys(clinical).length>0) && (
          <div style={{...card,borderColor:'var(--amber)'}}>
            <span style={lbl}>Clinical details</span>
            {sel.harm_type && <div style={{fontSize:13,marginBottom:4}}>Harm type: {sel.harm_type.replace(/_/g,' ')}</div>}
            {sel.outcome_level && <div style={{fontSize:13,marginBottom:4}}>Outcome level: {sel.outcome_level}/8</div>}
            {clinical.note && <div style={{fontSize:14,whiteSpace:'pre-wrap'}}>{clinical.note}</div>}
          </div>
        )}

        {/* investigation + risk */}
        <div style={card}>
          <span style={lbl}>Investigation</span>
          <textarea defaultValue={sel.root_cause||''} placeholder="Root cause…" id="inc-rootcause"
            style={{width:'100%',minHeight:70,padding:'10px',borderRadius:8,border:'1px solid var(--border2)',background:'var(--card)',color:'var(--text)',boxSizing:'border-box',marginBottom:8}}/>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>{
            const v=document.getElementById('inc-rootcause').value.trim()
            patchIncident({ root_cause:v||null }, 'root_cause_recorded', { to: v?'recorded':null })
          }}>Save root cause</button>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginTop:14}}>
            <div>
              <div style={{fontSize:12,color:'var(--t3)',marginBottom:4}}>Likelihood (1–5)</div>
              <select id="inc-likelihood" defaultValue={sel.risk_likelihood||''}
                style={{width:'100%',padding:'8px',borderRadius:8,border:'1px solid var(--border2)',background:'var(--card)',color:'var(--text)'}}>
                <option value="">—</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <div style={{fontSize:12,color:'var(--t3)',marginBottom:4}}>Consequence (1–5)</div>
              <select id="inc-consequence" defaultValue={sel.risk_consequence||''}
                style={{width:'100%',padding:'8px',borderRadius:8,border:'1px solid var(--border2)',background:'var(--card)',color:'var(--text)'}}>
                <option value="">—</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" style={{marginTop:8}} disabled={busy} onClick={()=>{
            const l=+document.getElementById('inc-likelihood').value||null
            const c=+document.getElementById('inc-consequence').value||null
            const rating=(l&&c)?l*c:null
            patchIncident({ risk_likelihood:l, risk_consequence:c, risk_rating:rating },
              'risk_rated', { to: rating?String(rating):null, details:{likelihood:l,consequence:c} })
          }}>Save risk rating</button>
          {sel.risk_rating && <div style={{marginTop:8,fontSize:13}}>Risk rating: <strong>{sel.risk_rating}</strong> ({sel.risk_likelihood}×{sel.risk_consequence})</div>}
        </div>

        {/* corrective actions (display + simple add; task-linking is a later branch) */}
        <div style={card}>
          <span style={lbl}>Corrective / preventive actions</span>
          {actions.length===0 && <div style={{fontSize:13,color:'var(--t3)',marginBottom:8}}>No actions yet.</div>}
          {actions.map(a=>(
            <div key={a.id} style={{padding:'8px 0',borderBottom:'1px solid var(--border)',fontSize:13}}>
              <div style={{fontWeight:600}}>{a.description}</div>
              <div style={{fontSize:11,color:'var(--t3)'}}>
                {a.action_type} · {a.status}{a.owner_name?` · ${a.owner_name}`:''}{a.due_date?` · due ${fmtDay(a.due_date)}`:''}
              </div>
            </div>
          ))}
          <div style={{display:'flex',gap:8,marginTop:10}}>
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
          </div>
        </div>

        {/* lifecycle */}
        <div style={card}>
          <span style={lbl}>Status</span>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {sel.status!=='closed' && [
              ['assessing','Mark assessing'],['investigating','Start investigation'],
              ['actions_open','Actions open'],['review','Move to review'],
            ].map(([s,l])=>(
              <button key={s} className="btn btn-secondary btn-sm" disabled={busy||sel.status===s}
                onClick={()=>patchIncident({ status:s }, s==='investigating'?'investigation_started':'status_changed',
                  { from: sel.status, to: s })}>{l}</button>
            ))}
            {sel.status!=='closed'
              ? <button className="btn btn-primary btn-sm" disabled={busy} onClick={()=>{
                  const note=prompt('Closure note (what resolved this incident?)')
                  if(note===null) return
                  patchIncident({ status:'closed', closed_at:new Date().toISOString(), closure_note:note||null },
                    'closed', { from: sel.status, to:'closed', details:{note} })
                }}>Close incident</button>
              : <button className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>
                  patchIncident({ status:'review', closed_at:null }, 'reopened', { from:'closed', to:'review' })
                }>Reopen</button>}
          </div>
          {sel.closure_note && <div style={{fontSize:13,color:'var(--t2)',marginTop:8}}>Closure: {sel.closure_note}</div>}
        </div>

        {/* audit timeline */}
        <div style={card}>
          <span style={lbl}>Timeline (audit trail)</span>
          {events.length===0 ? <div style={{fontSize:13,color:'var(--t3)'}}>No events.</div> :
            events.map(ev=>(
              <div key={ev.id} style={{display:'flex',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                <div style={{width:8,height:8,borderRadius:4,background:'var(--brand)',marginTop:5,flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600}}>{INC_EVENT_LABEL[ev.event_type]||ev.event_type}
                    {ev.from_value&&ev.to_value&&<span style={{fontWeight:400,color:'var(--t2)'}}> · {ev.from_value} → {ev.to_value}</span>}
                    {!ev.from_value&&ev.to_value&&<span style={{fontWeight:400,color:'var(--t2)'}}> · {ev.to_value}</span>}
                  </div>
                  <div style={{fontSize:11,color:'var(--t3)'}}>{ev.by_name||'—'} ({ev.by_role||'—'}) · {fmtDate(ev.at)}</div>
                </div>
              </div>
            ))}
        </div>
      </div>
    )
  }

  // ============ LIST ============
  return (
    <div className="page-wrap">
      <div className="ph"><div className="ph-title">Incidents</div><div className="ph-sub">Reported incidents and their resolution</div></div>
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
        {[['open','Open'],['reported','Reported'],['investigating','Investigating'],['review','Review'],['closed','Closed'],['all','All']].map(([v,l])=>(
          <button key={v} onClick={()=>setFilterStatus(v)} style={{padding:'6px 14px',borderRadius:20,border:`2px solid ${filterStatus===v?'var(--brand)':'var(--border)'}`,background:filterStatus===v?'var(--brand-lt)':'none',color:filterStatus===v?'var(--brand)':'var(--t2)',fontWeight:filterStatus===v?700:400,cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>{l}</button>
        ))}
        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--t2)',marginLeft:6,cursor:'pointer'}}>
          <input type="checkbox" checked={breachedOnly} onChange={e=>setBreachedOnly(e.target.checked)}/> Breached only
        </label>
      </div>

      {loading ? <div style={{color:'var(--t2)',fontSize:13}}>Loading…</div> :
        bySeverity.length===0 ? <div className="empty"><div className="empty-icon">✅</div><div className="empty-text">No incidents</div></div> :
        bySeverity.map(({s,items})=>{
          const sc = INC_SEVERITY_CFG[s]
          return (
            <div key={s} style={{marginBottom:24}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                <span style={{fontSize:13,fontWeight:700,color:sc.color}}>{s} · {sc.label}</span>
                <span style={{fontSize:11,color:'var(--t2)'}}>({items.length})</span>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {items.map(inc=>{
                  const st = INC_STATUS_CFG[inc.status]||INC_STATUS_CFG.reported
                  return (
                    <div key={inc.id} onClick={()=>openIncident(inc)}
                      style={{background:'var(--card)',borderRadius:10,border:`1px solid ${breached(inc)?'var(--red)':'var(--border)'}`,padding:'14px 16px',cursor:'pointer'}}>
                      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:4}}>
                        <span style={{fontWeight:700}}>{inc.ref}</span>
                        <span style={pill(st.color)}>{st.label}</span>
                        {breached(inc) && <span style={pill('#fff','var(--red)')}>⚠ Breached</span>}
                      </div>
                      <div style={{fontSize:13,color:'var(--t2)',marginBottom:4}}>{INC_CATEGORY_LABEL[inc.category]||inc.category}</div>
                      <div style={{fontSize:11,color:'var(--t3)',display:'flex',gap:10,flexWrap:'wrap'}}>
                        <span>📅 {fmtDay(inc.occurred_at)}</span>
                        {inc.affected_type && <span>👤 {inc.affected_type}</span>}
                        <span>{inc.assigned_to ? '→ '+(names[inc.assigned_to]||inc.assigned_to_name||'assigned') : 'unassigned'}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })
      }
    </div>
  )
}
