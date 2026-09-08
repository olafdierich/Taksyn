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
  const [draftAt, setDraftAt] = useState(null)
  const [dirty, setDirty] = useState(false)

  const setField = (k, v) => { setW(p => ({ ...p, [k]: v })); setDirty(true) }
  const anyWritten = !!(w.conclusion.trim() || w.strengths.trim()
                     || w.weaknesses.trim() || w.next_steps.trim())

  // Reopening the panel finds your own words where you left them.
  useEffect(() => {
    if (!open) return
    let dead = false
    supabase.from('project_report_drafts')
      .select('conclusion,strengths,weaknesses,next_steps,updated_at')
      .eq('project_id', project.id).maybeSingle()
      .then(({ data }) => {
        if (dead || !data) return
        setW({
          conclusion: data.conclusion || '', strengths: data.strengths || '',
          weaknesses: data.weaknesses || '', next_steps: data.next_steps || ''
        })
        setDraftAt(data.updated_at)
        setDirty(false)
      })
    return () => { dead = true }
  }, [open, project.id])

  useEffect(() => {
    if (!open) return
    let dead = false
    // rendered_bytes rather than rendered_html: the list only needs to
    // know whether a stored copy exists. Pulling ten documents to draw
    // ten rows would be several hundred kilobytes for nothing.
    supabase.from('project_reports')
      .select('id,period_label,period_from,period_to,conclusion,strengths,weaknesses,next_steps,created_at,created_by_name,rendered_bytes')
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

  const saveDraft = async () => {
    if (busy) return
    setBusy(true)
    try {
      const uid = (await supabase.auth.getSession()).data?.session?.user?.id
      if (!uid) throw new Error('Not signed in.')
      const { f, t } = resolved()
      // One draft per person per project, so onConflict is the pair.
      const { error } = await supabase.from('project_report_drafts').upsert({
        org: project.org, project_id: project.id, author_id: uid,
        period_from: f, period_to: t, period_label: label(),
        conclusion: w.conclusion.trim() || null,
        strengths: w.strengths.trim() || null,
        weaknesses: w.weaknesses.trim() || null,
        next_steps: w.next_steps.trim() || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'project_id,author_id' }).select()
      if (error) throw error
      setDraftAt(new Date().toISOString())
      setDirty(false)
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
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
        saved: anyWritten
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
      const rendered = await openProjectReport({
        projectId: project.id, orgName, user,
        periodFrom: f, periodTo: t,
        saved: { ...w, created_by_name: user?.name, created_at: new Date().toISOString() }
      })
      const snapshot = rendered?.snapshot || {}
      const html = rendered?.html || null

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
        // The document itself, so this report reproduces exactly rather
        // than being rebuilt from data that will have moved on.
        rendered_html: html,
        rendered_bytes: html ? html.length : null,
        created_by_id: (await supabase.auth.getSession()).data?.session?.user?.id,
        created_by_name: user?.name || null
      }).select()
      if (error) throw error
      if (!data || !data.length) {
        throw new Error('The report was rendered but not saved. This is usually a permissions problem.')
      }
      const uid = (await supabase.auth.getSession()).data?.session?.user?.id
      if (uid) {
        await supabase.from('project_report_drafts').delete()
          .eq('project_id', project.id).eq('author_id', uid)
      }
      setW({ conclusion: '', strengths: '', weaknesses: '', next_steps: '' })
      setDraftAt(null); setDirty(false)
      setPast(p => [data[0], ...p])
      if (onChanged) onChanged()
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  const reopen = async (r) => {
    setBusy(true)
    try {
      if (r.rendered_bytes) {
        // Fetched only when opening: the document, exactly as filed.
        const { data, error } = await supabase.from('project_reports')
          .select('rendered_html').eq('id', r.id).single()
        if (error) throw error
        if (data?.rendered_html) {
          await openProjectReport({ projectId: project.id, replayHtml: data.rendered_html })
          return
        }
      }
      // Filed before block 13. Rebuilt from today's data, which will not
      // match what was filed — said plainly rather than silently.
      if (!confirm('This report was filed before documents were kept, so there is no '
        + 'stored copy.\n\nIt can be rebuilt, but from TODAY\'s figures — the '
        + 'conclusion will be the one that was written, the numbers will not be. '
        + 'Continue?')) return
      await openProjectReport({
        projectId: project.id, orgName, user,
        periodFrom: r.period_from, periodTo: r.period_to, saved: r
      })
    } catch (e) { alert(e.message || String(e)) }
    finally { setBusy(false) }
  }

  const discardDraft = async () => {
    if (busy) return
    if (!confirm('Discard this draft?\n\nThe text is deleted. Filed reports are '
      + 'not affected.')) return
    setBusy(true)
    try {
      const uid = (await supabase.auth.getSession()).data?.session?.user?.id
      if (uid) {
        const { error } = await supabase.from('project_report_drafts').delete()
          .eq('project_id', project.id).eq('author_id', uid)
        if (error) throw error
      }
      setW({ conclusion: '', strengths: '', weaknesses: '', next_steps: '' })
      setDraftAt(null); setDirty(false)
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
            {!anyWritten &&
              <div style={{ background: '#FEF3C7', border: '1px solid #FBD89B',
                     borderRadius: 10, padding: '11px 13px', margin: '14px 0 4px',
                     display: 'flex', gap: 10 }}>
                <span style={{ fontSize: 15, lineHeight: 1.2 }}>&#9888;</span>
                <span style={{ fontSize: 12, color: '#854F0B', lineHeight: 1.5 }}>
                  <b>Your assessment is needed.</b> The figures are counted from the
                  record, but what they mean is a judgement — and it is filed with your
                  name against it. A report without one says nothing.
                </span>
              </div>}

            <label style={lbl}>Assessment *</label>
            <textarea style={{ ...inp, minHeight: 74 }} value={w.conclusion}
              placeholder="Where does this project stand, and what does that mean?"
              onChange={e => setField('conclusion', e.target.value)} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={lbl}>What went well</label>
                <textarea style={{ ...inp, minHeight: 62 }} value={w.strengths}
                  onChange={e => setField('strengths', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>What did not</label>
                <textarea style={{ ...inp, minHeight: 62 }} value={w.weaknesses}
                  onChange={e => setField('weaknesses', e.target.value)} />
              </div>
            </div>

            <label style={lbl}>How to structure what comes next</label>
            <textarea style={{ ...inp, minHeight: 62 }} value={w.next_steps}
              onChange={e => setField('next_steps', e.target.value)} />
          </>}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap',
                 alignItems: 'center' }}>
            <button style={btnGhost} disabled={busy} onClick={preview}>
              {busy ? 'Working…' : 'Preview'}
            </button>
            {canEdit &&
              <button style={{ ...btnGhost,
                       borderColor: dirty ? C.blue : C.line2,
                       color: dirty ? C.blue : C.ink2 }}
                      disabled={busy || !anyWritten} onClick={saveDraft}>
                {dirty ? 'Save draft *' : 'Save draft'}
              </button>}
            {canEdit &&
              <button style={{ ...btn, opacity: busy ? .5 : 1 }} disabled={busy}
                      onClick={saveAndOpen}>File this report</button>}
            {canEdit && (draftAt || anyWritten) &&
              <button style={{ ...btnGhost, color: C.red, borderColor: '#FCA5A5' }}
                      disabled={busy} onClick={discardDraft}>Discard draft</button>}
            {draftAt && !dirty &&
              <span style={{ fontSize: 11, color: C.ink3 }}>
                Draft saved {new Date(draftAt).toLocaleString('en-GB',
                  { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>}
          </div>
          <div style={{ fontSize: 11, color: C.ink3, marginTop: 6 }}>
            Preview writes nothing. A draft is private to you and can be changed as
            often as you like. Filing keeps the report permanently — it cannot be
            edited or removed afterwards, and a correction is a new report.
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
                    {!r.rendered_bytes &&
                      <span style={{ color: '#854F0B', fontSize: 11 }}> · no stored copy</span>}
                  </span>
                  <button style={btnGhost} disabled={busy}
                          onClick={() => reopen(r)}>
                    {r.rendered_bytes ? 'Open' : 'Rebuild'}
                  </button>
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
