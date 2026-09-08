import { useState } from 'react'
import { supabase } from './supabase.js'

/*
  DependencyEditor — the links between stages.

  A dependency is independent of where a stage sits. Any stage in the
  project can wait on any other, across sections, and moving or
  reordering a stage does not touch its links. That is deliberate:
  position is how the plan reads, dependencies are how it behaves.

  CYCLE PROTECTION
  A CHECK constraint stops a stage depending on itself, but it cannot
  see a longer loop — A waits on B waits on C waits on A. Only a walk
  can, which is why recompute_project_dates carries that guard.

  So after every link is added, this runs a DRY RUN. If the walk comes
  back with kind='cycle', the link just added is removed and the user is
  told. That is cheaper and clearer than letting a project reach a state
  where nothing can ever start.

  PER TEAM
  On by default. "Safety checks follows electrical works", matched per
  team, means the Riverside team's safety work waits on the Riverside
  team's electrical work and not on Hilltop's. Turn it off when the
  whole stage must finish before the next one starts — a sign-off, an
  inspection, anything that is not split across teams.

  GAP
  Days between the predecessor finishing and the successor starting.
  Negative is allowed and is not a trick: second fix starting while
  first fix snags is normal, and without it people fake dates to make
  the plan match reality, which is how a plan stops being evidence.
*/

const C = {
  green: '#10B981', amber: '#F59E0B', red: '#EF4444', blue: '#3B82F6',
  line: '#E2E8F0', line2: '#CBD5E1',
  ink: '#1A2033', ink2: '#6B7280', ink3: '#9CA3AF',
  card: '#FFFFFF', soft: '#F4F6F9'
}

