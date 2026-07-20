// ============ INCIDENT REPORTING ============
function IncidentReportView({ user }) {
  const CATEGORIES = [
    ['injury_harm','🩹 Injury / Harm to a person','Someone was hurt — physical, infection/illness, or mental/psychological'],
    ['near_miss','⚠️ Near miss','No harm or damage occurred, but it could have'],
    ['property_damage','🔧 Property / equipment damage','Damage to property, equipment, vehicle or environment'],
    ['other','📋 Other','Complaint, security, service quality or anything else'],
  ]
  // outcome ladder -> suggested severity (1-5)
  const OUTCOMES = [
    [1,'No treatment needed',1],
    [2,'First aid only',2],
    [3,'Seen by GP / clinic, no admission',3],
    [4,'Antibiotics commenced',3],
    [5,'Hospital presentation, no admission',3],
    [6,'Hospital admission',4],
    [7,'ICU / life-threatening / permanent harm',5],
    [8,'Death',5],
  ]
  const SEVERITY = [
    [1,'Minor','No injury or negligible impact'],
    [2,'Moderate','First aid, moderate damage, complaint needing investigation'],
    [3,'Major','Medical treatment, significant damage, serious disruption'],
    [4,'Severe','Serious injury, hospitalisation, safeguarding, major breach'],
    [5,'Critical','Fatality, life-threatening, abuse/neglect, catastrophic'],
  ]
  const HARM_TYPES = [
    ['physical','Physical injury'],
    ['infection_illness','Infection / illness'],
    ['mental_psychological','Mental / psychological harm'],
  ]

  const [orgId, setOrgId] = useState('')
  const [orgResolved, setOrgResolved] = useState(false)
  const [category, setCategory] = useState('')
  const [harmType, setHarmType] = useState('')
  const [outcome, setOutcome] = useState(0)
  const [severity, setSeverity] = useState(0)
  const [overrideReason, setOverrideReason] = useState('')
  const [affectedType, setAffectedType] = useState('')
  const [affectedInitials, setAffectedInitials] = useState('')
  const [occurredAt, setOccurredAt] = useState(() => {
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,16)
  })
  const [shift, setShift] = useState('')
  const [department, setDepartment] = useState('')
  const [locationText, setLocationText] = useState('')
  const [gps, setGps] = useState(null)
  const [facts, setFacts] = useState('')
  const [immediateActions, setImmediateActions] = useState('')
  const [hazardPresent, setHazardPresent] = useState(false)
  const [clinicalNote, setClinicalNote] = useState('')
  const [evidence, setEvidence] = useState([]) // {kind,url,name}
  const [submitting, setSubmitting] = useState(false)
  const [receipt, setReceipt] = useState(null) // {ref}
  const [error, setError] = useState('')

  // Resolve org ID (ORG...) from org_members — never the org name (gremlin-safe)
  useEffect(() => {
    ;(async()=>{
      try {
        const { data: sess } = await supabase.auth.getSession()
        const authId = sess?.session?.user?.id
        if (!authId) { setOrgResolved(true); return }
        const { data: members } = await supabase.from('org_members').select('org').eq('user_id', authId)
        const id = (members||[]).map(m=>m.org).find(o => /^ORG/i.test(o||''))
        if (id) setOrgId(id)
      } catch(e) { /* leave blank -> guarded below */ }
      setOrgResolved(true)
    })()
  }, [])

  // suggested severity from the outcome ladder (harm categories only)
  const suggested = outcome ? (OUTCOMES.find(o=>o[0]===outcome)||[])[2] : 0

  const grabGps = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      p => setGps({ lat:+p.coords.latitude.toFixed(5), lng:+p.coords.longitude.toFixed(5) }),
      () => setGps(null), { enableHighAccuracy:true, timeout:8000, maximumAge:0 })
  }

  const isHarm = category==='injury_harm'
  const showLadder = isHarm || category==='near_miss'
  const effectiveSeverity = severity || suggested
  const overrideNeeded = severity && suggested && severity !== suggested

  const canSubmit = category && effectiveSeverity && facts.trim() && occurredAt &&
    (!isHarm || (harmType && affectedType)) &&
    (!overrideNeeded || overrideReason.trim())

  const submit = async () => {
    setError('')
    if (!orgId) { setError('Could not resolve your organisation. Please contact your administrator.'); return }
    if (!canSubmit) { setError('Please complete the required fields.'); return }
    setSubmitting(true)
    const payload = {
      severity_suggested: suggested || null,
      severity_override_reason: overrideNeeded ? overrideReason.trim() : null,
      shift: shift||null, department: department||null, location_text: locationText||null,
      gps: gps||null, immediate_actions: immediateActions||null, hazard_present: hazardPresent,
      affected_type: affectedType||null, affected_initials: affectedInitials||null,
      outcome_level: outcome||null, harm_type: isHarm ? harmType : null,
      clinical: (isHarm && clinicalNote.trim()) ? { note: clinicalNote.trim() } : null,
    }
    try {
      const { data, error: rpcErr } = await supabase.rpc('create_incident', {
        p_org: orgId,
        p_category: category,
        p_severity: effectiveSeverity,
        p_occurred_at: new Date(occurredAt).toISOString(),
        p_facts: facts.trim(),
        p_payload: payload,
        p_evidence: evidence.map(e => ({ kind:e.kind, url:e.url, name:e.name||null })),
      })
      if (rpcErr) throw rpcErr
      setReceipt({ ref: data?.ref || 'submitted' })
    } catch(e) {
      setError('Could not submit the report: ' + (e.message||'unknown error'))
    }
    setSubmitting(false)
  }

  if (receipt) {
    return (
      <div style={{maxWidth:560,margin:'40px auto',textAlign:'center',padding:24}}>
        <div style={{fontSize:48,marginBottom:12}}>✅</div>
        <h2 style={{margin:'0 0 8px'}}>Incident reported</h2>
        <p style={{color:'#6B7280',margin:'0 0 4px'}}>Reference</p>
        <p style={{fontSize:22,fontWeight:700,letterSpacing:.5,margin:'0 0 16px'}}>{receipt.ref}</p>
        <p style={{color:'#6B7280',fontSize:14,lineHeight:1.5}}>
          Your report has been sent to management for review. For confidentiality, incident
          details are visible only to the people responsible for handling it — you won't see
          the report after this screen. If you need to add something, tell your supervisor
          and quote the reference above.
        </p>
        <button className="cl-action-btn" style={{marginTop:20}} onClick={()=>{
          setReceipt(null); setCategory(''); setHarmType(''); setOutcome(0); setSeverity(0)
          setOverrideReason(''); setAffectedType(''); setAffectedInitials(''); setShift('')
          setDepartment(''); setLocationText(''); setGps(null); setFacts(''); setImmediateActions('')
          setHazardPresent(false); setClinicalNote(''); setEvidence([])
        }}>Report another incident</button>
      </div>
    )
  }

  const card = { background:'var(--card,#fff)', border:'1px solid rgba(0,0,0,.08)', borderRadius:12, padding:16, marginBottom:14 }
  const lbl = { display:'block', fontSize:13, fontWeight:600, marginBottom:6 }
  const inp = { width:'100%', padding:'10px 12px', borderRadius:8, border:'1px solid rgba(0,0,0,.15)', fontSize:14, boxSizing:'border-box' }

  return (
    <div style={{maxWidth:640,margin:'0 auto',padding:'8px 4px 60px'}}>
      <h2 style={{margin:'4px 0 4px'}}>Report an Incident</h2>
      <p style={{color:'#6B7280',fontSize:13,margin:'0 0 16px'}}>
        Report any accident, near miss, damage, complaint or other event. Your report goes
        straight to management.
      </p>

      {/* Step 1 — category */}
      <div style={card}>
        <span style={lbl}>What happened?</span>
        {CATEGORIES.map(([k,title,sub]) => (
          <button key={k} onClick={()=>{setCategory(k); setHarmType(''); setOutcome(0); setSeverity(0)}}
            style={{display:'block',width:'100%',textAlign:'left',padding:'12px 14px',marginBottom:8,borderRadius:10,
              border: category===k ? '2px solid var(--brand,#4F46E5)' : '1px solid rgba(0,0,0,.12)',
              background: category===k ? 'rgba(79,70,229,.06)' : 'transparent', cursor:'pointer'}}>
            <div style={{fontWeight:600,fontSize:14}}>{title}</div>
            <div style={{fontSize:12,color:'#6B7280',marginTop:2}}>{sub}</div>
          </button>
        ))}
      </div>

      {category && (<>
        {/* Harm fork */}
        {isHarm && (
          <div style={card}>
            <span style={lbl}>Type of harm</span>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
              {HARM_TYPES.map(([k,t]) => (
                <button key={k} onClick={()=>setHarmType(k)}
                  style={{padding:'8px 12px',borderRadius:20,fontSize:13,cursor:'pointer',
                    border: harmType===k ? '2px solid var(--brand,#4F46E5)' : '1px solid rgba(0,0,0,.15)',
                    background: harmType===k ? 'rgba(79,70,229,.06)' : 'transparent'}}>{t}</button>
              ))}
            </div>
            <span style={lbl}>Who was affected?</span>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
              {['staff','client','visitor','contractor'].map(t => (
                <button key={t} onClick={()=>setAffectedType(t)}
                  style={{padding:'8px 12px',borderRadius:20,fontSize:13,textTransform:'capitalize',cursor:'pointer',
                    border: affectedType===t ? '2px solid var(--brand,#4F46E5)' : '1px solid rgba(0,0,0,.15)',
                    background: affectedType===t ? 'rgba(79,70,229,.06)' : 'transparent'}}>{t}</button>
              ))}
            </div>
            <span style={lbl}>Person's initials <span style={{fontWeight:400,color:'#9CA3AF'}}>(not full name — confidential)</span></span>
            <input style={inp} value={affectedInitials} maxLength={6} placeholder="e.g. J.D."
              onChange={e=>setAffectedInitials(e.target.value)}/>
          </div>
        )}

        {/* Outcome ladder */}
        {showLadder && (
          <div style={card}>
            <span style={lbl}>{isHarm ? 'What was the outcome?' : 'What could have happened?'}</span>
            <select style={inp} value={outcome} onChange={e=>{setOutcome(+e.target.value); setSeverity(0)}}>
              <option value={0}>— select —</option>
              {OUTCOMES.map(([v,t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            {suggested>0 && (
              <div style={{marginTop:10,fontSize:13,padding:'8px 12px',borderRadius:8,background:'rgba(79,70,229,.06)'}}>
                Suggested severity: <strong>{suggested} – {SEVERITY[suggested-1][1]}</strong>
                {isHarm && ' — you can adjust below if needed.'}
              </div>
            )}
          </div>
        )}

        {/* Severity (always shown; pre-set from ladder) */}
        <div style={card}>
          <span style={lbl}>Severity</span>
          {SEVERITY.map(([v,name,desc]) => {
            const sel = effectiveSeverity===v
            return (
              <button key={v} onClick={()=>setSeverity(v)}
                style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',marginBottom:6,borderRadius:8,cursor:'pointer',
                  border: sel ? '2px solid var(--brand,#4F46E5)' : '1px solid rgba(0,0,0,.12)',
                  background: sel ? 'rgba(79,70,229,.06)' : 'transparent'}}>
                <span style={{fontWeight:600}}>{v} – {name}</span>
                <span style={{fontSize:12,color:'#6B7280',display:'block'}}>{desc}</span>
              </button>
            )
          })}
          {overrideNeeded && (
            <div style={{marginTop:8}}>
              <span style={lbl}>Reason for changing from the suggested severity ({suggested})</span>
              <input style={inp} value={overrideReason} onChange={e=>setOverrideReason(e.target.value)}
                placeholder="Why is a different severity appropriate?"/>
            </div>
          )}
        </div>

        {/* Clinical note (harm only) */}
        {isHarm && (
          <div style={card}>
            <span style={lbl}>Clinical details <span style={{fontWeight:400,color:'#9CA3AF'}}>(optional — antibiotics, hospital, organism, etc.)</span></span>
            <textarea style={{...inp,minHeight:70,resize:'vertical'}} value={clinicalNote}
              onChange={e=>setClinicalNote(e.target.value)}
              placeholder="e.g. Amoxicillin commenced, admitted to St X Hospital"/>
          </div>
        )}

        {/* Common tail */}
        <div style={card}>
          <span style={lbl}>When did it happen?</span>
          <input type="datetime-local" style={{...inp,marginBottom:12}} value={occurredAt} onChange={e=>setOccurredAt(e.target.value)}/>
          <span style={lbl}>Shift <span style={{fontWeight:400,color:'#9CA3AF'}}>(optional)</span></span>
          <input style={{...inp,marginBottom:12}} value={shift} onChange={e=>setShift(e.target.value)} placeholder="e.g. Night"/>
          <span style={lbl}>Department / area</span>
          <input style={{...inp,marginBottom:12}} value={department} onChange={e=>setDepartment(e.target.value)} placeholder="e.g. Ward 2"/>
          <span style={lbl}>Exact place</span>
          <input style={{...inp,marginBottom:12}} value={locationText} onChange={e=>setLocationText(e.target.value)} placeholder="e.g. Bathroom, room 14"/>
          <button className="cl-action-btn" onClick={grabGps} style={{marginBottom:4}}>
            {gps ? `📍 Location captured (${gps.lat}, ${gps.lng})` : '📍 Capture GPS location'}
          </button>
        </div>

        <div style={card}>
          <span style={lbl}>What happened? <span style={{fontWeight:400,color:'#9CA3AF'}}>(the facts, in order)</span></span>
          <textarea style={{...inp,minHeight:100,resize:'vertical',marginBottom:12}} value={facts}
            onChange={e=>setFacts(e.target.value)} placeholder="Describe what happened, step by step…"/>
          <span style={lbl}>Immediate actions taken to make it safe</span>
          <textarea style={{...inp,minHeight:70,resize:'vertical',marginBottom:12}} value={immediateActions}
            onChange={e=>setImmediateActions(e.target.value)} placeholder="What was done right away?"/>
          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:14,cursor:'pointer'}}>
            <input type="checkbox" checked={hazardPresent} onChange={e=>setHazardPresent(e.target.checked)}/>
            The hazard is still present / not yet made safe
          </label>
        </div>

        {/* Evidence */}
        <div style={card}>
          <span style={lbl}>Evidence <span style={{fontWeight:400,color:'#9CA3AF'}}>(optional)</span></span>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
            <EvidenceCameraButton taskId="incident" idx={0} label="Incident"
              onCapture={(url)=>setEvidence(ev=>[...ev,{kind:'photo',url,name:null}])}/>
            <AttachDocButton onAttach={(url,name)=>setEvidence(ev=>[...ev,{kind:'document',url,name}])}/>
          </div>
          {evidence.length>0 && (
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              {evidence.map((e,i)=>(
                <div key={i} style={{position:'relative',width:64,height:64,borderRadius:8,overflow:'hidden',border:'1px solid rgba(0,0,0,.12)'}}>
                  {e.kind==='photo'
                    ? <img src={e.url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                    : <div style={{fontSize:11,padding:4,textAlign:'center'}}>📄<br/>{(e.name||'doc').slice(0,10)}</div>}
                  <button onClick={()=>setEvidence(ev=>ev.filter((_,j)=>j!==i))}
                    style={{position:'absolute',top:0,right:0,background:'rgba(0,0,0,.6)',color:'#fff',border:'none',width:18,height:18,borderRadius:'0 0 0 6px',cursor:'pointer',fontSize:12,lineHeight:1}}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div style={{color:'#DC2626',fontSize:14,marginBottom:12}}>{error}</div>}

        <button onClick={submit} disabled={!canSubmit||submitting}
          style={{width:'100%',padding:'14px',borderRadius:10,border:'none',fontSize:15,fontWeight:600,cursor:canSubmit&&!submitting?'pointer':'not-allowed',
            background: canSubmit&&!submitting ? 'var(--brand,#4F46E5)' : 'rgba(0,0,0,.15)', color:'#fff'}}>
          {submitting ? 'Submitting…' : 'Submit incident report'}
        </button>
      </>)}
    </div>
  )
}
