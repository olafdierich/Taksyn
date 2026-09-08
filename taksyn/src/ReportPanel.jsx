import { useState, useEffect } from 'react'
import { supabase } from './supabase.js'
import { openProjectReport } from './projectReport.js'

/*
  ReportPanel — produce a project report.

  Two things happen here and they are deliberately separate:

  PREVIEW opens the document without writing anything. Most of the time
  someone wants to look at where a project stands, not to file a
  statement about it, and making every look a permanent record would
  either fill the table with noise or make people avoid the button.

  SAVE AND OPEN writes the report, with the conclusion and a snapshot of
  what the figures said at that moment. That row cannot be edited or
  deleted afterwards — a correction is a new report and the old one
  stays. So the button says what it does.

  THE CONCLUSION IS TYPED, NOT GENERATED.
  Strengths, weaknesses and how to structure what comes next are
  judgements about named people's work. A machine-written assessment in
  a document that may reach a regulator would be worth less than nothing
  — it reads as authoritative and can be wrong. The figures are counted;
  the meaning is a person's, with their name against it.
*/

const C = {
  green: '#10B981', amber: '#F59E0B', red: '#EF4444', blue: '#3B82F6',
  line: '#E2E8F0', line2: '#CBD5E1',
  ink: '#1A2033', ink2: '#6B7280', ink3: '#9CA3AF',
  card: '#FFFFFF', soft: '#F4F6F9'
}

const fmtDate = s => s
  ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—'