export default function DependencyEditor({ project, stage, sections, links, onChanged, onClose }) {
  const [busy, setBusy] = useState(false)
  const [predId, setPredId] = useState('')
  const [gap, setGap] = useState(0)
  const [perTeam, setPerTeam] = useState(true)

  // Links where THIS stage is the successor — what it waits on.
  const mine = links.filter(l => l.successor_section_id === stage.id)
  const usedPreds = mine.map(l => l.predecessor_section_id)

  // Anything in the project except this stage and its existing
  // predecessors. Cross-section is fine and expected.
  const options = sections
    .filter(s => s.parent_id && s.id !== stage.id && !usedPreds.includes(s.id))
    .map(s => ({
      ...s,
      sectionName: sections.find(x => x.id === s.parent_id)?.name || ''
    }))

  const nameOf = id => sections.find(s => s.id === id)?.name || 'a removed stage'

  const add = async () => {
    if (!predId || busy) return
    setBusy(true)
    let insertedId = null
    try {
      const { data, error } = await supabase.from('task_dependencies').insert({
        org: project.org,
        project_id: project.id,
        predecessor_section_id: predId,
        successor_section_id: stage.id,
        gap_days: Number(gap) || 0,
        match_by_team: perTeam
      }).select()
      if (error) throw error
      if (!data || !data.length) throw new Error('The link was not saved. This is usually a permissions problem.')
      insertedId = data[0].id

      // Dry run: does the project still have a walkable order?
      const { data: run, error: runErr } = await supabase.rpc('recompute_project_dates', {
        p_project_id: project.id, p_dry_run: true
      })
      if (runErr) throw runErr

      const cycle = (run || []).find(r => r.kind === 'cycle')
      if (cycle) {
        await supabase.from('task_dependencies').delete().eq('id', insertedId)
        alert('That link creates a loop, so nothing in the project could ever start.\n\n'
          + cycle.note + '\n\nThe link has been removed.')
        return
      }

      const shifts = (run || []).filter(r => r.kind === 'shift')
      const blocked = (run || []).filter(r => r.kind === 'blocked')
      let msg = 'Link saved.'
      if (shifts.length) {
        msg += `\n\n${shifts.length} task date(s) would move as a result. `
          + 'Use "Recalculate dates" on the project page to apply that.'
      }
      if (blocked.length) {
        msg += `\n\n${blocked.length} locked date(s) would be pushed against and will not move.`
      }
      alert(msg)

      setPredId(''); setGap(0); setPerTeam(true)
      onChanged()
    } catch (e) {
      // If the dry run failed after the insert landed, do not leave a
      // link nobody asked to keep.
      if (insertedId) {
        try { await supabase.from('task_dependencies').delete().eq('id', insertedId) } catch (_) {}
      }
      alert(e.message || String(e))
    } finally { setBusy(false) }
  }

  const update = async (link, patch) => {
    setBusy(true)
    try {
      const { error } = await supabase.from('task_dependencies')
        .update(patch).eq('id', link.id).select()
      if (error) throw error
      onChanged()
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  const remove = async (link) => {
    if (!confirm(`Stop "${stage.name}" waiting on "${nameOf(link.predecessor_section_id)}"?\n\n`
      + 'Dates already moved because of this link are NOT put back — they were '
      + 'real changes with an audit trail. Removing the link only stops it '
      + 'affecting future recalculations.')) return
    setBusy(true)
    try {
      const { error } = await supabase.from('task_dependencies').delete().eq('id', link.id)
      if (error) throw error
      onChanged()
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ background: C.soft, borderRadius: 10, padding: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: C.ink2 }}>
          What <strong>{stage.name}</strong> waits on
        </span>
        <button style={btnGhost} onClick={onClose}>Close</button>
      </div>

      {mine.length === 0 &&
        <div style={{ fontSize: 12, color: C.ink3, padding: '8px 0' }}>
          Nothing. This stage can start whenever its own dates say.
        </div>}

      {mine.map(l => (
        <div key={l.id} style={{ borderTop: `1px solid ${C.line}`, padding: '9px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between',
                 alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>after {nameOf(l.predecessor_section_id)}</span>
            <button style={{ ...btnGhost, color: C.red, borderColor: '#FCA5A5' }}
                    disabled={busy} onClick={() => remove(l)}>Remove</button>
          </div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 6,
                 flexWrap: 'wrap' }}>
            <label style={{ fontSize: 11, color: C.ink2, display: 'flex',
                     alignItems: 'center', gap: 6 }}>
              Gap
              <input type="number" style={{ ...inp, width: 74 }} value={l.gap_days}
                     disabled={busy}
                     onChange={e => update(l, { gap_days: Number(e.target.value) || 0 })} />
              days
            </label>
            <label style={{ fontSize: 11, color: C.ink2, display: 'flex',
                     alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={l.match_by_team} disabled={busy}
                     onChange={e => update(l, { match_by_team: e.target.checked })} />
              Match per team
            </label>
          </div>
        </div>
      ))}

      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10, marginTop: 4 }}>
        <div style={{ fontSize: 11, color: C.ink2, marginBottom: 4 }}>Add a link</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <select style={{ ...inp, flex: 1, minWidth: 180 }} value={predId}
                  onChange={e => setPredId(e.target.value)}>
            <option value="">This stage waits on…</option>
            {options.map(o =>
              <option key={o.id} value={o.id}>
                {o.sectionName ? `${o.sectionName} · ` : ''}{o.name}
              </option>)}
          </select>
          <label style={{ fontSize: 11, color: C.ink2, display: 'flex',
                   alignItems: 'center', gap: 6 }}>
            Gap
            <input type="number" style={{ ...inp, width: 70 }} value={gap}
                   onChange={e => setGap(e.target.value)} />
            days
          </label>
          <label style={{ fontSize: 11, color: C.ink2, display: 'flex',
                   alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={perTeam}
                   onChange={e => setPerTeam(e.target.checked)} />
            Per team
          </label>
          <button style={{ ...btn, opacity: (!predId || busy) ? .5 : 1 }}
                  disabled={!predId || busy} onClick={add}>
            {busy ? 'Checking…' : 'Add'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: C.ink3, marginTop: 6 }}>
          Per team means each team waits only on its own work in the earlier
          stage, so teams overlap instead of queueing. Turn it off when the
          whole stage must finish first. A negative gap lets this stage start
          before the earlier one is fully done.
        </div>
        {options.length === 0 &&
          <div style={{ fontSize: 11, color: C.amber, marginTop: 6 }}>
            No other stages available to link to.
          </div>}
      </div>
    </div>
  )
}

const inp = { padding: '6px 8px', border: `1px solid ${C.line2}`, borderRadius: 7,
  fontSize: 12, fontFamily: 'inherit', background: '#fff' }
const btn = { background: C.ink, color: '#fff', border: 0, borderRadius: 8,
  padding: '7px 13px', fontSize: 12, cursor: 'pointer' }
const btnGhost = { background: 'transparent', color: C.ink2, border: `1px solid ${C.line2}`,
  borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }
