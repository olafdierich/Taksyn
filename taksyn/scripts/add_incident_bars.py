#!/usr/bin/env python3
# Phase A.3 - active-incident bars under the Incidents hub tiles.
# Sort: breached first, then newest (Option B). Tap a bar -> opens that incident.
# Reuses the app's own INC_SEVERITY_CFG / INC_STATUS_CFG / breach rule / openIncident key.
# Abort-safe: anchors asserted exactly once; writes only if all succeed.

import sys
PATH = '/workspaces/Taksyn/taksyn/src/App.jsx'

with open(PATH, 'r', encoding='utf-8') as f:
    src = f.read()
orig = src

# ---------------------------------------------------------------
# EDIT 1 - add state + fetch at the top of IncidentHubView.
# Anchor: the component's opening lines (unique).
# ---------------------------------------------------------------
anchor1 = ("function IncidentHubView({ user, setPage }) {\n"
           "  const isCA = user.role==='client_admin'\n"
           "  const canReview = ['client_admin','manager','supervisor'].includes(user.role)\n")

fetch_block = r"""  const [activeIncidents, setActiveIncidents] = useState([])
  useEffect(()=>{
    let cancelled = false
    ;(async()=>{
      try {
        if(!canReview) return
        const { data: sess } = await supabase.auth.getSession()
        const authId = sess?.session?.user?.id
        if(!authId) return
        const { data: mem } = await supabase.from('org_members').select('org').eq('user_id', authId)
        const oid = (mem||[]).map(m=>m.org).find(o=>/^ORG/i.test(o||''))
        if(!oid) return
        const { data } = await supabase.from('incidents').select('*').eq('org', oid).order('created_at',{ascending:false})
        if(cancelled) return
        const now = Date.now(); const od=(d)=>d&&new Date(d).getTime()<now
        const isBreached=(i)=> i.status!=='closed' && ((od(i.assign_due_at)&&!i.assigned_at)||(od(i.investigate_due_at)&&!i.root_cause)||od(i.close_due_at))
        const active = (data||[]).filter(i=>i.status!=='closed').map(i=>({...i,_breached:isBreached(i)}))
        // Option B: breached first, then newest-first within each group.
        active.sort((a,b)=> (b._breached?1:0)-(a._breached?1:0) || new Date(b.created_at)-new Date(a.created_at))
        setActiveIncidents(active)
      } catch(e) { /* leave list empty on error */ }
    })()
    return ()=>{ cancelled = true }
  },[user, canReview])
  const openIncidentBar = (ref) => { try{ sessionStorage.setItem('taksyn-open-incident', ref) }catch(e){}; setPage('incidents') }
  const relAge = (d) => {
    if(!d) return ''
    const ms = Date.now()-new Date(d).getTime(); const day=86400000
    if(ms<day) return 'today'
    const days=Math.floor(ms/day); if(days<7) return days+'d ago'
    const wk=Math.floor(days/7); if(wk<5) return wk+'w ago'
    const mo=Math.floor(days/30); return mo+'mo ago'
  }
"""

if src.count(anchor1) != 1:
    print(f"ABORT edit1: hub-open anchor found {src.count(anchor1)} times (need 1). No changes.")
    sys.exit(1)

# ---------------------------------------------------------------
# EDIT 2 - render the bars after the tile row.
# Anchor: the closing of the tiles flex container + the component's return close.
# The tiles are wrapped in a <div style={{display:'flex',flexWrap:'wrap',gap:16,marginTop:8}}> ... </div>
# followed by </div> ) }. We anchor on that unique closing sequence.
# ---------------------------------------------------------------
anchor2 = ("          onClick={()=>setPage('incident_register')}/>}\n"
           "      </div>\n"
           "    </div>\n"
           "  )\n"
           "}\n")

bars_block = r"""          onClick={()=>setPage('incident_register')}/>}
      </div>
      {canReview && activeIncidents.length>0 && (
        <div style={{marginTop:22}}>
          <div style={{fontSize:12,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:.3,marginBottom:10}}>Active incidents ({activeIncidents.length})</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {activeIncidents.map(i=>{
              const sev = INC_SEVERITY_CFG[i.severity] || INC_SEVERITY_CFG[1]
              const st  = INC_STATUS_CFG[i.status] || INC_STATUS_CFG.reported
              const pill = (color,bg)=>({fontSize:11,fontWeight:700,padding:'3px 9px',borderRadius:12,background:bg||(color+'22'),color,flexShrink:0,whiteSpace:'nowrap'})
              return (
                <div key={i.id} onClick={()=>openIncidentBar(i.ref)}
                  style={{cursor:'pointer',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',
                    background:'var(--card)',border:'1px solid '+(i._breached?'#EF4444':'var(--border)'),
                    borderLeft:'4px solid '+(i._breached?'#EF4444':sev.color),borderRadius:10,padding:'10px 14px',
                    transition:'box-shadow .15s'}}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow='0 3px 12px rgba(0,0,0,.09)'}
                  onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
                  <span style={{fontWeight:800,fontSize:13,flexShrink:0}}>{i.ref}</span>
                  <span style={pill(sev.color,sev.bg)}>{i.severity} \u00b7 {sev.label}</span>
                  <span style={pill(st.color)}>{st.label}</span>
                  {i._breached && <span style={pill('#fff','#EF4444')}>\u26a0 Breached</span>}
                  <span style={{fontSize:12,color:'var(--t3)',marginLeft:'auto',flexShrink:0}}>{relAge(i.created_at)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
"""

if src.count(anchor2) != 1:
    print(f"ABORT edit2: tiles-close anchor found {src.count(anchor2)} times (need 1). No changes.")
    sys.exit(1)

# The bars block was authored as a raw string, so \uXXXX are literal.
# Decode just those escapes to real characters (middot, warning sign).
bars_block = bars_block.replace('\\u00b7', '\u00b7').replace('\\u26a0', '\u26a0')

# --- apply ---
src = src.replace(anchor1, anchor1 + fetch_block, 1)
src = src.replace(anchor2, bars_block, 1)

if src == orig:
    print("ABORT: no change produced.")
    sys.exit(1)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(src)
print("OK - added active-incident bars to IncidentHubView (breached-first, tap-to-open)")
