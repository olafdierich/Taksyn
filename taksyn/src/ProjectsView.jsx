import { useState, useEffect } from 'react'
import { supabase } from './supabase.js'

/*
  ProjectsView — the projects module UI.

  Built OUTSIDE App.jsx. First net-new module since the decision to stop
  growing that file, and it has no legacy readers.

  BUILT ON TEAMS, NOT PLACES
  An earlier version grouped bars by "area" (Riverside House, Hilltop
  House). Taksyn has no places — it has tasks, teams and staff — so a bar
  labelled with a house looked like a team but was not one, and nothing
  on screen said who had to do the work. Bars now group by tasks.team_id,
  which already existed, and every row names its assignee and approver.

  THE REGISTER MIRRORS THE BARS: same packages, same order, teams grouped
  inside. A flat date-sorted list gave no way to connect "that amber bar"
  to "those rows".

  STATUS IS TRANSLATED, NOT PRINTED. "pending" means nobody has started,
  which the word does not say. "completed" means done but not yet
  approved, which in a compliance product is a different thing entirely.

  WHY A DATE MOVED comes from project_schedule_events. Propagation has
  been writing that explanation all along and nothing was reading it.
*/

const DONE = ['approved', 'completed']
const isDone = t => DONE.includes(t.status)

const D = s => (s ? new Date(s + 'T00:00:00') : null)
const dayDiff = (a, b) => Math.round((a - b) / 86400000)
const fmt = d => d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

function stateOf(t) {
  const late = !isDone(t) && D(t.due_date) && D(t.due_date) < today0()
  switch (t.status) {
    case 'approved':        return { label: 'Approved', tone: 'ok' }
    case 'completed':       return { label: 'Done — awaiting approval', tone: 'wait' }
    case 'awaiting_review': return { label: 'Submitted — with approver', tone: 'wait' }
    case 'rejected':        return { label: 'Sent back', tone: 'bad' }
    case 'in_progress':     return { label: late ? 'In progress — overdue' : 'In progress', tone: late ? 'bad' : 'go' }
    case 'escalated':       return { label: 'Escalated', tone: 'bad' }
    default:                return { label: late ? 'Not started — overdue' : 'Not started', tone: late ? 'bad' : 'idle' }
  }
}

// Taken from App.jsx by frequency, so the module speaks the same colour
// language as the rest of the app rather than a near-miss of it.
const C = {
  green: '#10B981',   // emerald — success, approved (82 uses)
  amber: '#F59E0B',   // amber — warning (85 uses)
  red:   '#EF4444',   // red — overdue, alert (68 uses)
  blue:  '#3B82F6',   // blue — info (44 uses)
  brand: '#00A87E',   // the Taksyn logo green
  navy:  '#1A2033',   // the Taksyn dark
  amberDeep: '#B45309', // amber text on light backgrounds (13 uses)
  line:  '#E2E8F0', line2: '#CBD5E1',
  ink:   '#1A2033', ink2: '#6B7280', ink3: '#9CA3AF',
  card:  '#FFFFFF', soft: '#F4F6F9'
}
const TONE = { ok: C.green, go: C.blue, wait: '#8B5CF6', bad: '#DC2626', idle: C.ink2 }

// Team colours. Chosen to stay distinguishable next to each other and
// to survive the common forms of colour blindness — they differ in
// lightness as well as hue, so they are still tellable apart in
// greyscale or on a printed page.
const TEAM_COLOURS = [
  { solid: '#10B981', faded: '#A7E8D0' },  // emerald  — App.jsx success
  { solid: '#F59E0B', faded: '#FBD89B' },  // amber    — App.jsx warning
  { solid: '#3B82F6', faded: '#B3CDFB' },  // blue     — App.jsx info
  { solid: '#8B5CF6', faded: '#CDBDF9' },  // violet   — App.jsx accent
  { solid: '#5BC8C0', faded: '#BFE9E6' },  // teal     — Taksyn brand
  { solid: '#F97316', faded: '#FCC49A' },  // orange   — App.jsx
  { solid: '#6366F1', faded: '#C0C1F7' },  // indigo   — App.jsx
  { solid: '#64748B', faded: '#C4CBD5' }   // slate    — App.jsx
]

