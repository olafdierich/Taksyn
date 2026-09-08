import { useState, useEffect } from 'react'
import { supabase } from './supabase.js'
import StructurePanel from './ProjectStructure.jsx'
import TaskForm from './TaskForm.jsx'
import DependencyEditor from './DependencyEditor.jsx'
import MilestonePanel from './MilestonePanel.jsx'
import ReportPanel from './ReportPanel.jsx'

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
  line:  'var(--border)', line2: 'var(--border2)',
  ink:   'var(--text)', ink2: 'var(--t2)', ink3: 'var(--t3)',
  card:  'var(--card)', soft: 'var(--s3)'
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

const card = { background: C.card, border: `1px solid ${C.line2}`, borderRadius: 12, padding: 14, marginBottom: 10 }

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
  const [reload, setReload] = useState(0)
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
              .select('id,predecessor_section_id,successor_section_id,gap_days,match_by_team')
              .eq('project_id', openId),
            supabase.from('project_schedule_events')
              .select('task_id,kind,old_due_date,new_due_date,delta_days,caused_by_section_id,note,created_at')
              .eq('project_id', openId).order('created_at', { ascending: false }).limit(200)
          ])
        const deps = {}
        ;(dp || []).forEach(d =>
          (deps[d.successor_section_id] = deps[d.successor_section_id] || []).push(d.predecessor_section_id))
        // The editor needs the rows themselves — id, gap_days,
        // match_by_team — not just the predecessor map the captions use.
        const links = dp || []
        const moved = {}
        ;(ev || []).forEach(e => { if (e.task_id && !moved[e.task_id]) moved[e.task_id] = e })
        if (!dead) setDetail({ project: p, sections: secs || [], tasks: tasks || [], ms: ms || [], deps, links, moved })
      } catch (e) { if (!dead) setErr(e.message || String(e)) }
    })()
    return () => { dead = true }
  }, [openId, reload])

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
      ? <SectionView detail={detail} sectionId={openSection} onBack={() => setOpenSection(null)}
          canEdit={isCA} user={user} orgName={user?.org}
          onChanged={() => setReload(n => n + 1)} />
      : <ProjectView detail={detail} onBack={() => { setOpenId(null); setOpenSection(null) }}
          onSection={setOpenSection} canEdit={isCA} user={user} orgName={user?.org}
          onChanged={() => setReload(n => n + 1)} />
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
          ? <Note tone="bad">{risk} milestone{risk > 1 ? 's' : ''} at risk — work has been pushed past a milestone that did not move.</Note>
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
function ProjectView({ detail, onBack, onSection, canEdit, onChanged, user, orgName }) {
  const { project, sections, tasks, ms } = detail
  const [recalcBusy, setRecalcBusy] = useState(false)
  const [signBusy, setSignBusy] = useState(false)

  // Only offered when it can actually succeed. sign_off_project refuses
  // while work is open, gates are unmet, or a locked date is at risk —
  // but a button that is usually refused teaches people to ignore what
  // it says, so it appears when the conditions are met and not before.
  const openTasks = tasks.filter(t => !isDone(t)).length
  const openGates = ms.filter(m => m.status === 'open').length
  const canSignOff = project.status === 'active'
    && tasks.length > 0 && openTasks === 0 && openGates === 0

  const signOff = async () => {
    if (signBusy) return
    const note = prompt(
      `Sign off ${project.ref} — ${project.name}?\n\n`
      + 'This closes the project and records that you, as client admin, state it '
      + 'is complete. Add a note for whoever reads this later.', '')
    if (note === null) return
    setSignBusy(true)
    try {
      const { error } = await supabase.rpc('sign_off_project', {
        p_project_id: project.id, p_note: note.trim() || null
      })
      if (error) throw error
      onChanged()
    } catch (e) { alert(e.message || String(e)) }
    finally { setSignBusy(false) }
  }

  // Dry run, show, then apply on confirmation. Dates moving is a
  // consequential act with an audit trail behind it — it should be
  // something someone chose, not something that happened while they were
  // reading a page. This is the only place the UI applies it.
  const recalculate = async () => {
    if (recalcBusy) return
    setRecalcBusy(true)
    try {
      const { data, error } = await supabase.rpc('recompute_project_dates', {
        p_project_id: project.id, p_dry_run: true
      })
      if (error) throw error
      const rows = data || []

      const cycle = rows.find(r => r.kind === 'cycle')
      if (cycle) { alert(cycle.note); return }

      const shifts = rows.filter(r => r.kind === 'shift')
      const blocked = rows.filter(r => r.kind === 'blocked')
      if (!shifts.length && !blocked.length) {
        alert('Nothing needs to move. Every stage already starts after the work it waits on.')
        return
      }

      const nameOf = id => tasks.find(t => t.id === id)?.title || id
      let msg = ''
      if (shifts.length) {
        msg += shifts.length + ' task date(s) will move:\n'
          + shifts.slice(0, 8).map(r =>
              '  \u2022 ' + nameOf(r.task_id) + ': ' + r.old_due_date
              + ' \u2192 ' + r.new_due_date + ' (+' + r.delta_days + 'd)'
            ).join('\n')
          + (shifts.length > 8 ? '\n  \u2026and ' + (shifts.length - 8) + ' more' : '')
      }
      if (blocked.length) {
        msg += '\n\n' + blocked.length + ' locked date(s) will NOT move:\n'
          + blocked.map(r => '  \u2022 ' + nameOf(r.task_id)).join('\n')
          + '\n\nThose are now at risk.'
      }
      if (!confirm(msg + '\n\nApply?')) return

      const { error: applyErr } = await supabase.rpc('recompute_project_dates', {
        p_project_id: project.id, p_dry_run: false
      })
      if (applyErr) throw applyErr
      onChanged()
    } catch (e) { alert(e.message || String(e)) }
    finally { setRecalcBusy(false) }
  }
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
      <div style={{ display: 'flex', justifyContent: 'space-between',
             alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: C.ink2 }}>
          {project.ref} · {project.status}
          {project.target_end_date && ` · target ${fmt(D(project.target_end_date))}`}
        </span>
        {canEdit &&
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={{ background: 'transparent', color: C.ink2,
                     border: `1px solid ${C.line2}`, borderRadius: 8,
                     padding: '5px 11px', fontSize: 12, cursor: 'pointer' }}
                    disabled={recalcBusy} onClick={recalculate}>
              {recalcBusy ? 'Checking…' : 'Recalculate dates'}
            </button>
            {canSignOff &&
              <button style={{ background: C.green, color: '#fff', border: 0,
                       borderRadius: 8, padding: '6px 13px', fontSize: 12,
                       cursor: 'pointer' }}
                      disabled={signBusy} onClick={signOff}>
                {signBusy ? 'Signing off…' : 'Sign off project'}
              </button>}
          </span>}
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

      <MilestonePanel project={project} sections={sections} milestones={ms}
                      canEdit={canEdit} onChanged={onChanged} />

      <ReportPanel project={project} orgName={orgName} user={user}
                   canEdit={canEdit} onChanged={onChanged} />

      {project.status === 'closed' && project.signoff_note &&
        <div style={{ ...card, borderColor: C.green }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.green, marginBottom: 4 }}>
            Signed off
          </div>
          <div style={{ fontSize: 12, color: C.ink2 }}>{project.signoff_note}</div>
          {project.closed_at &&
            <div style={{ fontSize: 11, color: C.ink3, marginTop: 4 }}>
              {new Date(project.closed_at).toLocaleString()}
            </div>}
        </div>}

      <StructurePanel projectId={project.id} sections={sections} tasks={tasks}
                      canEdit={canEdit} onChanged={onChanged} />
    </div>
  )
}

