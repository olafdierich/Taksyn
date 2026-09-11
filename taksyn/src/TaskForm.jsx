import { useState, useEffect } from 'react'
import { supabase } from './supabase.js'

/*
  TaskForm — create OR edit a task inside a project stage.

  One component for both because the fields are identical and two
  copies would drift. `task` present = edit, absent = create.

  Projects shuffle constantly: people move between teams, dates slip,
  work turns out to belong to a different stage. All of that has to be
  possible from the screen you are already on, which is why this handles
  reassigning, re-dating and moving between stages rather than sending
  you to the main task editor.

  FOUR THINGS THAT MUST BE RIGHT ON WRITE

  1. tasks.org holds the ORG NAME, not the ID.
     RLS is: org IN (select p.org from profiles p where p.id = auth.uid())
     and profiles.org stores the name. Writing the ID produces a row
     nobody — including its author — can read back.

  2. BOTH assignee columns get written.
     assigned_user_id (scalar) and assigned_user_ids (array) both exist;
     the migration to the array is half-done with 67+ scalar readers
     still live. Array-only shows as unassigned on the Performance view.

  3. tasks.id has no default. 'T' + epoch matches every existing row.

  4. recurrence is 'once'. A recurring task has no finish so it cannot
     sit in a dependency chain. Not offered, and this is the guard until
     a check constraint exists.

  PEOPLE ARE FETCHED IN TWO QUERIES, joined here. PostgREST can only
  embed profiles(name) if a foreign key joins the tables, and
  org_members.user_id references auth.users — so the embed silently
  returned nothing.
*/

const C = {
  green: '#10B981', amber: '#F59E0B', red: '#EF4444', blue: '#3B82F6',
  line: 'var(--border)', line2: 'var(--border2)',
  ink: 'var(--text)', ink2: 'var(--t2)', ink3: 'var(--t3)',
  card: 'var(--card)', soft: 'var(--s3)'
}

export default function TaskForm({
  project, stage, stages = [], orgName, user, milestones = [], task = null,
  onDone, onCancel
}) {
  const editing = !!task
  const [teams, setTeams] = useState([])
  const [people, setPeople] = useState([])
  const [busy, setBusy] = useState(false)
  // STAGE-CHECKLIST-V1: some rows store subtasks as a JSON string, others as an array.
  const [items, setItems] = useState(() => {
    let s = task?.subtasks
    if (typeof s === 'string') { try { s = JSON.parse(s) } catch (e) { s = [] } }
    return Array.isArray(s) ? s : []
  })
  const [clOpen, setClOpen] = useState(false)
  const [instrOpen, setInstrOpen] = useState(null)
  const setItem = (i, patch) => setItems(prev => prev.map((x, j) => j === i ? { ...x, ...patch } : x))
  const [f, setF] = useState({
    title: task?.title || '',
    stageId: task?.section_id || stage?.id || '',
    teamId: task?.team_id || '',
    assigneeId: (task?.assigned_user_ids?.[0]) || task?.assigned_user_id || '',
    approverId: task?.approver_id || '',
    dueDate: task?.due_date || '',
    milestoneId: task?.milestone_id || '',
    locked: !!task?.due_date_locked,
    lockReason: task?.due_date_lock_reason || '',
    blocksMilestone: !!task?.blocks_milestone
  })

  useEffect(() => {
    let dead = false
    ;(async () => {
      const [{ data: t }, { data: m }] = await Promise.all([
        supabase.from('teams').select('id,name').eq('org', project.org).order('name'),
        supabase.from('org_members').select('user_id,role')
          .eq('org', project.org).not('user_id', 'is', null)
      ])
      if (dead) return
      setTeams(t || [])
      const ids = (m || []).map(x => x.user_id).filter(Boolean)
      let names = {}
      if (ids.length) {
        const { data: pr } = await supabase.from('profiles').select('id,name').in('id', ids)
        ;(pr || []).forEach(p => { names[p.id] = p.name })
      }
      if (dead) return
      setPeople((m || [])
        .filter(x => names[x.user_id])
        .map(x => ({ id: x.user_id, name: names[x.user_id], role: x.role }))
        .sort((a, b) => a.name.localeCompare(b.name)))
    })()
    return () => { dead = true }
  }, [project.org])

  const approvers = people.filter(p => ['supervisor', 'manager', 'client_admin'].includes(p.role))

  const buildRow = () => {
    const team = teams.find(t => t.id === f.teamId)
    const assignee = people.find(p => p.id === f.assigneeId)
    const approver = people.find(p => p.id === f.approverId)

    const row = {
      // STAGE-CHECKLIST-V1: same item shape the rest of the app reads.
      subtasks: JSON.stringify(items
        .filter(it => String(it.text || '').trim())
        .map(it => ({
          id: it.id || ('s' + Date.now() + Math.random()),
          text: String(it.text).trim(),
          done: !!it.done,
          mandatory: !!it.mandatory,
          requirePhoto: !!it.requirePhoto,
          requireTimestamp: !!it.requireTimestamp,
          instruction: it.instruction || '',
          note: it.note || '',
          photo: it.photo || null,
          history: it.history || []
        }))),
      title: f.title.trim(),
      due_date: f.dueDate,
      section_id: f.stageId || null,
      milestone_id: f.milestoneId || null,
      blocks_milestone: !!f.blocksMilestone,
      due_date_locked: !!f.locked,
      due_date_lock_reason: f.locked ? f.lockReason.trim() : null,
      // Explicit nulls, not omissions: clearing a team or an assignee is
      // a thing people do, and leaving the key out would silently keep
      // the old value on an update.
      team_id: team ? team.id : null,
      team_name: team ? team.name : null,
      assigned_user_ids: assignee ? [assignee.id] : [],
      assigned_user_names: assignee ? [assignee.name] : [],
      assigned_user_id: assignee ? assignee.id : null,
      assigned_user_name: assignee ? assignee.name : null,
      approver_id: approver ? approver.id : null,
      approver_name: approver ? approver.name : null,
      requires_approval: !!approver
    }
    return row
  }

  const submit = async () => {
    if (!f.title.trim() || !f.dueDate || busy) return
    if (f.locked && f.lockReason.trim().length < 10) {
      alert('A locked date needs a reason of at least 10 characters — it is what an inspector reads when the date did not move.')
      return
    }
    setBusy(true)
    try {
      const row = buildRow()
      let res
      if (editing) {
        // .select() so a silent RLS refusal is caught: PostgREST returns
        // 200 with error null when a policy filters a write.
        res = await supabase.from('tasks').update(row).eq('id', task.id).select()
      } else {
        res = await supabase.from('tasks').insert({
          ...row,
          id: 'T' + Date.now(),
          org: orgName,
          status: 'pending',
          recurrence: 'once',
          project_id: project.id,
          created_by: user?.name || null
        }).select()
      }
      if (res.error) throw res.error
      if (!res.data || !res.data.length) {
        throw new Error('Nothing was written. This is usually a permissions problem.')
      }
      onDone()
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  // Removing a task from a project, not deleting the task itself. The
  // work may still be real — it just does not belong to this plan. A
  // hard delete is available on the main task screen, where the full
  // consequences are visible.
  const detach = async () => {
    if (!confirm(`Remove "${task.title}" from this project?\n\n`
      + 'The task itself is kept and stays on the Tasks page. It is only '
      + 'taken out of this project\'s plan.')) return
    setBusy(true)
    try {
      const { error } = await supabase.from('tasks')
        .update({ project_id: null, section_id: null, milestone_id: null })
        .eq('id', task.id).select()
      if (error) throw error
      onDone()
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  const stageOptions = stages.filter(s => s.parent_id)

  return (
    <div style={{ background: C.soft, borderRadius: 10, padding: 12, marginTop: 8 }}>
      <div style={{ fontSize: 12, color: C.ink2, marginBottom: 8 }}>
        {editing ? 'Editing' : 'New task in'} <strong>{stage?.name || 'this stage'}</strong>
      </div>

      <label style={lbl}>What needs doing *</label>
      <input style={inp} value={f.title} autoFocus placeholder="e.g. Fire safety inspection"
             onChange={e => setF({ ...f, title: e.target.value })} />
      {/* STAGE-CHECKLIST-V1: these become templates others may reuse. */}
      <div style={{ fontSize: 11, color: C.ink3, marginTop: 3 }}>
        No names or personal details in the title or checklist items.
      </div>

      <div style={row2}>
        <div>
          <label style={lbl}>Stage</label>
          <select style={inp} value={f.stageId}
                  onChange={e => setF({ ...f, stageId: e.target.value })}>
            {stageOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Due *</label>
          <input style={inp} type="date" value={f.dueDate}
                 onChange={e => setF({ ...f, dueDate: e.target.value })} />
        </div>
      </div>

      <div style={row2}>
        <div>
          <label style={lbl}>Team</label>
          <select style={inp} value={f.teamId}
                  onChange={e => setF({ ...f, teamId: e.target.value })}>
            <option value="">No team</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Assigned to</label>
          <select style={inp} value={f.assigneeId}
                  onChange={e => setF({ ...f, assigneeId: e.target.value })}>
            <option value="">Unassigned</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}
          </select>
          {people.length === 0 &&
            <div style={{ fontSize: 11, color: C.amber, marginTop: 3 }}>
              No members found for this organisation.
            </div>}
        </div>
      </div>

      <div style={row2}>
        <div>
          <label style={lbl}>Approver</label>
          <select style={inp} value={f.approverId}
                  onChange={e => setF({ ...f, approverId: e.target.value })}>
            <option value="">No approval needed</option>
            {approvers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {milestones.length > 0 &&
          <div>
            <label style={lbl}>Counts towards</label>
            <select style={inp} value={f.milestoneId}
                    onChange={e => setF({ ...f, milestoneId: e.target.value })}>
              <option value="">No milestone</option>
              {milestones.map(m =>
                <option key={m.milestone_id} value={m.milestone_id}>{m.name}</option>)}
            </select>
          </div>}
      </div>

      <label style={{ ...chk, marginTop: 10 }}>
        <input type="checkbox" checked={f.locked}
               onChange={e => setF({ ...f, locked: e.target.checked })} />
        <span>This date cannot move</span>
      </label>
      <div style={{ fontSize: 11, color: C.ink3, marginLeft: 22, marginTop: -2 }}>
        For statutory or contractual dates. A delay elsewhere raises an alert
        instead of pushing this, and no extension can be requested against it.
      </div>
      {f.locked &&
        <input style={{ ...inp, marginTop: 6 }} value={f.lockReason}
               placeholder="Why can it not move? e.g. Audit date set by the Commission"
               onChange={e => setF({ ...f, lockReason: e.target.value })} />}

      {f.milestoneId &&
        <>
          <label style={{ ...chk, marginTop: 8 }}>
            <input type="checkbox" checked={f.blocksMilestone}
                   onChange={e => setF({ ...f, blocksMilestone: e.target.checked })} />
            <span>Blocks that milestone until it is done</span>
          </label>
          <div style={{ fontSize: 11, color: C.ink3, marginLeft: 22, marginTop: -2 }}>
            For corrective actions and risk controls. Blocking work is kept out of
            the timeline bars so it does not distort the plan.
          </div>
        </>}

      {/* STAGE-CHECKLIST-V1: collapsed by default so the form stays short. */}
      <div style={{ marginTop: 12, borderTop: '1px solid ' + C.line2, paddingTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: C.ink2, cursor: 'pointer' }} onClick={() => setClOpen(v => !v)}>
            {clOpen ? '\u25BE' : '\u25B8'} Checklist{items.length ? ' (' + items.length + ')' : ''}
          </span>
          {clOpen &&
            <button style={btnGhost} onClick={() => { setItems(prev => [...prev, { id: 's' + Date.now() + Math.random(), text: '', done: false, mandatory: false, requirePhoto: false, requireTimestamp: false, instruction: '', note: '', photo: null, history: [] }]); }}>+ Add item</button>}
        </div>
        {clOpen && items.length === 0 &&
          <div style={{ fontSize: 11, color: C.ink3, marginTop: 6 }}>No checklist items — optional.</div>}
        {clOpen && items.map((it, i) => {
          const flag = (on, colour) => ({ ...btnGhost, padding: '3px 7px', fontSize: 12,
            borderColor: on ? colour : undefined, color: on ? colour : C.ink2,
            background: on ? colour + '14' : 'transparent' })
          return (
            <div key={it.id || i} style={{ marginTop: 6 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input style={{ ...inp, flex: 1, margin: 0 }} placeholder={'Item ' + (i + 1)} value={it.text || ''}
                       onChange={e => setItem(i, { text: e.target.value })} />
                <button title="Mandatory — blocks submit" style={flag(it.mandatory, '#DC2626')}
                        onClick={() => setItem(i, { mandatory: !it.mandatory })}>*</button>
                <button title="Require photo evidence" style={flag(it.requirePhoto, '#3B82F6')}
                        onClick={() => setItem(i, { requirePhoto: !it.requirePhoto })}>{'\u25A3'}</button>
                <button title="Auto-timestamp on completion" style={flag(it.requireTimestamp, '#F59E0B')}
                        onClick={() => setItem(i, { requireTimestamp: !it.requireTimestamp })}>{'\u25F4'}</button>
                <button title="Instruction for the worker" style={flag(!!(it.instruction || '').trim(), '#10B981')}
                        onClick={() => setInstrOpen(instrOpen === i ? null : i)}>{'\u2261'}</button>
                <button title="Remove" style={{ ...btnGhost, padding: '3px 7px', fontSize: 12, color: C.red, borderColor: '#FCA5A5' }}
                        onClick={() => { setItems(prev => prev.filter((_, j) => j !== i)); setInstrOpen(null) }}>{'\u2715'}</button>
              </div>
              {instrOpen === i &&
                <textarea style={{ ...inp, marginTop: 4, minHeight: 52, border: '1px solid #10B981' }}
                          placeholder="Instruction for the worker (optional)" value={it.instruction || ''}
                          onChange={e => setItem(i, { instruction: e.target.value })} />}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
             gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <span>
          {editing &&
            <button style={{ ...btnGhost, color: C.red, borderColor: '#FCA5A5' }}
                    disabled={busy} onClick={detach}>Remove from project</button>}
        </span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button style={btnGhost} onClick={onCancel}>Cancel</button>
          <button style={{ ...btn, opacity: (!f.title.trim() || !f.dueDate || busy) ? .5 : 1 }}
                  disabled={!f.title.trim() || !f.dueDate || busy}
                  onClick={submit}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add task'}
          </button>
        </span>
      </div>
    </div>
  )
}

const lbl = { display: 'block', fontSize: 11, color: C.ink2, margin: '9px 0 3px' }
const inp = { width: '100%', padding: '8px 9px', border: `1px solid ${C.line2}`,
  borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--s4)' }
const row2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }
const chk = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.ink }
const btn = { background: 'var(--brand)', color: '#fff', border: 0, borderRadius: 8,
  padding: '8px 14px', fontSize: 13, cursor: 'pointer' }
const btnGhost = { background: 'transparent', color: C.ink2, border: `1px solid ${C.line2}`,
  borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer' }