export default function ReportPanel({ project, orgName, user, canEdit, onChanged }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [past, setPast] = useState([])
  const [range, setRange] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [w, setW] = useState({ conclusion: '', strengths: '', weaknesses: '', next_steps: '' })

  useEffect(() => {
    if (!open) return
    let dead = false
    supabase.from('project_reports')
      .select('id,period_label,period_from,period_to,conclusion,strengths,weaknesses,next_steps,created_at,created_by_name')
      .eq('project_id', project.id).order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => { if (!dead) setPast(data || []) })
    return () => { dead = true }
  }, [open, project.id])

  // Preset ranges cover what people actually ask for. A custom range is
  // there for the awkward cases rather than being the default, because
  // typing two dates to see a project is friction for no gain.
  const resolved = () => {
    const end = new Date()
    if (range === 'all') return { f: null, t: to }
    if (range === 'custom') return { f: from || null, t: to }
    const start = new Date(end)
    if (range === '30') start.setDate(start.getDate() - 30)
    if (range === '90') start.setDate(start.getDate() - 90)
    if (range === 'year') start.setFullYear(start.getFullYear(), 0, 1)
    return { f: start.toISOString().slice(0, 10), t: to }
  }

  const label = () => {
    const { f, t } = resolved()
    return f ? `${fmtDate(f)} to ${fmtDate(t)}` : `Up to ${fmtDate(t)}`
  }

  const preview = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { f, t } = resolved()
      await openProjectReport({
        projectId: project.id, orgName, user,
        periodFrom: f, periodTo: t,
        // Unsaved text still renders, so the writer can see how it reads
        // before committing to it.
        saved: (w.conclusion || w.strengths || w.weaknesses || w.next_steps)
          ? { ...w, created_by_name: user?.name, created_at: new Date().toISOString() }
          : null
      })
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  const saveAndOpen = async () => {
    if (busy) return
    if (!w.conclusion.trim()) {
      alert('A saved report needs an assessment. The figures are counted from the '
        + 'record; the conclusion is the part only you can write, and a filed '
        + 'report without one says nothing.')
      return
    }
    if (!confirm('Save this report?\n\nIt cannot be edited or deleted afterwards — '
      + 'a correction is a new report, and this one stays on the record.')) return

    setBusy(true)
    try {
      const { f, t } = resolved()
      // Render first: the snapshot comes back from the renderer, so the
      // stored figures are exactly the ones the document showed rather
      // than a second count that could differ.
      const snapshot = await openProjectReport({
        projectId: project.id, orgName, user,
        periodFrom: f, periodTo: t,
        saved: { ...w, created_by_name: user?.name, created_at: new Date().toISOString() }
      })

      const { data, error } = await supabase.from('project_reports').insert({
        org: project.org,
        project_id: project.id,
        period_from: f,
        period_to: t,
        period_label: label(),
        conclusion: w.conclusion.trim() || null,
        strengths: w.strengths.trim() || null,
        weaknesses: w.weaknesses.trim() || null,
        next_steps: w.next_steps.trim() || null,
        snapshot,
        created_by_id: (await supabase.auth.getSession()).data?.session?.user?.id,
        created_by_name: user?.name || null
      }).select()
      if (error) throw error
      if (!data || !data.length) {
        throw new Error('The report was rendered but not saved. This is usually a permissions problem.')
      }
      setW({ conclusion: '', strengths: '', weaknesses: '', next_steps: '' })
      setPast(p => [data[0], ...p])
      if (onChanged) onChanged()
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  const reopen = async (r) => {
    setBusy(true)
    try {
      await openProjectReport({
        projectId: project.id, orgName, user,
        periodFrom: r.period_from, periodTo: r.period_to, saved: r
      })
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12,
           padding: 14, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
             cursor: 'pointer' }} onClick={() => setOpen(v => !v)}>
        <span style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>
          {open ? '▾' : '▸'} Report
        </span>
        <span style={{ fontSize: 11, color: C.ink3 }}>
          {past.length ? `${past.length} filed` : 'Governance document'}
        </span>
      </div>

      {open &&
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: C.ink3, marginBottom: 10 }}>
            Counts, dates and what moved are taken from the record. The assessment
            is yours to write and is stored with your name on it.
          </div>

          <label style={lbl}>Period</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[['all', 'Whole project'], ['30', 'Last 30 days'],
              ['90', 'Last 90 days'], ['year', 'This year'], ['custom', 'Custom']]
              .map(([k, t2]) => (
                <button key={k} style={{ ...chip, ...(range === k ? chipOn : {}) }}
                        onClick={() => setRange(k)}>{t2}</button>
              ))}
          </div>
          {range === 'custom' &&
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
              <div><label style={lbl}>From</label>
                <input style={inp} type="date" value={from}
                       onChange={e => setFrom(e.target.value)} /></div>
              <div><label style={lbl}>To</label>
                <input style={inp} type="date" value={to}
                       onChange={e => setTo(e.target.value)} /></div>
            </div>}
          <div style={{ fontSize: 11, color: C.ink3, marginTop: 6 }}>{label()}</div>

          {canEdit && <>
            <label style={lbl}>Assessment</label>
            <textarea style={{ ...inp, minHeight: 74 }} value={w.conclusion}
              placeholder="Where does this project stand, and what does that mean?"
              onChange={e => setW({ ...w, conclusion: e.target.value })} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={lbl}>What went well</label>
                <textarea style={{ ...inp, minHeight: 62 }} value={w.strengths}
                  onChange={e => setW({ ...w, strengths: e.target.value })} />
              </div>
              <div>
                <label style={lbl}>What did not</label>
                <textarea style={{ ...inp, minHeight: 62 }} value={w.weaknesses}
                  onChange={e => setW({ ...w, weaknesses: e.target.value })} />
              </div>
            </div>

            <label style={lbl}>How to structure what comes next</label>
            <textarea style={{ ...inp, minHeight: 62 }} value={w.next_steps}
              onChange={e => setW({ ...w, next_steps: e.target.value })} />
          </>}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button style={btnGhost} disabled={busy} onClick={preview}>
              {busy ? 'Working…' : 'Preview'}
            </button>
            {canEdit &&
              <button style={{ ...btn, opacity: busy ? .5 : 1 }} disabled={busy}
                      onClick={saveAndOpen}>File this report</button>}
          </div>
          <div style={{ fontSize: 11, color: C.ink3, marginTop: 6 }}>
            Preview writes nothing. Filing keeps the report permanently — it cannot
            be edited or removed afterwards.
          </div>

          {past.length > 0 &&
            <div style={{ marginTop: 16, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
              <div style={{ fontSize: 12, color: C.ink2, marginBottom: 6 }}>Filed reports</div>
              {past.map(r => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between',
                       alignItems: 'center', gap: 10, padding: '7px 0',
                       borderBottom: `1px solid ${C.line}` }}>
                  <span style={{ fontSize: 12 }}>
                    {r.period_label}
                    <span style={{ color: C.ink3 }}> · {r.created_by_name || '—'}
                      {' · '}{new Date(r.created_at).toLocaleDateString('en-GB')}</span>
                  </span>
                  <button style={btnGhost} disabled={busy}
                          onClick={() => reopen(r)}>Open</button>
                </div>
              ))}
            </div>}
        </div>}
    </div>
  )
}

const lbl = { display: 'block', fontSize: 11, color: C.ink2, margin: '10px 0 3px' }
const inp = { width: '100%', padding: '8px 9px', border: `1px solid ${C.line2}`,
  borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff' }
const chip = { background: 'transparent', color: C.ink2, border: `1px solid ${C.line2}`,
  borderRadius: 20, padding: '4px 11px', fontSize: 12, cursor: 'pointer' }
const chipOn = { background: C.ink, color: '#fff', borderColor: C.ink }
const btn = { background: C.ink, color: '#fff', border: 0, borderRadius: 8,
  padding: '8px 14px', fontSize: 13, cursor: 'pointer' }
const btnGhost = { background: 'transparent', color: C.ink2, border: `1px solid ${C.line2}`,
  borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer' }
