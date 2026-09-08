import { useState } from 'react'
import { supabase } from './supabase.js'

/*
  StructurePanel — create, rename, reorder and remove a project's
  sections and packages.

  Its own file rather than more of ProjectsView.jsx, which is already
  ~600 lines. The read view and the edit view have different reasons to
  change and there is no reason to couple them.

  TWO LEVELS ONLY
    parent_id null  ->  SECTION, a tile on the project overview
    parent_id set   ->  STAGE, a bar in the section cascade
  The database enforces the cap with a trigger; this just does not offer
  a third level.

  NO RPC. project_sections_write (block 6) is FOR ALL to org admins, so
  these are direct writes and RLS is the guard. Unlike projects and
  org areas there is nothing to protect beyond permission — no ref to
  allocate, no duplicate rule to apply — so an RPC would add a hop and
  guard nothing.

  DELETION REFUSES WHEN TASKS EXIST. tasks.section_id is ON DELETE SET
  NULL, so removing a stage would silently strip its tasks out of the
  structure while leaving project_id set — they would vanish from every
  screen while still counting in the project total. Better to say move
  the tasks first.
*/

const C = {
  green: '#10B981', amber: '#F59E0B', red: '#EF4444', blue: '#3B82F6',
  line: '#E2E8F0', line2: '#CBD5E1',
  ink: '#1A2033', ink2: '#6B7280', ink3: '#9CA3AF',
  card: '#FFFFFF', soft: '#F4F6F9'
}

