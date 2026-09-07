import { useState, useEffect } from 'react'
import { supabase } from './supabase.js'

/*
  ProjectsView — the projects module UI.

  Built OUTSIDE App.jsx on purpose. App.jsx is ~1.5MB and this is the
  first net-new module since the decision to stop growing it. It has no
  legacy readers, so it is the safest thing to extract first.

  THREE LEVELS
    list     projects with a counter and a progress bar
    project  section tiles (dashboard style) + milestones
    section  cascade bars by package and area, then a scoped register

  The cascade is not decoration. A bar spans the earliest to the latest
  due date of one package-area group, so segments step across because
  the dependency chain put them there. Riverside and Hilltop overlap
  because the per-area rule let them.

  READ-ONLY except create and archive. Editing sections, adding tasks to
  a package and marking milestones met come next, once this has been
  looked at.

  resolveOrgId is passed in rather than reimplemented: projects.org holds
  the org ID while user.org holds the NAME, and App.jsx already has the
  one correct resolver. A second copy would be the drift that caused
  this mismatch in the first place.
*/

const DONE = ['approved', 'completed']
const isDone = t => DONE.includes(t.status)

const D = s => (s ? new Date(s + 'T00:00:00') : null)
const dayDiff = (a, b) => Math.round((a - b) / 86400000)
const fmt = d =>
  d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'

const C = {
  green: '#1D9E75', greenSoft: '#9FE1CB',
  amber: '#EF9F27', amberSoft: '#FAC775',
  red: '#E24B4A', grey: '#B4B2A9', purple: '#7F77DD',
  // Scheduled but not started. Grey read as "nothing happening" when
  // the work is simply not due yet.
  slate: '#AFC3D6',
  line: '#E5E2DC', line2: '#D4D0C8',
  ink: '#26241F', ink2: '#6B675E', ink3: '#96918A',
  card: '#FFFFFF', soft: '#F6F4F1'
}

const card = {
  background: C.card, border: `1px solid ${C.line}`,
  borderRadius: 12, padding: 14, marginBottom: 10
}

