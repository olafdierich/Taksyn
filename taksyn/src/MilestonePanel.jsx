import { useState } from 'react'
import { supabase } from './supabase.js'

/*
  MilestonePanel — create, edit, meet and remove a project's gates.

  A milestone is a dated gate, not a task. Nobody is assigned to it and
  it has no duration. What it holds is an assertion: on this date, this
  person stated that a stage was finished. That assertion is the
  compliance artefact, which is why the rules below are stricter than
  they look.

  MILESTONES DO NOT MOVE WITH THE CHAIN
  Stages shift when work slips. Gates do not. Work being pushed past a
  milestone is the signal, and sliding the gate to meet the delay would
  erase exactly what is worth knowing. Rescheduling is a deliberate edit
  by an admin, with an author on it, never an automatic consequence.

  MEETING GOES THROUGH THE RPC
  mark_milestone_met refuses while any task under the gate is open, and
  names blockers separately from ordinary work because the fix differs —
  an open blocker is usually a corrective action somebody forgot, not
  slow progress. Doing it as a direct UPDATE here would go round both
  checks, so the button calls the function.

  A MET MILESTONE CANNOT BE DELETED
  Enforced by the RLS policy in block 10, not by hiding the button.
  Deleting one would erase an attributed statement that a stage was
  complete, which is the kind of thing an audit trail exists to keep.
*/

const C = {
  green: '#10B981', amber: '#F59E0B', red: '#EF4444', blue: '#3B82F6',
  line: '#E2E8F0', line2: '#CBD5E1',
  ink: '#1A2033', ink2: '#6B7280', ink3: '#9CA3AF',
  card: '#FFFFFF', soft: '#F4F6F9'
}