export default function StructurePanel({ projectId, sections, tasks, canEdit, onChanged }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)      // id being renamed
  const [editName, setEditName] = useState('')
  const [adding, setAdding] = useState(null)        // 'section' | parentId
  const [newName, setNewName] = useState('')

  if (!canEdit) return null

  const tops = sections.filter(s => !s.parent_id).sort((a, b) => a.sort_order - b.sort_order)
  const kidsOf = id => sections.filter(s => s.parent_id === id).sort((a, b) => a.sort_order - b.sort_order)
  const taskCount = id => tasks.filter(t => t.section_id === id).length

  const run = async (fn) => {
    setBusy(true)
    try { await fn() ; onChanged() }
    catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  const add = (parentId) => run(async () => {
    const name = newName.trim()
    if (!name) return
    const siblings = parentId ? kidsOf(parentId) : tops
    const next = siblings.length ? Math.max(...siblings.map(s => s.sort_order)) + 1 : 1
    const { error } = await supabase.from('project_sections').insert({
      project_id: projectId, parent_id: parentId || null, name, sort_order: next
    }).select()
    if (error) throw error
    setAdding(null); setNewName('')
  })

  const rename = (id) => run(async () => {
    const name = editName.trim()
    if (!name) return
    const { error } = await supabase.from('project_sections')
      .update({ name }).eq('id', id).select()
    if (error) throw error
    setEditing(null); setEditName('')
  })

  // Swap sort_order with the neighbour. Two writes rather than
  // renumbering the whole list, so a concurrent edit elsewhere in the
  // project cannot be clobbered.
  const move = (item, dir) => run(async () => {
    const siblings = item.parent_id ? kidsOf(item.parent_id) : tops
    const i = siblings.findIndex(s => s.id === item.id)
    const j = i + dir
    if (j < 0 || j >= siblings.length) return
    const other = siblings[j]
    const [a, b] = [item.sort_order, other.sort_order]
    const { error: e1 } = await supabase.from('project_sections')
      .update({ sort_order: b }).eq('id', item.id).select()
    if (e1) throw e1
    const { error: e2 } = await supabase.from('project_sections')
      .update({ sort_order: a }).eq('id', other.id).select()
    if (e2) throw e2
  })

  const remove = (item) => run(async () => {
    const own = taskCount(item.id)
    const childIds = kidsOf(item.id).map(s => s.id)
    const inChildren = tasks.filter(t => childIds.includes(t.section_id)).length
    if (own + inChildren > 0) {
      alert(`"${item.name}" still holds ${own + inChildren} task(s). `
        + 'Move or remove them first — deleting this would strip them out '
        + 'of the structure while leaving them on the project, so they '
        + 'would disappear from every screen but still count in the total.')
      return
    }
    if (childIds.length && !confirm(
      `"${item.name}" contains ${childIds.length} stage(s). Delete all of them?`)) return
    if (!childIds.length && !confirm(`Delete "${item.name}"?`)) return
    const { error } = await supabase.from('project_sections').delete().eq('id', item.id)
    if (error) throw error
  })

  const Row = (item, isPkg) => {
    const n = isPkg ? taskCount(item.id)
      : kidsOf(item.id).reduce((a, p) => a + taskCount(p.id), 0)
    return (
      <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6,
             padding: '6px 0', paddingLeft: isPkg ? 22 : 0,
             borderBottom: `1px solid ${C.line}` }}>
        {editing === item.id ? (
          <>
            <input style={{ ...inp, flex: 1 }} value={editName} autoFocus
                   onChange={e => setEditName(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') rename(item.id)
                                     if (e.key === 'Escape') setEditing(null) }} />
            <button style={btn} disabled={busy} onClick={() => rename(item.id)}>Save</button>
            <button style={btnGhost} onClick={() => setEditing(null)}>Cancel</button>
          </>
        ) : (
          <>
            <span style={{ flex: 1, fontSize: 13, color: isPkg ? C.ink2 : C.ink }}>
              {isPkg ? '↳ ' : ''}{item.name}
              <span style={{ fontSize: 11, color: C.ink3 }}> · {n} task{n !== 1 ? 's' : ''}</span>
            </span>
            <button style={btnIcon} title="Move up" disabled={busy}
                    onClick={() => move(item, -1)}>↑</button>
            <button style={btnIcon} title="Move down" disabled={busy}
                    onClick={() => move(item, 1)}>↓</button>
            <button style={btnGhost} disabled={busy}
                    onClick={() => { setEditing(item.id); setEditName(item.name) }}>Rename</button>
            {!isPkg &&
              <button style={btnGhost} disabled={busy}
                      onClick={() => { setAdding(item.id); setNewName('') }}>+ Stage</button>}
            <button style={{ ...btnGhost, color: C.red, borderColor: '#FCA5A5' }}
                    disabled={busy} onClick={() => remove(item)}>Delete</button>
          </>
        )}
      </div>
    )
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12,
           padding: 14, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
             cursor: 'pointer' }} onClick={() => setOpen(v => !v)}>
        <span style={{ fontSize: 13 }}>{open ? '▾' : '▸'} Structure</span>
        <span style={{ fontSize: 11, color: C.ink3 }}>
          {tops.length} section{tops.length !== 1 ? 's' : ''} ·{' '}
          {sections.length - tops.length} stage{sections.length - tops.length !== 1 ? 's' : ''}
        </span>
      </div>

      {open &&
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: C.ink3, marginBottom: 8 }}>
            Sections are the tiles on this page. Stages sit inside a section and are
            the bars on the timeline — a dependency links one stage to the next.
          </div>

          {tops.length === 0 &&
            <div style={{ fontSize: 12, color: C.ink3, padding: '8px 0' }}>
              No sections yet. Add one to start.
            </div>}

          {tops.map(s => (
            <div key={s.id}>
              {Row(s, false)}
              {kidsOf(s.id).map(p => Row(p, true))}
              {adding === s.id &&
                <div style={{ display: 'flex', gap: 6, padding: '6px 0 6px 22px' }}>
                  <input style={{ ...inp, flex: 1 }} placeholder="Stage name" value={newName} autoFocus
                         onChange={e => setNewName(e.target.value)}
                         onKeyDown={e => { if (e.key === 'Enter') add(s.id)
                                           if (e.key === 'Escape') setAdding(null) }} />
                  <button style={btn} disabled={busy || !newName.trim()}
                          onClick={() => add(s.id)}>Add</button>
                  <button style={btnGhost} onClick={() => setAdding(null)}>Cancel</button>
                </div>}
            </div>
          ))}

          {adding === 'section' ? (
            <div style={{ display: 'flex', gap: 6, paddingTop: 10 }}>
              <input style={{ ...inp, flex: 1 }} placeholder="Section name" value={newName} autoFocus
                     onChange={e => setNewName(e.target.value)}
                     onKeyDown={e => { if (e.key === 'Enter') add(null)
                                       if (e.key === 'Escape') setAdding(null) }} />
              <button style={btn} disabled={busy || !newName.trim()}
                      onClick={() => add(null)}>Add</button>
              <button style={btnGhost} onClick={() => setAdding(null)}>Cancel</button>
            </div>
          ) : (
            <button style={{ ...btnGhost, marginTop: 10 }} disabled={busy}
                    onClick={() => { setAdding('section'); setNewName('') }}>+ Section</button>
          )}
        </div>}
    </div>
  )
}

const inp = { padding: '7px 9px', border: `1px solid ${C.line2}`, borderRadius: 8,
  fontSize: 13, fontFamily: 'inherit' }
const btn = { background: C.ink, color: '#fff', border: 0, borderRadius: 8,
  padding: '7px 12px', fontSize: 12, cursor: 'pointer' }
const btnGhost = { background: 'transparent', color: C.ink2, border: `1px solid ${C.line2}`,
  borderRadius: 8, padding: '4px 9px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }
const btnIcon = { background: 'transparent', color: C.ink2, border: `1px solid ${C.line2}`,
  borderRadius: 6, padding: '2px 7px', fontSize: 12, cursor: 'pointer', lineHeight: 1.2 }