// Stable hash: the same team gets the same colour in every session and
// on every device, with no colour column on teams. If explicit colours
// are wanted later, this becomes the fallback.
function teamColour(id) {
  const k = String(id || '_')
  let h = 0
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0
  return TEAM_COLOURS[h % TEAM_COLOURS.length]
}

const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, marginBottom: 10 }

export default function ProjectsView({ user, resolveOrgId }) {
  const [orgId, setOrgId] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [projects, setProjects] = useState([])
  const [counts, setCounts] = useState({})
  const [msByProject, setMsByProject] = useState({})
  const [openId, setOpenId] = useState(null)
  const [openSection, setOpenSection] = useState(null)
  const [detail, setDetail] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [draft, setDraft] = useState({ name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [showArchive, setShowArchive] = useState(false)

  const isCA = ['client_admin', 'super_admin'].includes(user?.role)

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const oid = await resolveOrgId(user)
        if (dead) return
        setOrgId(oid || '')
        if (!oid) { setProjects([]); setLoading(false); return }
        const { data: ps, error } = await supabase.from('projects')
          .select('id,ref,name,description,status,start_date,target_end_date')
          .eq('org', oid).order('created_at', { ascending: false })
        if (error) throw error
        if (dead) return
        setProjects(ps || [])
        const ids = (ps || []).map(p => p.id)
        if (ids.length) {
          const [{ data: ts }, { data: ms }] = await Promise.all([
            supabase.from('tasks').select('id,project_id,status').in('project_id', ids),
            supabase.from('project_milestone_state')
              .select('project_id,at_risk,blockers_open,status').in('project_id', ids)
          ])
          if (dead) return
          const c = {}
          ;(ts || []).forEach(t => {
            const e = c[t.project_id] || (c[t.project_id] = { n: 0, d: 0 })
            e.n++; if (isDone(t)) e.d++
          })
          setCounts(c)
          const byP = {}
          ;(ms || []).forEach(m => (byP[m.project_id] = byP[m.project_id] || []).push(m))
          setMsByProject(byP)
        }
      } catch (e) { if (!dead) setErr(e.message || String(e)) }
      finally { if (!dead) setLoading(false) }
    })()
    return () => { dead = true }
  }, [user?.org, user?.id])

  useEffect(() => {
    if (!openId) { setDetail(null); return }
    let dead = false
    ;(async () => {
      try {
        const [{ data: p }, { data: secs }, { data: tasks }, { data: ms }, { data: dp }, { data: ev }] =
          await Promise.all([
            supabase.from('projects').select('*').eq('id', openId).single(),
            supabase.from('project_sections').select('id,parent_id,name,sort_order')
              .eq('project_id', openId).order('sort_order'),
            supabase.from('tasks')
              .select('id,title,status,due_date,due_date_locked,due_date_lock_reason,section_id,team_id,team_name,milestone_id,blocks_milestone,assigned_user_names,assigned_user_name,approver_name,completed_at')
              .eq('project_id', openId),
            supabase.from('project_milestone_state').select('*')
              .eq('project_id', openId).order('due_date'),
            supabase.from('task_dependencies')
              .select('predecessor_section_id,successor_section_id,gap_days')
              .eq('project_id', openId),
            supabase.from('project_schedule_events')
              .select('task_id,kind,old_due_date,new_due_date,delta_days,caused_by_section_id,note,created_at')
              .eq('project_id', openId).order('created_at', { ascending: false }).limit(200)
          ])
        const deps = {}
        ;(dp || []).forEach(d =>
          (deps[d.successor_section_id] = deps[d.successor_section_id] || []).push(d.predecessor_section_id))
        const moved = {}
        ;(ev || []).forEach(e => { if (e.task_id && !moved[e.task_id]) moved[e.task_id] = e })
        if (!dead) setDetail({ project: p, sections: secs || [], tasks: tasks || [], ms: ms || [], deps, moved })
      } catch (e) { if (!dead) setErr(e.message || String(e)) }
    })()
    return () => { dead = true }
  }, [openId])

  const create = async () => {
    if (!draft.name.trim() || saving) return
    setSaving(true)
    try {
      const oid = orgId || (await resolveOrgId(user))
      if (!oid) throw new Error('Could not work out which organisation to create this in.')
      const { data, error } = await supabase.rpc('create_project', {
        p_org: oid, p_name: draft.name.trim(),
        p_description: draft.description.trim() || null
      })
      if (error) throw error
      setProjects(prev => [Array.isArray(data) ? data[0] : data, ...prev])
      setShowCreate(false); setDraft({ name: '', description: '' })
    } catch (e) { alert(e.message || String(e)) }
    finally { setSaving(false) }
  }

  const archive = async (p) => {
    if (!confirm(`Archive ${p.name}?`)) return
    const { error } = await supabase.from('projects')
      .update({ status: 'cancelled' }).eq('id', p.id).select()
    if (error) return alert('Could not archive: ' + error.message)
    setProjects(prev => prev.map(x => x.id === p.id ? { ...x, status: 'cancelled' } : x))
  }

  if (loading) return <div style={{ padding: 20, color: C.ink2 }}>Loading projects…</div>
  if (err) return <div style={{ padding: 20, color: TONE.bad }}>{err}</div>

  if (openId && detail) {
    return openSection
      ? <SectionView detail={detail} sectionId={openSection} onBack={() => setOpenSection(null)} />
      : <ProjectView detail={detail} onBack={() => { setOpenId(null); setOpenSection(null) }}
          onSection={setOpenSection} />
  }

  const active = projects.filter(p => !['closed', 'cancelled'].includes(p.status))
  const archived = projects.filter(p => ['closed', 'cancelled'].includes(p.status))

  const Card = p => {
    const c = counts[p.id] || { n: 0, d: 0 }
    const msList = msByProject[p.id] || []
    const risk = msList.filter(m => m.at_risk).length
    const blk = msList.reduce((a, m) => a + (m.blockers_open || 0), 0)
    return (
      <div key={p.id} style={{ ...card, cursor: 'pointer' }} onClick={() => setOpenId(p.id)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 500 }}>{p.name}</span>
          <span style={{ fontSize: 12, color: C.ink2 }}>{c.d}/{c.n} approved</span>
        </div>
        <div style={{ fontSize: 12, color: C.ink2, marginTop: 2 }}>
          {p.ref}{p.status !== 'active' && <Pill>{p.status}</Pill>}
        </div>
        <Bar pct={c.n ? Math.round(c.d / c.n * 100) : 0} />
        {risk > 0
          ? <Note tone="bad">{risk} milestone{risk > 1 ? 's' : ''} at risk — work has been pushed past a gate that did not move.</Note>
          : blk > 0
          ? <Note tone="warn">{blk} open blocker{blk > 1 ? 's' : ''} holding a milestone.</Note>
          : null}
        {isCA && p.status === 'active' &&
          <div style={{ marginTop: 10 }}>
            <button style={btnGhost} onClick={e => { e.stopPropagation(); archive(p) }}>Archive</button>
          </div>}
      </div>
    )
  }

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>Projects</div>
          <div style={{ fontSize: 12, color: C.ink2 }}>{active.length} active · {archived.length} archived</div>
        </div>
        {isCA && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Project</button>}
      </div>

      <div style={{ marginTop: 14 }}>
        {active.length === 0 &&
          <div style={{ ...card, textAlign: 'center', color: C.ink2, padding: 28 }}>No active projects yet.</div>}
        {active.map(Card)}
      </div>

      {archived.length > 0 &&
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, color: C.ink2, cursor: 'pointer', marginBottom: 8 }}
               onClick={() => setShowArchive(v => !v)}>
            {showArchive ? '▾' : '▸'} Archive ({archived.length})
          </div>
          {showArchive && archived.map(Card)}
        </div>}

      {showCreate &&
        <div style={modalWrap} onClick={() => setShowCreate(false)}>
          <div style={modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>New Project</div>
            <label style={lbl}>Project name *</label>
            <input style={inp} value={draft.name} autoFocus
                   onChange={e => setDraft({ ...draft, name: e.target.value })} />
            <label style={lbl}>Description</label>
            <textarea style={{ ...inp, minHeight: 70 }} value={draft.description}
                      onChange={e => setDraft({ ...draft, description: e.target.value })} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button style={btnGhost} onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving || !draft.name.trim()}
                      onClick={create}>{saving ? 'Creating…' : 'Create Project'}</button>
            </div>
          </div>
        </div>}
    </div>
  )
}

/* ===================================================================== */
function ProjectView({ detail, onBack, onSection }) {
  const { project, sections, tasks, ms } = detail
  const tops = sections.filter(s => !s.parent_id)
  const done = tasks.filter(isDone).length
  const today = today0()

  const tile = s => {
    const pkgs = sections.filter(x => x.parent_id === s.id).map(x => x.id)
    const t = tasks.filter(x => pkgs.includes(x.section_id))
    const d = t.filter(isDone).length
    const late = t.some(x => !isDone(x) && D(x.due_date) < today)
    const started = t.some(x => isDone(x) || x.status === 'in_progress' || x.status === 'awaiting_review')
    const colour = (d === t.length && t.length) ? C.green : late ? C.amber : C.ink
    const label = !t.length ? 'No tasks' : d === t.length ? 'Complete'
      : late ? 'Running late' : started ? 'In progress' : 'Not started'
    const teams = [...new Set(t.map(x => x.team_name).filter(Boolean))]
    return (
      <div key={s.id} style={{ background: C.soft, borderRadius: 10, padding: 12, cursor: 'pointer' }}
           onClick={() => onSection(s.id)}>
        <div style={{ fontSize: 13, marginBottom: 6 }}>{s.name}</div>
        <div style={{ fontSize: 20, fontWeight: 500, color: colour }}>{d}/{t.length}</div>
        <div style={{ fontSize: 12, color: late ? C.amberDeep : C.ink2 }}>{label}</div>
        {teams.length > 0 &&
          <div style={{ fontSize: 11, color: C.ink3, marginTop: 4 }}>{teams.join(' · ')}</div>}
      </div>
    )
  }

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={crumb} onClick={onBack}>‹ Projects</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{project.name}</div>
      <div style={{ fontSize: 12, color: C.ink2, marginBottom: 12 }}>
        {project.ref} · {project.status}
        {project.target_end_date && ` · target ${fmt(D(project.target_end_date))}`}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 24, fontWeight: 500 }}>{done}/{tasks.length}</span>
          <span style={{ fontSize: 13, color: C.ink2 }}>tasks approved</span>
        </div>
        <Bar pct={tasks.length ? Math.round(done / tasks.length * 100) : 0} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginTop: 12 }}>
          {tops.map(tile)}
        </div>
      </div>

      {ms.length > 0 &&
        <div style={card}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>Milestones</div>
          {ms.map(m => {
            const state = m.status === 'met' ? 'Met'
              : m.at_risk ? `At risk — open work runs to ${fmt(D(m.latest_open_due))}`
              : m.blockers_open ? `${m.blockers_open} open blocker${m.blockers_open > 1 ? 's' : ''}`
              : m.ready_to_meet ? 'Ready to be met'
              : `${m.tasks_open} task${m.tasks_open !== 1 ? 's' : ''} open`
            const col = m.at_risk ? TONE.bad : m.blockers_open ? C.amberDeep
              : m.status === 'met' ? C.green : C.ink2
            return (
              <div key={m.milestone_id} style={{ display: 'flex', justifyContent: 'space-between',
                     gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.line}` }}>
                <span style={{ fontSize: 13 }}>
                  {m.date_locked && '🔒 '}{m.name}
                  <span style={{ color: C.ink2 }}> · {fmt(D(m.due_date))}</span>
                </span>
                <span style={{ fontSize: 12, color: col, textAlign: 'right' }}>{state}</span>
              </div>
            )
          })}
        </div>}
    </div>
  )
}

/* ===================================================================== */
function SectionView({ detail, sectionId, onBack }) {
  const { sections, tasks, project, deps = {}, moved = {} } = detail
  const sec = sections.find(s => s.id === sectionId)
  const pkgs = sections.filter(s => s.parent_id === sectionId).sort((a, b) => a.sort_order - b.sort_order)
  const pkgIds = pkgs.map(p => p.id)
  const mine = tasks.filter(t => pkgIds.includes(t.section_id))
  const today = today0()

  const dates = mine.map(t => D(t.due_date)).filter(Boolean)
  if (!dates.length) dates.push(today)
  let lo = new Date(Math.min(...dates, today)), hi = new Date(Math.max(...dates, today))
  lo.setDate(lo.getDate() - 3); hi.setDate(hi.getDate() + 3)
  const span = Math.max(dayDiff(hi, lo), 1)
  const pos = d => (dayDiff(d, lo) / span) * 100

  // Hue = team, always. Intensity = finished or not. Overdue gets its
  // own channel (a red left edge) rather than a fourth colour, because
  // "late" must never be encodable as "slightly paler".
  const barStyle = (teamId, g) => {
    const col = teamColour(teamId)
    const done = g.length > 0 && g.every(isDone)
    const late = g.some(t => !isDone(t) && D(t.due_date) && D(t.due_date) < today)
    const locked = g.some(t => t.due_date_locked)
    return {
      background: done ? col.solid : col.faded,
      borderLeft: late ? `3px solid ${C.red}` : locked ? `3px solid ${C.ink3}` : 'none'
    }
  }

  // One stable team order for the WHOLE section. Every package renders
  // the same teams in the same order, so a team keeps its row down the
  // screen and a bar further right than the row above it reads as a
  // delay without needing a caption.
  const teamOrder = []
  const teamNames = {}
  mine.filter(t => !t.blocks_milestone).forEach(t => {
    const k = t.team_id || '_'
    if (!teamOrder.includes(k)) teamOrder.push(k)
    teamNames[k] = t.team_name || 'Unassigned'
  })
  teamOrder.sort((a, b) => (teamNames[a] || '').localeCompare(teamNames[b] || ''))

  // Computed once and shared by the bars and the register, so the two
  // can never disagree about what is in a package.
  const packages = pkgs.map(pk => {
    const all = mine.filter(t => t.section_id === pk.id)
    // Attachments are excluded from the geometry: unplanned work hanging
    // off a milestone should not stretch a bar that says when a team is
    // on site.
    const planned = all.filter(t => !t.blocks_milestone)
    const attachments = all.filter(t => t.blocks_milestone)

    const byTeam = {}
    planned.forEach(t => (byTeam[t.team_id || '_'] = byTeam[t.team_id || '_'] || []).push(t))

    // One row per team, in the section's stable order. A team with no
    // work in this package still gets its row, so the rows line up
    // across packages — that alignment is what makes a delay visible.
    const bars = teamOrder.map(k => {
      const ts = byTeam[k]
      if (!ts || !ts.length) return { key: k, name: teamNames[k], ts: [], empty: true }
      const ds = ts.map(t => D(t.due_date)).filter(Boolean)
      if (!ds.length) return { key: k, name: teamNames[k], ts, empty: true }
      let a = new Date(Math.min(...ds)); const b = new Date(Math.max(...ds))
      if (dayDiff(b, a) < 2) a = new Date(a.getTime() - 2 * 86400000)
      const left = pos(a)
      return { key: k, name: teamNames[k], ts, left,
               width: Math.max(pos(b) - left, 4), style: barStyle(k, ts) }
    })

    const preds = (deps[pk.id] || []).map(id => sections.find(x => x.id === id)?.name).filter(Boolean)
    const slip = all.map(t => moved[t.id]).filter(e => e && e.kind === 'shift')
      .reduce((m, e) => Math.max(m, e.delta_days || 0), 0)

    return { pk, all, attachments, byTeam, bars, preds, slip }
  })

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={crumb} onClick={onBack}>‹ {project.name}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{sec?.name}</div>
      <div style={{ fontSize: 12, color: C.ink2, marginBottom: 8 }}>
        {mine.filter(isDone).length} of {mine.length} approved
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, fontSize: 11, color: C.ink3 }}>
        {teamOrder.map(k => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <i style={{ width: 9, height: 9, borderRadius: 3, background: teamColour(k).solid }} />
            {teamNames[k]}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <i style={{ width: 16, height: 9, borderRadius: 3, background: C.ink3, opacity: .3 }} />
          faded = still open
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <i style={{ width: 4, height: 11, borderRadius: 1, background: C.red }} />
          overdue
        </span>
      </div>

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: '116px minmax(0,1fr)', gap: 8,
               borderBottom: `1px solid ${C.line}`, paddingBottom: 5 }}>
          <span />
          <span style={{ display: 'flex', justifyContent: 'space-between',
                   fontSize: 11, color: C.ink3 }}>
            <span>{fmt(lo)}</span><span>{fmt(hi)}</span>
          </span>
        </div>
        <div style={{ position: 'relative', paddingTop: 6 }}>
          {/* Sits inside the track, not across the name column. */}
          <div style={{ position: 'absolute', left: 'calc(116px + 8px)', right: 0,
                 top: 0, bottom: 6, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: `${pos(today)}%`, top: 0, bottom: 0,
                   width: 1, background: C.ink3 }} />
          </div>
          {packages.map(({ pk, all, attachments, bars, preds, slip }) => {
            if (!all.length) return null
            const openAtt = attachments.filter(t => !isDone(t)).length
            return (
              <div key={pk.id} style={{ padding: '10px 0 4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13 }}>
                    {pk.name}
                    {preds.length > 0 &&
                      <span style={{ fontSize: 11, color: C.ink3 }}> · after {preds.join(' and ')}</span>}
                    {slip > 0 &&
                      <span style={{ fontSize: 11, color: C.amberDeep }}> · pushed {slip} days</span>}
                  </span>
                  <span style={{ fontSize: 12, color: C.ink2, whiteSpace: 'nowrap' }}>
                    {all.filter(isDone).length}/{all.length}
                    {openAtt > 0 && <span style={{ color: C.amberDeep }}> ⚑{openAtt}</span>}
                  </span>
                </div>
                {/* Fixed name column, then the track. Nothing floats, so
                    nothing can collide. */}
                {bars.map(bar => (
                  <div key={bar.key} style={{ display: 'grid',
                         gridTemplateColumns: '116px minmax(0,1fr)',
                         alignItems: 'center', gap: 8, height: 26 }}>
                    <span style={{ fontSize: 11, color: C.ink3, overflow: 'hidden',
                             textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                             display: 'flex', alignItems: 'center', gap: 6 }}>
                      <i style={{ width: 9, height: 9, borderRadius: 3, flex: 'none',
                             background: teamColour(bar.key).solid }} />
                      {bar.name}
                    </span>
                    <div style={{ position: 'relative', height: 20 }}>
                      {!bar.empty &&
                        <div title={bar.ts.map(t => t.title).join(', ')}
                          style={{ position: 'absolute', left: `${bar.left}%`,
                            width: `${bar.width}%`, minWidth: 10, height: 20,
                            borderRadius: 4, ...bar.style }} />}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {packages.map(({ pk, all, byTeam, attachments }) => {
        if (!all.length) return null
        return (
          <div key={pk.id} style={card}>
            <div style={{ fontSize: 13, marginBottom: 8 }}>{pk.name}</div>
            {Object.keys(byTeam).map(k => (
              <TeamBlock key={k} name={byTeam[k][0].team_name || 'Unassigned'}
                         colour={teamColour(k).solid}
                         tasks={byTeam[k]} moved={moved} sections={sections} />
            ))}
            {attachments.length > 0 &&
              <TeamBlock name="Attached — blocks a milestone" tasks={attachments}
                         moved={moved} sections={sections} flag />}
          </div>
        )
      })}
    </div>
  )
}

function TeamBlock({ name, tasks, moved, sections, flag, colour }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: flag ? C.amberDeep : C.ink3, marginBottom: 4,
             display: 'flex', alignItems: 'center', gap: 6 }}>
        {colour && <i style={{ width: 9, height: 9, borderRadius: 3, flex: 'none', background: colour }} />}
        {flag && '⚑ '}{name}
      </div>
      {tasks.slice().sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')).map(t => {
        const st = stateOf(t)
        // Read the array first, fall back to the scalar. The migration
        // from assigned_user_id to assigned_user_ids is half-done and
        // array-assigned tasks show as unassigned wherever only the
        // scalar is read.
        const who = (t.assigned_user_names && t.assigned_user_names[0]) || t.assigned_user_name || '—'
        const ev = moved[t.id]
        const cause = ev && ev.caused_by_section_id
          ? sections.find(s => s.id === ev.caused_by_section_id)?.name : null
        return (
          <div key={t.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.line}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 13 }}>{t.due_date_locked && '🔒 '}{t.title}</span>
              <span style={{ fontSize: 12, color: TONE[st.tone], whiteSpace: 'nowrap' }}>{st.label}</span>
            </div>
            <div style={{ fontSize: 11, color: C.ink3, marginTop: 2 }}>
              {fmt(D(t.due_date))} · {who}
              {t.approver_name && ` · approver ${t.approver_name}`}
            </div>
            {ev && ev.kind === 'shift' &&
              <div style={{ fontSize: 11, color: C.amberDeep, marginTop: 3 }}>
                Moved {ev.delta_days} days from {fmt(D(ev.old_due_date))}
                {cause && ` because ${cause} ran late`}
              </div>}
            {ev && ev.kind === 'blocked' &&
              <div style={{ fontSize: 11, color: TONE.bad, marginTop: 3 }}>{ev.note}</div>}
            {t.due_date_locked && t.due_date_lock_reason &&
              <div style={{ fontSize: 11, color: C.ink3, marginTop: 3 }}>{t.due_date_lock_reason}</div>}
          </div>
        )
      })}
    </div>
  )
}

/* ===================================================================== */
function Bar({ pct }) {
  return <div style={{ height: 5, background: C.line, borderRadius: 3, overflow: 'hidden', margin: '7px 0' }}>
    <div style={{ width: `${pct}%`, height: 5, background: C.green }} /></div>
}
function Note({ tone, children }) {
  // Text and background from the same families App.jsx uses for its own
  // warning and danger panels.
  const s = tone === 'bad'
    ? { color: '#DC2626', background: '#FEE2E2' }
    : { color: C.amberDeep, background: '#FEF3C7' }
  return <div style={{ ...s, fontSize: 12, borderRadius: 8, padding: '8px 10px', marginTop: 9 }}>{children}</div>
}
function Pill({ children }) {
  return <span style={{ marginLeft: 6, fontSize: 11, padding: '2px 8px', borderRadius: 20, background: C.soft, color: C.ink2 }}>{children}</span>
}

const crumb = { fontSize: 12, color: C.ink2, cursor: 'pointer', marginBottom: 6 }
const btnGhost = { background: 'transparent', color: C.ink2, border: `1px solid ${C.line2}`,
  borderRadius: 8, padding: '5px 11px', fontSize: 12, cursor: 'pointer' }
const lbl = { display: 'block', fontSize: 12, color: C.ink2, margin: '10px 0 3px' }
const inp = { width: '100%', padding: '9px 10px', border: `1px solid ${C.line2}`, borderRadius: 8,
  fontSize: 14, fontFamily: 'inherit' }
const modalWrap = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }
const modalBox = { background: '#fff', borderRadius: 14, padding: 18, width: '100%', maxWidth: 460 }