const D = s => (s ? new Date(s + 'T00:00:00') : null)
const fmt = d => d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export default function MilestonePanel({ project, sections, milestones, canEdit, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [f, setF] = useState({ name: '', dueDate: '', sectionId: '', locked: false, lockReason: '' })

  const topSections = sections.filter(s => !s.parent_id)

  const blank = () => setF({ name: '', dueDate: '', sectionId: '', locked: false, lockReason: '' })

  const openEdit = (m) => {
    setEditing(m.milestone_id)
    setAdding(false)
    setF({
      name: m.name, dueDate: m.due_date, sectionId: m.section_id || '',
      locked: !!m.date_locked, lockReason: m.lock_reason || ''
    })
  }

  const validate = () => {
    if (!f.name.trim()) return 'A milestone needs a name.'
    if (!f.dueDate) return 'A milestone needs a date — that is what makes it a gate.'
    if (f.locked && f.lockReason.trim().length < 10) {
      return 'A locked gate needs a reason of at least 10 characters. It is what an '
        + 'inspector reads when the date did not move.'
    }
    return null
  }

  const save = async () => {
    const err = validate()
    if (err) { alert(err); return }
    if (busy) return
    setBusy(true)
    try {
      const row = {
        name: f.name.trim(),
        due_date: f.dueDate,
        section_id: f.sectionId || null,
        date_locked: !!f.locked,
        lock_reason: f.locked ? f.lockReason.trim() : null
      }
      // .select() so a silent RLS refusal is caught — PostgREST returns
      // 200 with error null when a policy filters a write.
      const res = editing
        ? await supabase.from('project_milestones').update(row).eq('id', editing).select()
        : await supabase.from('project_milestones')
            .insert({ ...row, org: project.org, project_id: project.id }).select()
      if (res.error) throw res.error
      if (!res.data || !res.data.length) {
        throw new Error('Nothing was written. This is usually a permissions problem.')
      }
      setAdding(false); setEditing(null); blank(); onChanged()
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  const meet = async (m) => {
    const note = prompt(
      `Mark "${m.name}" as met?\n\n`
      + 'This records that you state this gate is complete, with your name and the '
      + 'time against it. Add a note if it helps whoever reads this later.', '')
    if (note === null) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc('mark_milestone_met', {
        p_milestone_id: m.milestone_id,
        p_note: note.trim() || null
      })
      if (error) throw error
      onChanged()
    } catch (e) {
      // The function's own messages are the useful ones — "2 open
      // blocker(s) must be closed first" tells you what to do next.
      alert(e.message || String(e))
    }
    finally { setBusy(false) }
  }

  const remove = async (m) => {
    if (m.status === 'met') {
      alert('A met milestone cannot be deleted. It records that someone stated this '
        + 'gate was complete, with their name and the time on it.')
      return
    }
    if (!confirm(`Delete the milestone "${m.name}"?`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('project_milestones').delete().eq('id', m.milestone_id)
      if (error) throw error
      onChanged()
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  const stateOf = (m) => {
    if (m.status === 'met') return { label: 'Met', colour: C.green }
    if (m.at_risk) return {
      label: `At risk — open work runs to ${fmt(D(m.latest_open_due))}`, colour: '#DC2626' }
    if (m.blockers_open) return {
      label: `${m.blockers_open} open blocker${m.blockers_open > 1 ? 's' : ''}`, colour: '#B45309' }
    if (m.ready_to_meet) return { label: 'Ready to be met', colour: C.blue }
    return { label: `${m.tasks_open} task${m.tasks_open !== 1 ? 's' : ''} open`, colour: C.ink2 }
  }

  const Form = () => (
    <div style={{ background: C.soft, borderRadius: 10, padding: 12, marginTop: 8 }}>
      <label style={lbl}>What is being asserted *</label>
      <input style={inp} value={f.name} autoFocus
             placeholder="e.g. Documentation complete"
             onChange={e => setF({ ...f, name: e.target.value })} />

      <div style={row2}>
        <div>
          <label style={lbl}>Date *</label>
          <input style={inp} type="date" value={f.dueDate}
                 onChange={e => setF({ ...f, dueDate: e.target.value })} />
        </div>
        <div>
          <label style={lbl}>Closes which section</label>
          <select style={inp} value={f.sectionId}
                  onChange={e => setF({ ...f, sectionId: e.target.value })}>
            <option value="">Whole project</option>
            {topSections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      <label style={{ ...chk, marginTop: 10 }}>
        <input type="checkbox" checked={f.locked}
               onChange={e => setF({ ...f, locked: e.target.checked })} />
        <span>This gate cannot be rescheduled</span>
      </label>
      <div style={{ fontSize: 11, color: C.ink3, marginLeft: 22, marginTop: -2 }}>
        For statutory dates. Milestones never move automatically; this stops one
        being moved by hand as well.
      </div>
      {f.locked &&
        <input style={{ ...inp, marginTop: 6 }} value={f.lockReason}
               placeholder="Why can it not move? e.g. Audit date set by the Commission"
               onChange={e => setF({ ...f, lockReason: e.target.value })} />}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button style={btnGhost}
                onClick={() => { setAdding(false); setEditing(null); blank() }}>Cancel</button>
        <button style={{ ...btn, opacity: busy ? .5 : 1 }} disabled={busy} onClick={save}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Add milestone'}
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12,
           padding: 14, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
             alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>Milestones</span>
        {canEdit && !adding && !editing &&
          <button style={btnGhost}
                  onClick={() => { setAdding(true); setEditing(null); blank() }}>
            + Add milestone
          </button>}
      </div>

      {milestones.length === 0 && !adding &&
        <div style={{ fontSize: 12, color: C.ink3, padding: '6px 0' }}>
          No gates yet. A milestone is a dated point where someone states a stage is
          finished — the project cannot be signed off until every one is met.
        </div>}

      {milestones.map(m => {
        const st = stateOf(m)
        return (
          <div key={m.milestone_id} style={{ borderTop: `1px solid ${C.line}`, padding: '9px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
                   gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13 }}>
                {m.date_locked && '🔒 '}{m.name}
                <span style={{ color: C.ink2 }}> · {fmt(D(m.due_date))}</span>
              </span>
              <span style={{ fontSize: 12, color: st.colour }}>{st.label}</span>
            </div>

            <div style={{ fontSize: 11, color: C.ink3, marginTop: 3 }}>
              {m.tasks_done}/{m.task_count} task{m.task_count !== 1 ? 's' : ''} done
              {m.section_id && sections.find(s => s.id === m.section_id) &&
                ` · closes ${sections.find(s => s.id === m.section_id).name}`}
              {m.status === 'met' && m.met_at &&
                ` · met ${new Date(m.met_at).toLocaleDateString()}`}
            </div>

            {canEdit && editing !== m.milestone_id &&
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {m.status === 'open' &&
                  <button style={{ ...btnGhost,
                           borderColor: m.ready_to_meet ? C.green : C.line2,
                           color: m.ready_to_meet ? C.green : C.ink2 }}
                          disabled={busy} onClick={() => meet(m)}>Mark met</button>}
                <button style={btnGhost} disabled={busy}
                        onClick={() => openEdit(m)}>Edit</button>
                {m.status !== 'met' &&
                  <button style={{ ...btnGhost, color: C.red, borderColor: '#FCA5A5' }}
                          disabled={busy} onClick={() => remove(m)}>Delete</button>}
              </div>}

            {editing === m.milestone_id && <Form />}
          </div>
        )
      })}

      {adding && <Form />}
    </div>
  )
}

const lbl = { display: 'block', fontSize: 11, color: C.ink2, margin: '9px 0 3px' }
const inp = { width: '100%', padding: '8px 9px', border: `1px solid ${C.line2}`,
  borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff' }
const row2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }
const chk = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.ink }
const btn = { background: C.ink, color: '#fff', border: 0, borderRadius: 8,
  padding: '8px 14px', fontSize: 13, cursor: 'pointer' }
const btnGhost = { background: 'transparent', color: C.ink2, border: `1px solid ${C.line2}`,
  borderRadius: 8, padding: '5px 11px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }
