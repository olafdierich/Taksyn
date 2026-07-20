// ============ INCIDENT REGISTER (client_admin — compliance artefact) ============
function IncidentRegisterView({ user, setPage }) {
  const [orgId, setOrgId] = useState('')
  const [incidents, setIncidents] = useState([])
  const [names, setNames] = useState({})
  const [actionCounts, setActionCounts] = useState({}) // incident_id -> {open, total}
  const [loading, setLoading] = useState(true)
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [fCategory, setFCategory] = useState('all')
  const [fSeverity, setFSeverity] = useState('all')
  const [fStatus, setFStatus] = useState('all')
  const [breachedOnly, setBreachedOnly] = useState(false)

  const fmtDay = (d) => d ? new Date(d).toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'}) : ''
  const daysBetween = (a,b) => { if(!a) return null; const end=b?new Date(b):new Date(); return Math.max(0, Math.round((end-new Date(a))/86400000)) }

  const resolveOrg = async () => {
    const { data: sess } = await supabase.auth.getSession()
    const authId = sess?.session?.user?.id
    if (!authId) return ''
    const { data: m } = await supabase.from('org_members').select('org').eq('user_id', authId)
    return (m||[]).map(x=>x.org).find(o=>/^ORG/i.test(o||'')) || ''
  }

  const load = async () => {
    if (!isConfigured()) { setLoading(false); return }
    setLoading(true)
    const id = orgId || await resolveOrg()
    if (id && id!==orgId) setOrgId(id)
    if (!id) { setLoading(false); return }
    const { data } = await supabase.from('incidents').select('*').eq('org', id).order('occurred_at',{ascending:false})
    const list = data||[]
    setIncidents(list)
    const ids=[...new Set(list.map(i=>i.assigned_to).filter(Boolean))]
    if(ids.length){ const {data:p}=await supabase.from('profiles').select('id,name').in('id',ids); if(p) setNames(Object.fromEntries(p.map(r=>[r.id,r.name]))) }
    // action counts per incident
    const { data: acts } = await supabase.from('incident_actions').select('incident_id,status').eq('org', id)
    const counts={}; (acts||[]).forEach(a=>{ const c=counts[a.incident_id]||{open:0,total:0}; c.total++; if(a.status!=='verified'&&a.status!=='done') c.open++; counts[a.incident_id]=c })
    setActionCounts(counts)
    setLoading(false)
  }
  useEffect(()=>{ load() },[])

  const targetMet = (i) => {
    // breached if any stamped due date passed without the corresponding milestone
    const now=Date.now(); const overdue=(d)=>d&&new Date(d).getTime()<now
    if(i.status==='closed') {
      // was it closed on time?
      return !(i.close_due_at && i.closed_at && new Date(i.closed_at)>new Date(i.close_due_at))
    }
    return !(overdue(i.assign_due_at)&&!i.assigned_at) && !(overdue(i.investigate_due_at)&&!i.root_cause) && !overdue(i.close_due_at)
  }

  const rows = incidents.filter(i=>{
    if(fFrom && new Date(i.occurred_at) < new Date(fFrom)) return false
    if(fTo && new Date(i.occurred_at) > new Date(fTo+'T23:59:59')) return false
    if(fCategory!=='all' && i.category!==fCategory) return false
    if(fSeverity!=='all' && String(i.severity)!==fSeverity) return false
    if(fStatus!=='all' && i.status!==fStatus) return false
    if(breachedOnly && targetMet(i)) return false
    return true
  })

  // trend strip
  const bySev = [1,2,3,4,5].map(s=>({s,n:rows.filter(i=>i.severity===s).length}))
  const openCount = rows.filter(i=>i.status!=='closed').length
  const breachedCount = rows.filter(i=>!targetMet(i)).length

  const rowData = (i) => {
    const ac = actionCounts[i.id]||{open:0,total:0}
    return {
      ref:i.ref, date:fmtDay(i.occurred_at), category:(INC_CATEGORY_LABEL[i.category]||i.category),
      severity:`${i.severity} ${(INC_SEVERITY_CFG[i.severity]||{}).label||''}`.trim(),
      status:(INC_STATUS_CFG[i.status]||{}).label||i.status,
      affected:i.affected_type||'', assigned:names[i.assigned_to]||i.assigned_to_name||'',
      rootCause:i.root_cause?'Yes':'No', actions:`${ac.total-ac.open}/${ac.total}`,
      closed:i.closed_at?fmtDay(i.closed_at):'', daysOpen:i.status==='closed'?daysBetween(i.occurred_at,i.closed_at):daysBetween(i.occurred_at,null),
      target:targetMet(i)?'Met':'Breached', regulator:i.external_notification_required?(i.notified_at?'Notified':'Required'):'—',
    }
  }

  const exportCSV = () => {
    const head=['Ref','Date','Category','Severity','Status','Affected','Assigned To','Root Cause','Actions Closed/Total','Date Closed','Days Open','Target','Regulator']
    const lines=rows.map(i=>{ const r=rowData(i); return [r.ref,r.date,r.category,r.severity,r.status,r.affected,r.assigned,r.rootCause,r.actions,r.closed,r.daysOpen,r.target,r.regulator].map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',') })
    const csv=[head.join(','),...lines].join('\n')
    const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv)
    a.download=`incident-register-${new Date().toISOString().slice(0,10)}.csv`; a.click()
  }

  const exportPDF = () => {
    const pdf=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'})
    const pw=297, lm=8, top=16
    pdf.setFontSize(14); pdf.text('Incident Register', lm, 10)
    pdf.setFontSize(8)
    pdf.text(`Generated ${new Date().toLocaleString('en-AU')} · ${rows.length} incidents · ${breachedCount} breached`, lm, 14)
    const cols=[['Ref',22],['Date',18],['Category',30],['Severity',22],['Status',20],['Assigned',30],['Root',12],['Actions',16],['Closed',18],['Days',12],['Target',16],['Reg',14]]
    let x=lm; pdf.setFont(undefined,'bold')
    cols.forEach(([h,w])=>{ pdf.text(String(h),x,top); x+=w })
    pdf.setFont(undefined,'normal')
    let y=top+5
    rows.forEach(i=>{
      if(y>200){ pdf.addPage(); y=top }
      const r=rowData(i); let cx=lm
      const cells=[r.ref,r.date,r.category,r.severity,r.status,r.assigned,r.rootCause,r.actions,r.closed,String(r.daysOpen??''),r.target,r.regulator]
      cells.forEach((c,ci)=>{ const w=cols[ci][1]; pdf.text(String(c??'').slice(0,Math.floor(w/1.6)),cx,y); cx+=w })
      y+=5
    })
    pdf.save(`incident-register-${new Date().toISOString().slice(0,10)}.pdf`)
  }

  const openIncident = (ref) => { try{ sessionStorage.setItem('taksyn-open-incident', ref) }catch(e){}; if(setPage) setPage('incidents') }

  const card={background:'var(--card)',border:'1px solid var(--border)',borderRadius:10,padding:14,marginBottom:14}
  const th={textAlign:'left',fontSize:11,fontWeight:700,color:'var(--t2)',padding:'6px 8px',textTransform:'uppercase',letterSpacing:.3,whiteSpace:'nowrap'}
  const td={fontSize:12,padding:'8px',borderTop:'1px solid var(--border)',whiteSpace:'nowrap'}
  const sel={padding:'6px 8px',borderRadius:8,border:'1px solid var(--border2)',background:'var(--card)',color:'var(--text)',fontSize:12}

  return (
    <div className="page-wrap">
      <div className="ph"><div className="ph-title">Incident Register</div><div className="ph-sub">Compliance record of all incidents and their resolution</div></div>

      {/* trend strip */}
      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:14}}>
        <div style={{...card,margin:0,flex:'1 1 120px'}}><div style={{fontSize:11,color:'var(--t2)'}}>Total (filtered)</div><div style={{fontSize:22,fontWeight:800}}>{rows.length}</div></div>
        <div style={{...card,margin:0,flex:'1 1 120px'}}><div style={{fontSize:11,color:'var(--t2)'}}>Open</div><div style={{fontSize:22,fontWeight:800,color:openCount?'var(--amber)':'var(--t3)'}}>{openCount}</div></div>
        <div style={{...card,margin:0,flex:'1 1 120px'}}><div style={{fontSize:11,color:'var(--t2)'}}>Target breached</div><div style={{fontSize:22,fontWeight:800,color:breachedCount?'var(--red)':'var(--green)'}}>{breachedCount}</div></div>
        <div style={{...card,margin:0,flex:'2 1 240px'}}>
          <div style={{fontSize:11,color:'var(--t2)',marginBottom:6}}>By severity</div>
          <div style={{display:'flex',gap:6,alignItems:'flex-end',height:36}}>
            {bySev.map(({s,n})=>{ const mx=Math.max(1,...bySev.map(b=>b.n)); const c=(INC_SEVERITY_CFG[s]||{}).color||'var(--brand)'
              return <div key={s} style={{flex:1,textAlign:'center'}} title={`Severity ${s}: ${n}`}>
                <div style={{height:Math.round((n/mx)*28)+2,background:c,borderRadius:3}}/>
                <div style={{fontSize:9,color:'var(--t3)',marginTop:2}}>{s}·{n}</div>
              </div> })}
          </div>
        </div>
      </div>

      {/* filters + export */}
      <div style={{...card,display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
        <div><div style={{fontSize:10,color:'var(--t3)'}}>From</div><input type="date" style={sel} value={fFrom} onChange={e=>setFFrom(e.target.value)}/></div>
        <div><div style={{fontSize:10,color:'var(--t3)'}}>To</div><input type="date" style={sel} value={fTo} onChange={e=>setFTo(e.target.value)}/></div>
        <div><div style={{fontSize:10,color:'var(--t3)'}}>Category</div>
          <select style={sel} value={fCategory} onChange={e=>setFCategory(e.target.value)}>
            <option value="all">All</option>{Object.entries(INC_CATEGORY_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><div style={{fontSize:10,color:'var(--t3)'}}>Severity</div>
          <select style={sel} value={fSeverity} onChange={e=>setFSeverity(e.target.value)}>
            <option value="all">All</option>{[1,2,3,4,5].map(s=><option key={s} value={String(s)}>{s} {(INC_SEVERITY_CFG[s]||{}).label}</option>)}
          </select></div>
        <div><div style={{fontSize:10,color:'var(--t3)'}}>Status</div>
          <select style={sel} value={fStatus} onChange={e=>setFStatus(e.target.value)}>
            <option value="all">All</option>{Object.entries(INC_STATUS_CFG).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
          </select></div>
        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--t2)',cursor:'pointer',marginTop:12}}>
          <input type="checkbox" checked={breachedOnly} onChange={e=>setBreachedOnly(e.target.checked)}/> Breached only
        </label>
        <div style={{flex:1}}/>
        <button className="btn btn-secondary btn-sm" style={{marginTop:12}} onClick={exportCSV}>📥 CSV</button>
        <button className="btn btn-secondary btn-sm" style={{marginTop:12}} onClick={exportPDF}>📄 PDF</button>
      </div>

      {/* table */}
      {loading ? <div style={{color:'var(--t2)',fontSize:13}}>Loading…</div> :
        rows.length===0 ? <div className="empty"><div className="empty-icon">📋</div><div className="empty-text">No incidents match these filters</div></div> :
        <div style={{overflowX:'auto',border:'1px solid var(--border)',borderRadius:10}}>
          <table style={{width:'100%',borderCollapse:'collapse',minWidth:900}}>
            <thead><tr>
              {['Ref','Date','Category','Severity','Status','Assigned','Root cause','Actions','Closed','Days open','Target','Regulator'].map(h=><th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(i=>{ const r=rowData(i)
                return <tr key={i.id} style={{cursor:'pointer'}} onClick={()=>openIncident(i.ref)}>
                  <td style={{...td,fontWeight:700,color:'var(--brand)'}}>{r.ref}</td>
                  <td style={td}>{r.date}</td>
                  <td style={td}>{r.category}</td>
                  <td style={{...td,color:(INC_SEVERITY_CFG[i.severity]||{}).color}}>{r.severity}</td>
                  <td style={td}>{r.status}</td>
                  <td style={td}>{r.assigned||'—'}</td>
                  <td style={td}>{r.rootCause}</td>
                  <td style={td}>{r.actions}</td>
                  <td style={td}>{r.closed||'—'}</td>
                  <td style={td}>{r.daysOpen??'—'}</td>
                  <td style={{...td,fontWeight:700,color:r.target==='Met'?'var(--green)':'var(--red)'}}>{r.target}</td>
                  <td style={td}>{r.regulator}</td>
                </tr> })}
            </tbody>
          </table>
        </div>}
    </div>
  )
}