/* ===================================================================== */
function SectionView({ detail, sectionId, onBack, canEdit, user, orgName, onChanged }) {
  const [addingTo, setAddingTo] = useState(null)
  const [editingTask, setEditingTask] = useState(null)
  const [editingDeps, setEditingDeps] = useState(null)
  const [addingStage, setAddingStage] = useState(false)
  const [stageName, setStageName] = useState('')
  // Pointer-event drag, same shape as the compliance report stat cards
  // in App.jsx (~7504). Pointer events cover mouse, touch and stylus;
  // it is the older HTML5 drag API that is mouse-only.
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  const [menuFor, setMenuFor] = useState(null)

  // Close on any click that is not inside a menu, and on Escape. A menu
  // left open after the page moves on is worse than no menu.
  useEffect(() => {
    if (!menuFor) return
    const away = e => { if (!e.target.closest || !e.target.closest('[data-stage-menu]')) setMenuFor(null) }
    const esc = e => { if (e.key === 'Escape') setMenuFor(null) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [menuFor])
  const [renaming, setRenaming] = useState(null)
  const [renameTo, setRenameTo] = useState('')
  const [busy, setBusy] = useState(false)
  const { sections, tasks, project, deps = {}, links = [], moved = {}, ms = [] } = detail
  const sec = sections.find(s => s.id === sectionId)
  const pkgs = sections.filter(s => s.parent_id === sectionId).sort((a, b) => a.sort_order - b.sort_order)
  const pkgIds = pkgs.map(p => p.id)
  const mine = tasks.filter(t => pkgIds.includes(t.section_id))
  const today = today0()

  const addStage = async () => {
    const name = stageName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const next = pkgs.length ? Math.max(...pkgs.map(p => p.sort_order)) + 1 : 1
      const { error } = await supabase.from('project_sections')
        .insert({ project_id: project.id, parent_id: sectionId, name, sort_order: next })
        .select()
      if (error) throw error
      setAddingStage(false); setStageName(''); onChanged()
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  // Arrows: swap with the neighbour. Two writes, and a concurrent edit
  // elsewhere in the project cannot be clobbered.
  const moveStage = async (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= pkgs.length || busy) return
    setBusy(true)
    try {
      const a = pkgs[i], b = pkgs[j]
      await supabase.from('project_sections').update({ sort_order: b.sort_order }).eq('id', a.id).select()
      await supabase.from('project_sections').update({ sort_order: a.sort_order }).eq('id', b.id).select()
      onChanged()
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  // Drag: renumber the whole section 1..n, because a drag can move an
  // item several places and swapping does not express that.
  const dropOn = async (fromId, toId) => {
    if (!fromId || !toId || fromId === toId || busy) return
    const from = pkgs.findIndex(p => p.id === fromId)
    const target = pkgs.findIndex(p => p.id === toId)
    if (from < 0 || target < 0) return
    setBusy(true)
    try {
      const next = pkgs.slice()
      const [moved] = next.splice(from, 1)
      next.splice(target, 0, moved)
      for (let i = 0; i < next.length; i++) {
        if (next[i].sort_order !== i + 1) {
          const { error } = await supabase.from('project_sections')
            .update({ sort_order: i + 1 }).eq('id', next[i].id).select()
          if (error) throw error
        }
      }
      onChanged()
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  const renameStage = async (pk) => {
    const name = renameTo.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const { error } = await supabase.from('project_sections')
        .update({ name }).eq('id', pk.id).select()
      if (error) throw error
      setRenaming(null); setRenameTo(''); onChanged()
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  const deleteStage = async (pk) => {
    const n = mine.filter(t => t.section_id === pk.id).length
    if (n > 0) {
      alert(`"${pk.name}" still holds ${n} task(s). Move or remove them first — `
        + 'deleting this would strip them out of the structure while leaving them '
        + 'on the project, so they would disappear from every screen but still '
        + 'count in the total.')
      return
    }
    if (!confirm(`Delete the stage "${pk.name}"?`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('project_sections').delete().eq('id', pk.id)
      if (error) throw error
      onChanged()
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  // Tap to pick up, tap to place. HTML5 drag fires nothing on a touch
  // screen, so the handle did nothing on a phone. This behaves the same
  // on both, needs no long-press timing, and is easier to correct than
  // a drag on a small screen.
  const stageStyle = (pk) => ({
    ...card,
    opacity: dragId === pk.id ? .5 : 1,
    outline: (overId === pk.id && dragId && dragId !== pk.id) ? '2px solid #3B82F6' : 'none',
    // touchAction none on the handle only, so the card itself still
    // scrolls normally on a phone.
    userSelect: dragId ? 'none' : 'auto'
  })

  const StageControls = ({ i, pk }) => {
    if (!canEdit) return null
    const open = menuFor === pk.id
    const item = (label, onClick, opts = {}) => (
      <button key={label}
        style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none',
                 border: 0, padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                 fontFamily: 'inherit', whiteSpace: 'nowrap',
                 color: opts.danger ? C.red : C.ink,
                 opacity: opts.disabled ? .4 : 1 }}
        disabled={opts.disabled || busy}
        onClick={() => { setMenuFor(null); onClick() }}>{label}</button>
    )
    return (
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <DragHandle id={pk.id} />
        <span data-stage-menu style={{ position: 'relative' }}>
          <button style={{ ...miniBtn, padding: '3px 10px', fontSize: 15, lineHeight: 1 }}
                  title="More" aria-haspopup="menu" aria-expanded={open}
                  onClick={() => setMenuFor(open ? null : pk.id)}>⋯</button>
          {open &&
            <span role="menu" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 40,
                     background: 'var(--s4)', border: `1px solid ${C.line}`, borderRadius: 10,
                     boxShadow: '0 6px 20px rgba(26,32,51,.12)', padding: '4px 0',
                     minWidth: 168 }}>
              {item('Move up', () => moveStage(i, -1), { disabled: i === 0 })}
              {item('Move down', () => moveStage(i, 1), { disabled: i === pkgs.length - 1 })}
              <span style={{ display: 'block', height: 1, background: C.line, margin: '4px 0' }} />
              {item('Rename', () => { setRenaming(pk.id); setRenameTo(pk.name) })}
              {item((deps[pk.id] || []).length
                      ? `Dependencies (${deps[pk.id].length})` : 'Dependencies…',
                    () => setEditingDeps(editingDeps === pk.id ? null : pk.id))}
              <span style={{ display: 'block', height: 1, background: C.line, margin: '4px 0' }} />
              {item('Delete stage', () => deleteStage(pk), { danger: true })}
            </span>}
        </span>
      </span>
    )
  }

  // Handlers live on the container, exactly as the stat cards do: a
  // pointerdown that did not land on a handle is ignored, and
  // elementFromPoint tells us which card the pointer is currently over.
  const dragBox = canEdit ? {
    onPointerDown: e => {
      const h = e.target.closest && e.target.closest('[data-stage-handle]')
      if (!h) return
      setDragId(h.getAttribute('data-stage-handle')); setOverId(null)
    },
    onPointerMove: e => {
      if (!dragId) return
      e.preventDefault()
      const t = document.elementFromPoint(e.clientX, e.clientY)
      const el = t && t.closest ? t.closest('[data-stage-card]') : null
      setOverId(el ? el.getAttribute('data-stage-card') : null)
    },
    onPointerUp: () => {
      const from = dragId, to = overId
      setDragId(null); setOverId(null)
      dropOn(from, to)
    },
    onPointerCancel: () => { setDragId(null); setOverId(null) }
  } : {}

  // Shown in place of the stage name while renaming.
  const StageName = ({ pk, extra }) => renaming === pk.id ? (
    <span style={{ display: 'flex', gap: 6, flex: 1 }}>
      <input style={{ flex: 1, padding: '5px 8px', border: `1px solid ${C.line2}`,
               borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}
             value={renameTo} autoFocus
             onChange={e => setRenameTo(e.target.value)}
             onKeyDown={e => { if (e.key === 'Enter') renameStage(pk)
                               if (e.key === 'Escape') setRenaming(null) }} />
      <button style={miniGhost} disabled={busy} onClick={() => renameStage(pk)}>Save</button>
      <button style={miniGhost} onClick={() => setRenaming(null)}>Cancel</button>
    </span>
  ) : (
    <span style={{ fontSize: 13, flex: 1 }}>{pk.name}{extra}</span>
  )

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

  // One stable team order for the WHOLE section. Every stage renders
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
  // can never disagree about what is in a stage.
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
    // work in this stage still gets its row, so the rows line up
    // across stages — that alignment is what makes a delay visible.
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

    const predIds = deps[pk.id] || []
    const preds = predIds.map(id => sections.find(x => x.id === id)?.name).filter(Boolean)

    // sort_order is display; dependencies are the real sequence. They can
    // disagree — reordering a stage does not touch its links — and when
    // they do, the picture contradicts the plan. Say so rather than let
    // it read as a bug.
    const myPos = pkgs.findIndex(x => x.id === pk.id)
    const outOfOrder = predIds
      .map(id => ({ id, pos: pkgs.findIndex(x => x.id === id) }))
      .filter(p => p.pos > myPos)
      .map(p => sections.find(x => x.id === p.id)?.name)
      .filter(Boolean)
    const slip = all.map(t => moved[t.id]).filter(e => e && e.kind === 'shift')
      .reduce((m, e) => Math.max(m, e.delta_days || 0), 0)

    return { pk, all, attachments, byTeam, bars, preds, slip, outOfOrder }
  })

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={crumb} onClick={onBack}>‹ {project.name}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{sec?.name}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between',
             alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: C.ink2 }}>
          {mine.filter(isDone).length} of {mine.length} approved ·{' '}
          {pkgs.length} stage{pkgs.length !== 1 ? 's' : ''}
        </span>
        {canEdit && !addingStage &&
          <button style={miniGhost} onClick={() => { setAddingStage(true); setStageName('') }}>
            + Add stage
          </button>}
      </div>
      {addingStage &&
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input style={{ flex: 1, padding: '8px 9px', border: `1px solid ${C.line2}`,
                   borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}
                 placeholder="Stage name, e.g. Safety checks" value={stageName} autoFocus
                 onChange={e => setStageName(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') addStage()
                                   if (e.key === 'Escape') setAddingStage(false) }} />
          <button style={{ background: 'var(--brand)', color: '#fff', border: 0, borderRadius: 8,
                   padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}
                  disabled={busy || !stageName.trim()} onClick={addStage}>Add</button>
          <button style={miniGhost} onClick={() => setAddingStage(false)}>Cancel</button>
        </div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, fontSize: 11, color: C.ink3 }}>
        {teamOrder.map(k => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <i style={{ width: 9, height: 9, borderRadius: 4, background: teamColour(k).solid }} />
            {teamNames[k]}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <i style={{ width: 16, height: 9, borderRadius: 4, background: C.ink3, opacity: .3 }} />
          faded = still open
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <i style={{ width: 4, height: 11, borderRadius: 4, background: C.red }} />
          overdue
        </span>
      </div>

      <div style={{ fontSize: 15, fontWeight: 600, color: C.ink, margin: '6px 0 8px' }}>
        Timeline
      </div>
      <div style={card}>
        {/* Horizontal scroll below 720px. The chart keeps its geometry and
            the viewport moves, rather than the bars compressing into a
            strip. Everything inside scrolls together — splitting the names
            into a pinned pane risks a bar under the wrong label. */}
        <div style={{ overflowX: 'auto', overflowY: 'hidden',
               WebkitOverflowScrolling: 'touch',
               overscrollBehaviorX: 'contain',
               margin: '0 -14px', padding: '0 14px' }}>
        <div style={{ minWidth: 720 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr)', gap: 8,
               borderBottom: `1px solid ${C.line}`, paddingBottom: 5 }}>
          <span style={{ position: 'sticky', left: 0, zIndex: 3,
                   background: 'var(--card)' }} />
          <span style={{ display: 'flex', justifyContent: 'space-between',
                   fontSize: 11, color: C.ink3 }}>
            <span>{fmt(lo)}</span><span>{fmt(hi)}</span>
          </span>
        </div>
        <div style={{ position: 'relative', paddingTop: 6 }}>
          {/* Sits inside the track, not across the name column. */}
          <div style={{ position: 'absolute', left: 'calc(150px + 8px)', right: 0,
                 top: 0, bottom: 6, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: `${pos(today)}%`, top: 0, bottom: 0,
                   width: 1, background: C.ink3 }} />
          </div>
          {packages.map(({ pk, all, attachments, bars, preds, slip, outOfOrder }) => {
            if (!all.length) return null
            const openAtt = attachments.filter(t => !isDone(t)).length
            return (
              <div key={pk.id} style={{ padding: '10px 0 4px' }}>
                {/* Width of the name column, so nothing in the first
                    column runs past where the dates start. Wraps here
                    rather than stretching across the scrolling canvas. */}
                <div style={{ width: 150, marginBottom: 4,
                       position: 'sticky', left: 0, zIndex: 3,
                       background: 'var(--card)' }}>
                  {/* One fact per line. As a single run with dot separators
                      this wrapped wherever the 150px ran out rather than
                      where the meaning broke — "after" stranded at the end
                      of a line, "days" orphaned on its own. A line break
                      says what the dot said, and reads better narrow. */}
                  <div style={{ fontSize: 13, lineHeight: 1.35 }}>{pk.name}</div>
                  {preds.length > 0 &&
                    <div style={{ fontSize: 11, color: C.ink3, lineHeight: 1.35 }}>
                      after {preds.join(' and ')}
                    </div>}
                  {slip > 0 &&
                    <div style={{ fontSize: 11, color: C.amberDeep, lineHeight: 1.35 }}>
                      pushed {slip} days
                    </div>}
                  {outOfOrder && outOfOrder.length > 0 &&
                    <div style={{ fontSize: 11, color: C.red, lineHeight: 1.35 }}>
                      listed above {outOfOrder.join(' and ')}, which it waits on
                    </div>}
                  <div style={{ fontSize: 12, color: C.ink2, marginTop: 2 }}>
                    {all.filter(isDone).length}/{all.length} done
                    {openAtt > 0 && <span style={{ color: C.amberDeep }}> · ⚑{openAtt}</span>}
                  </div>
                </div>
                {/* Fixed name column, then the track. Nothing floats, so
                    nothing can collide. */}
                {bars.map(bar => (
                  <div key={bar.key} style={{ display: 'grid',
                         gridTemplateColumns: '150px minmax(0,1fr)',
                         alignItems: 'center', gap: 8, height: 26 }}>
                    <span style={{ fontSize: 11, color: C.ink3, overflow: 'hidden',
                             textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                             display: 'flex', alignItems: 'center', gap: 6,
                             position: 'sticky', left: 0, zIndex: 3,
                             background: 'var(--card)', paddingRight: 8,
                             boxShadow: `1px 0 0 ${C.line}` }}>
                      <i style={{ width: 9, height: 9, borderRadius: 4, flex: 'none',
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
        </div>
        {/* Only where there is something to scroll; above 760px the
            minimum never engages and this line would be untrue. */}
        <div style={{ fontSize: 11, color: C.ink3, marginTop: 8 }} className="tl-swipe-hint">
          Swipe the chart sideways to see the whole period
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8,
             margin: '22px 0 8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>Stages</span>
        {canEdit &&
          <span style={{ fontSize: 11, color: C.ink3 }}>
            drag the handle to reorder
          </span>}
      </div>
      <div {...dragBox}>
      {packages.map(({ pk, all, byTeam, attachments }, idx) => {
        // An empty stage still gets a card, otherwise there is nowhere
        // to add its first task and a new stage is unreachable.
        if (!all.length) {
          return (
            <div key={pk.id} data-stage-card={pk.id} style={stageStyle(pk)}>
              <div style={{ display: 'flex', justifyContent: 'space-between',
                     alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <StageName pk={pk} extra={
                  <span style={{ fontSize: 11, color: C.ink3 }}> · no tasks yet</span>} />
                <StageControls i={idx} pk={pk} />
                {canEdit && addingTo !== pk.id &&
                  <button style={miniGhost}
                          onClick={() => setAddingTo(pk.id)}>+ Add task</button>}
              </div>
              {editingDeps === pk.id &&
                <DependencyEditor project={project} stage={pk} sections={sections}
                  links={links} onChanged={onChanged}
                  onClose={() => setEditingDeps(null)} />}
              {addingTo === pk.id &&
                <TaskForm project={project} stage={pk} stages={sections} orgName={orgName}
                  user={user} milestones={ms}
                  onCancel={() => setAddingTo(null)}
                  onDone={() => { setAddingTo(null); onChanged() }} />}
            </div>
          )
        }
        return (
          <div key={pk.id} data-stage-card={pk.id} style={stageStyle(pk)}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
                   alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
              <StageName pk={pk} />
              <StageControls i={idx} pk={pk} />
              {canEdit && addingTo !== pk.id &&
                <button style={miniGhost}
                        onClick={() => setAddingTo(pk.id)}>+ Add task</button>}
            </div>
            {editingDeps === pk.id &&
              <DependencyEditor project={project} stage={pk} sections={sections}
                links={links} onChanged={onChanged}
                onClose={() => setEditingDeps(null)} />}
            {addingTo === pk.id &&
              <TaskForm project={project} stage={pk} stages={sections} orgName={orgName}
                user={user} milestones={ms}
                onCancel={() => setAddingTo(null)}
                onDone={() => { setAddingTo(null); onChanged() }} />}
            {Object.keys(byTeam).map(k => (
              <TeamBlock key={k} name={byTeam[k][0].team_name || 'Unassigned'}
                         colour={teamColour(k).solid}
                         tasks={byTeam[k]} moved={moved} sections={sections}
                         canEdit={canEdit} editingId={editingTask} stage={pk}
                         onEdit={id => setEditingTask(id)}
                         renderForm={t => (
                           <TaskForm project={project} stage={pk} stages={sections}
                             orgName={orgName} user={user} milestones={ms} task={t}
                             onCancel={() => setEditingTask(null)}
                             onDone={() => { setEditingTask(null); onChanged() }} />)} />
            ))}
            {attachments.length > 0 &&
              <TeamBlock name="Attached — blocks a milestone" tasks={attachments}
                         moved={moved} sections={sections} flag
                         canEdit={canEdit} editingId={editingTask} stage={pk}
                         onEdit={id => setEditingTask(id)}
                         renderForm={t => (
                           <TaskForm project={project} stage={pk} stages={sections}
                             orgName={orgName} user={user} milestones={ms} task={t}
                             onCancel={() => setEditingTask(null)}
                             onDone={() => { setEditingTask(null); onChanged() }} />)} />}
          </div>
        )
      })}
      </div>
    </div>
  )
}

function TeamBlock({ name, tasks, moved, sections, flag, colour,
                     canEdit, editingId, onEdit, renderForm }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: flag ? C.amberDeep : C.ink3, marginBottom: 4,
             display: 'flex', alignItems: 'center', gap: 6 }}>
        {colour && <i style={{ width: 9, height: 9, borderRadius: 4, flex: 'none', background: colour }} />}
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
          <div key={t.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.line}`,
                 cursor: canEdit ? 'pointer' : 'default' }}
               onClick={() => canEdit && onEdit(editingId === t.id ? null : t.id)}>
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
            {canEdit && editingId === t.id && renderForm &&
              <div onClick={e => e.stopPropagation()}>{renderForm(t)}</div>}
          </div>
        )
      })}
    </div>
  )
}

/* ===================================================================== */
function Bar({ pct }) {
  return <div style={{ height: 5, background: C.line, borderRadius: 4, overflow: 'hidden', margin: '7px 0' }}>
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
// Drawn inline rather than imported: no image to ship, no library, no
// licensing question, and it stays sharp at any size. A hand with
// movement arrows reads as "pick this up and move it" to someone who
// has never seen a six-dot handle.
function DragHandle({ id }) {
  return (
    <span data-stage-handle={id} title="Drag to reorder"
          style={{ cursor: 'grab', touchAction: 'none', display: 'inline-flex',
                   alignItems: 'center', justifyContent: 'center',
                   width: 30, height: 26, borderRadius: 8,
                   border: `1px solid ${C.line2}`, color: C.ink2 }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
           strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
        {/* hand */}
        <path d="M9 11V5.6a1.6 1.6 0 0 1 3.2 0V11" />
        <path d="M12.2 11V7.4a1.6 1.6 0 0 1 3.2 0V11" />
        <path d="M15.4 11.4v-2a1.6 1.6 0 0 1 3.2 0V15a5.4 5.4 0 0 1-5.4 5.4h-1.1
                 a4 4 0 0 1-2.9-1.3L5.5 15" />
        <path d="M9 11v3.2L7.4 12.6a1.5 1.5 0 0 0-2.2 2.1" />
        {/* movement arrows */}
        <path d="M3.2 6.4h3.4M4.6 4.9 3.1 6.4l1.5 1.5" />
      </svg>
    </span>
  )
}

function Pill({ children }) {
  return <span style={{ marginLeft: 6, fontSize: 11, padding: '2px 8px', borderRadius: 20, background: C.soft, color: C.ink2 }}>{children}</span>
}

const miniBtn = { background: 'transparent', color: C.ink2, border: `1px solid ${C.line2}`,
  borderRadius: 8, padding: '1px 7px', fontSize: 12, cursor: 'pointer', lineHeight: 1.3 }
const miniGhost = { background: 'transparent', color: C.ink2, border: `1px solid ${C.line2}`,
  borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }
const crumb = { fontSize: 12, color: C.ink2, cursor: 'pointer', marginBottom: 6 }
const btnGhost = { background: 'transparent', color: C.ink2, border: `1px solid ${C.line2}`,
  borderRadius: 8, padding: '5px 11px', fontSize: 12, cursor: 'pointer' }
const lbl = { display: 'block', fontSize: 12, color: C.ink2, margin: '10px 0 3px' }
const inp = { width: '100%', padding: '9px 10px', border: `1px solid ${C.line2}`, borderRadius: 8,
  fontSize: 14, fontFamily: 'inherit' }
const modalWrap = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }
const modalBox = { background: 'var(--s4)', borderRadius: 12, padding: 18, width: '100%', maxWidth: 460 }