export default function ProjectsView({ user, resolveOrgId }) {
  const [orgId, setOrgId] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [projects, setProjects] = useState([])
  const [taskCounts, setTaskCounts] = useState({})
  const [msByProject, setMsByProject] = useState({})

  const [openId, setOpenId] = useState(null)     // project being viewed
  const [openSection, setOpenSection] = useState(null)
  const [detail, setDetail] = useState(null)     // {project, sections, tasks, ms, areas}

  const [showCreate, setShowCreate] = useState(false)
  const [draft, setDraft] = useState({ name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [showArchive, setShowArchive] = useState(false)

  const isCA = ['client_admin', 'super_admin'].includes(user?.role)

  // ---- level 1 ------------------------------------------------------
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
          const counts = {}
          ;(ts || []).forEach(t => {
            const c = counts[t.project_id] || (counts[t.project_id] = { n: 0, d: 0 })
            c.n++; if (isDone(t)) c.d++
          })
          setTaskCounts(counts)
          const byP = {}
          ;(ms || []).forEach(m => (byP[m.project_id] = byP[m.project_id] || []).push(m))
          setMsByProject(byP)
        }
      } catch (e) { if (!dead) setErr(e.message || String(e)) }
      finally { if (!dead) setLoading(false) }
    })()
    return () => { dead = true }
  }, [user?.org, user?.id])

  // ---- levels 2 and 3 ----------------------------------------------
  useEffect(() => {
    if (!openId) { setDetail(null); return }
    let dead = false
    ;(async () => {
      try {
        const [{ data: p }, { data: secs }, { data: tasks }, { data: ms }, { data: dp }] =
          await Promise.all([
            supabase.from('projects').select('*').eq('id', openId).single(),
            supabase.from('project_sections')
              .select('id,parent_id,name,sort_order').eq('project_id', openId)
              .order('sort_order'),
            supabase.from('tasks')
              .select('id,title,status,due_date,due_date_locked,section_id,area_id,milestone_id,blocks_milestone,assigned_user_names')
              .eq('project_id', openId),
            supabase.from('project_milestone_state').select('*')
              .eq('project_id', openId).order('due_date'),
            // PRJ-VIEW-V1: successor -> [predecessor ids]. Drives the
            // "after X" caption. Arrows between bars were considered and
            // dropped: they read well on a laptop and turn to spaghetti
            // on a phone, and the caption says the same thing.
            supabase.from('task_dependencies')
              .select('predecessor_section_id,successor_section_id')
              .eq('project_id', openId)
          ])
        const areaIds = [...new Set((tasks || []).map(t => t.area_id).filter(Boolean))]
        let areas = {}
        if (areaIds.length) {
          const { data: ar } = await supabase.from('org_areas')
            .select('id,name').in('id', areaIds)
          ;(ar || []).forEach(a => (areas[a.id] = a.name))
        }
        const deps = {}
        ;(dp || []).forEach(d => {
          (deps[d.successor_section_id] = deps[d.successor_section_id] || [])
            .push(d.predecessor_section_id)
        })
        if (!dead) setDetail({ project: p, sections: secs || [], tasks: tasks || [], ms: ms || [], areas, deps })
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
      const row = Array.isArray(data) ? data[0] : data
      setProjects(prev => [{ ...row }, ...prev])
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
  if (err) return <div style={{ padding: 20, color: '#8F2F2E' }}>{err}</div>

  // =====================================================================
  if (openId && detail) {
    return openSection
      ? <SectionView detail={detail} sectionId={openSection}
          onBack={() => setOpenSection(null)} />
      : <ProjectView detail={detail}
          onBack={() => { setOpenId(null); setOpenSection(null) }}
          onSection={setOpenSection} />
  }

  const active = projects.filter(p => !['closed', 'cancelled'].includes(p.status))
  const archived = projects.filter(p => ['closed', 'cancelled'].includes(p.status))

  const Card = (p) => {
    const c = taskCounts[p.id] || { n: 0, d: 0 }
    const pct = c.n ? Math.round((c.d / c.n) * 100) : 0
    const ms = msByProject[p.id] || []
    const risk = ms.filter(m => m.at_risk).length
    const blk = ms.reduce((a, m) => a + (m.blockers_open || 0), 0)
    const openMs = ms.filter(m => m.status === 'open').length
    return (
      <div key={p.id} style={{ ...card, cursor: 'pointer' }} onClick={() => setOpenId(p.id)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 500 }}>{p.name}</span>
          <span style={{ fontSize: 12, color: C.ink2 }}>{c.d}/{c.n}</span>
        </div>
        <div style={{ fontSize: 12, color: C.ink2, marginTop: 2 }}>
          {p.ref}
          {p.status !== 'active' &&
            <span style={{ marginLeft: 6, fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#F0EEEA' }}>{p.status}</span>}
          {openMs > 0 && <span style={{ marginLeft: 6 }}>· {openMs} milestone{openMs > 1 ? 's' : ''} open</span>}
        </div>
        <Bar pct={pct} />
        {risk > 0 ? (
          <Note tone="danger">
            {risk} milestone{risk > 1 ? 's' : ''} at risk — work has been pushed past a gate that did not move.
          </Note>
        ) : blk > 0 ? (
          <Note tone="warn">{blk} open blocker{blk > 1 ? 's' : ''} holding a milestone.</Note>
        ) : null}
        {isCA && p.status === 'active' &&
          <div style={{ marginTop: 10 }}>
            <button className="btn" style={btnGhost}
              onClick={e => { e.stopPropagation(); archive(p) }}>Archive</button>
          </div>}
      </div>
    )
  }

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>Projects</div>
          <div style={{ fontSize: 12, color: C.ink2 }}>
            {active.length} active · {archived.length} archived
          </div>
        </div>
        {isCA && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Project</button>}
      </div>

      <div style={{ marginTop: 14 }}>
        {active.length === 0 && (
          <div style={{ ...card, textAlign: 'center', color: C.ink2, padding: 28 }}>
            No active projects yet.
          </div>
        )}
        {active.map(Card)}
      </div>

      {archived.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, color: C.ink2, cursor: 'pointer', marginBottom: 8 }}
               onClick={() => setShowArchive(v => !v)}>
            {showArchive ? '▾' : '▸'} Archive ({archived.length})
          </div>
          {showArchive && archived.map(Card)}
        </div>
      )}

      {showCreate && (
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
              <button className="btn" style={btnGhost} onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving || !draft.name.trim()}
                      onClick={create}>{saving ? 'Creating…' : 'Create Project'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ===================================================================== */
function ProjectView({ detail, onBack, onSection }) {
  const { project, sections, tasks, ms } = detail
  const tops = sections.filter(s => !s.parent_id)
  const done = tasks.filter(isDone).length
  const today = new Date(); today.setHours(0, 0, 0, 0)

  const tile = s => {
    const pkgs = sections.filter(x => x.parent_id === s.id).map(x => x.id)
    const t = tasks.filter(x => pkgs.includes(x.section_id))
    const d = t.filter(isDone).length
    const late = t.some(x => !isDone(x) && D(x.due_date) < today)
    const colour = (d === t.length && t.length) ? C.green : late ? C.amber : C.ink
    // Was: anything not complete and not late said "In progress", so a
    // section where nobody had started anything claimed work was under
    // way. Read it from the data instead.
    const started = t.some(x => isDone(x) || x.status === 'in_progress')
    const label = !t.length ? 'No tasks'
      : d === t.length ? 'Complete'
      : late ? 'Running late'
      : started ? 'In progress' : 'Not started'
    return (
      <div key={s.id} style={{ background: C.soft, borderRadius: 10, padding: 12, cursor: 'pointer' }}
           onClick={() => onSection(s.id)}>
        <div style={{ fontSize: 13, marginBottom: 6 }}>{s.name}</div>
        <div style={{ fontSize: 20, fontWeight: 500, color: colour }}>{d}/{t.length}</div>
        <div style={{ fontSize: 12, color: late ? '#8A5A00' : C.ink2 }}>{label}</div>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginTop: 12 }}>
          {tops.map(tile)}
        </div>
      </div>

      {ms.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>Milestones</div>
          {ms.map(m => {
            const state = m.status === 'met' ? 'Met'
              : m.at_risk ? `At risk — open work runs to ${fmt(D(m.latest_open_due))}`
              : m.blockers_open ? `${m.blockers_open} open blocker${m.blockers_open > 1 ? 's' : ''}`
              : m.ready_to_meet ? 'Ready to be met'
              : `${m.tasks_open} task${m.tasks_open !== 1 ? 's' : ''} open`
            const col = m.at_risk ? '#8F2F2E' : m.blockers_open ? '#8A5A00'
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
        </div>
      )}
    </div>
  )
}

/* ===================================================================== */
function SectionView({ detail, sectionId, onBack }) {
  const { sections, tasks, areas, project, deps = {} } = detail
  const sec = sections.find(s => s.id === sectionId)
  const pkgs = sections.filter(s => s.parent_id === sectionId)
    .sort((a, b) => a.sort_order - b.sort_order)
  const pkgIds = pkgs.map(p => p.id)
  const mine = tasks.filter(t => pkgIds.includes(t.section_id))

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dates = mine.map(t => D(t.due_date)).filter(Boolean)
  if (!dates.length) dates.push(today)
  let lo = new Date(Math.min(...dates, today))
  let hi = new Date(Math.max(...dates, today))
  lo.setDate(lo.getDate() - 3); hi.setDate(hi.getDate() + 3)
  const span = Math.max(dayDiff(hi, lo), 1)
  const pos = d => (dayDiff(d, lo) / span) * 100

  const colourOf = g => {
    if (g.every(isDone)) return C.green
    if (g.some(t => t.due_date_locked)) return C.red
    if (g.some(t => !isDone(t) && D(t.due_date) < today)) return C.amber
    if (g.some(t => t.status === 'in_progress')) return C.amberSoft
    return C.slate
  }

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={crumb} onClick={onBack}>‹ {project.name}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{sec?.name}</div>
      <div style={{ fontSize: 12, color: C.ink2, marginBottom: 12 }}>
        {mine.filter(isDone).length} of {mine.length} approved
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11,
               color: C.ink3, borderBottom: `1px solid ${C.line}`, paddingBottom: 5 }}>
          <span>{fmt(lo)}</span><span>{fmt(hi)}</span>
        </div>
        <div style={{ position: 'relative', paddingTop: 6 }}>
          <div style={{ position: 'absolute', left: `${pos(today)}%`, top: 0, bottom: 6,
                 width: 1, background: C.ink3 }} />
          {pkgs.map(pk => {
            const g = mine.filter(t => t.section_id === pk.id)
            if (!g.length) return null

            // Attachments (blocks_milestone) are excluded from the bar
            // geometry. They are unplanned work hanging off a milestone,
            // not scheduled trade work, and letting a corrective action
            // due three weeks out stretch a bar makes the plan lie about
            // when people are on site. They stay in the register with
            // their flag and they still block their milestone.
            const planned = g.filter(t => !t.blocks_milestone)

            const groups = {}
            planned.forEach(t => (groups[t.area_id || '_'] = groups[t.area_id || '_'] || []).push(t))

            // Geometry first, then packing. Two areas in the same package
            // routinely overlap — that is the per-area rule doing its job
            // — so drawing them on one row put Hilltop and Riverside on
            // top of each other with their labels smeared together.
            const bars = Object.entries(groups).map(([k, ts]) => {
              const ds = ts.map(t => D(t.due_date)).filter(Boolean)
              if (!ds.length) return null
              let a = new Date(Math.min(...ds))
              const b = new Date(Math.max(...ds))
              if (dayDiff(b, a) < 2) a = new Date(a.getTime() - 2 * 86400000)
              const left = pos(a)
              return { key: k, left, width: Math.max(pos(b) - left, 8),
                       bg: colourOf(ts), ts }
            }).filter(Boolean).sort((x, y) => x.left - y.left)

            // First-fit: a bar takes the topmost row where it clears
            // everything already placed, with a small gap so touching
            // bars stay readable.
            const rows = []
            bars.forEach(bar => {
              let r = 0
              while (rows[r] && rows[r].some(o => bar.left < o.left + o.width + 1.5
                                              && o.left < bar.left + bar.width + 1.5)) r++
              ;(rows[r] = rows[r] || []).push(bar)
              bar.row = r
            })
            const rowCount = Math.max(rows.length, 1)

            const predecessors = (deps[pk.id] || [])
              .map(id => sections.find(x => x.id === id)?.name)
              .filter(Boolean)

            return (
              <div key={pk.id} style={{ padding: '8px 0 2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13 }}>
                    {pk.name}
                    {predecessors.length > 0 &&
                      <span style={{ fontSize: 11, color: C.ink3 }}>
                        {' '}· after {predecessors.join(' and ')}
                      </span>}
                  </span>
                  <span style={{ fontSize: 12, color: C.ink2, whiteSpace: 'nowrap' }}>
                    {g.filter(isDone).length}/{g.length}
                    {g.some(t => t.blocks_milestone && !isDone(t)) &&
                      <span style={{ color: '#8A5A00' }}>
                        {' '}&#9873;{g.filter(t => t.blocks_milestone && !isDone(t)).length}
                      </span>}
                  </span>
                </div>
                <div style={{ position: 'relative', height: rowCount * 32 - 4, marginTop: 4 }}>
                  {bars.map(bar => {
                    const dark = bar.bg === C.slate || bar.bg === C.amberSoft
                    return (
                      <div key={bar.key} title={bar.ts.map(t => t.title).join(', ')}
                        style={{ position: 'absolute', left: `${bar.left}%`, width: `${bar.width}%`,
                          top: bar.row * 32, height: 28, background: bar.bg, borderRadius: 5,
                          display: 'flex', alignItems: 'center', paddingLeft: 7, fontSize: 11,
                          color: dark ? '#2C2C2A' : '#fff', overflow: 'hidden',
                          whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                        {areas[bar.key] || 'all'}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, marginBottom: 6 }}>Register — {sec?.name}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: C.ink3, fontSize: 11, textAlign: 'left' }}>
              <th style={{ fontWeight: 400, borderBottom: `1px solid ${C.line}`, paddingBottom: 5 }}>Task</th>
              <th style={{ fontWeight: 400, borderBottom: `1px solid ${C.line}`, paddingBottom: 5 }}>Due</th>
              <th style={{ fontWeight: 400, borderBottom: `1px solid ${C.line}`, paddingBottom: 5, textAlign: 'right' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {mine.slice().sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
              .map(t => {
                const late = !isDone(t) && D(t.due_date) < today
                return (
                  <tr key={t.id}>
                    <td style={{ padding: '7px 0', borderBottom: `1px solid ${C.line}` }}>
                      {t.due_date_locked && '🔒 '}
                      {t.blocks_milestone && '⚑ '}
                      {t.title}
                    </td>
                    <td style={{ padding: '7px 0', borderBottom: `1px solid ${C.line}`, color: C.ink2 }}>
                      {fmt(D(t.due_date))}
                    </td>
                    <td style={{ padding: '7px 0', borderBottom: `1px solid ${C.line}`,
                           textAlign: 'right', color: late ? '#8A5A00' : C.ink2 }}>
                      {isDone(t) ? 'done' : late ? `${dayDiff(today, D(t.due_date))}d late` : t.status}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ===================================================================== */
function Bar({ pct }) {
  return (
    <div style={{ height: 5, background: '#EEECE8', borderRadius: 3, overflow: 'hidden', margin: '7px 0' }}>
      <div style={{ width: `${pct}%`, height: 5, background: C.green }} />
    </div>
  )
}

function Note({ tone, children }) {
  const s = tone === 'danger'
    ? { color: '#8F2F2E', background: '#FBECEB' }
    : { color: '#8A5A00', background: '#FDF3E0' }
  return <div style={{ ...s, fontSize: 12, borderRadius: 8, padding: '8px 10px', marginTop: 9 }}>{children}</div>
}

const crumb = { fontSize: 12, color: C.ink2, cursor: 'pointer', marginBottom: 6 }
const btnGhost = { background: 'transparent', color: C.ink2, border: `1px solid ${C.line2}`,
  borderRadius: 8, padding: '5px 11px', fontSize: 12, cursor: 'pointer' }
const lbl = { display: 'block', fontSize: 12, color: C.ink2, margin: '10px 0 3px' }
const inp = { width: '100%', padding: '9px 10px', border: `1px solid ${C.line2}`,
  borderRadius: 8, fontSize: 14, fontFamily: 'inherit' }
const modalWrap = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }
const modalBox = { background: '#fff', borderRadius: 14, padding: 18, width: '100%', maxWidth: 460 }
