// ============================================================
// Bulk import — the panel that joins the pieces together
//
// Kept OUT of App.jsx deliberately. Wiring this inline would mean
// inserting sixty-odd lines of JSX into a 19,000-line file; as a
// separate component, ContactsView needs four small edits.
//
// Flow:
//   date format for the org (asked once if not recorded)
//     -> download template   (optional, any time)
//     -> choose file -> parse
//     -> ColumnMapper       which sheet, which columns
//     -> DateFormatPrompt   only when the dates need resolving
//     -> ImportPreview      verdicts, overrides, commit, undo
//
// SheetJS is loaded with dynamic import() so it stays out of the
// main bundle, which is already ~1.9 MB.
// ============================================================

import { useState } from 'react'
import { parseWorkbook, isGuidanceSheet } from './importParse.js'
import { detectDateFormat, DATE_FORMATS } from './importFields.js'
import { downloadTemplate } from './importTemplate.js'
import ColumnMapper from './ColumnMapper.jsx'
import DateFormatPrompt from './DateFormatPrompt.jsx'
import ImportPreview from './ImportPreview.jsx'

const card = { background:'var(--card)', border:'1px solid var(--border)',
               borderRadius:10, padding:16, marginBottom:14 }
const lbl  = { display:'block', fontSize:12, fontWeight:700, color:'var(--t2)',
               marginBottom:6, textTransform:'uppercase', letterSpacing:.3 }
const btn  = (bg,fg) => ({ padding:'8px 12px', borderRadius:8, fontSize:13, fontWeight:600,
               cursor:'pointer', border:'1px solid var(--border)',
               background:bg||'transparent', color:fg||'var(--text)' })
const sel  = { padding:'7px 9px', borderRadius:8, border:'1px solid var(--border)',
               fontSize:13, background:'var(--card)', color:'var(--text)',
               fontFamily:'inherit', minWidth:190 }

export default function ImportPanel({
  org, orgName, orgDateFormat, supabase, onClose, onImported,
}) {
  // step: format | choose | mapping | dates | preview
  const [step, setStep]       = useState(orgDateFormat ? 'choose' : 'format')
  const [fmt, setFmt]         = useState(orgDateFormat || '')
  const [savingFmt, setSaving]= useState(false)
  const [parsed, setParsed]   = useState(null)
  const [mapped, setMapped]   = useState(null)
  const [detection, setDetect]= useState(null)
  const [resolvedFmt, setResolvedFmt] = useState(null)
  const [filename, setFilename]= useState('')
  const [err, setErr]         = useState('')
  const [busy, setBusy]       = useState(false)

  const rpc = (name, args) => supabase.rpc(name, args)

  // ---- step 1: the organisation's date format ----
  // Asked once, then stored. Never defaulted: an organisation that
  // predates this column has stated nothing, and guessing DD/MM is
  // the failure the whole design exists to prevent.
  const saveFormat = async () => {
    if (!fmt) return
    setSaving(true); setErr('')
    const { data, error } = await supabase.from('organisations')
      .update({ date_format: fmt }).eq('id', org).select()
    setSaving(false)
    if (error) { setErr(error.message); return }
    if (!data || !data.length) {
      setErr('Nothing was saved — the update matched no rows. You may not have permission to change this organisation.')
      return
    }
    setStep('choose')
  }

  // ---- step 2: file ----
  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    setErr(''); setBusy(true); setFilename(file.name)
    try {
      const XLSX = await import('xlsx')
      const buf  = await file.arrayBuffer()
      const wb   = parseWorkbook(XLSX, buf, { filename: file.name })
      const usable = wb.sheets.filter(s => !isGuidanceSheet(s.name) && (s.rows || []).length > 0)
      if (usable.length === 0) {
        setErr('That file has no rows Taksyn can read. Check you saved it as .xlsx or .csv.')
        setBusy(false)
        return
      }
      setParsed(wb)
      setStep('mapping')
    } catch (ex) {
      setErr('Could not read that file: ' + (ex?.message || String(ex)))
    }
    setBusy(false)
  }

  // ---- step 3: mapping done ----
  const onMapped = (m) => {
    setMapped(m)
    const det = detectDateFormat(m.dateColumnValues || [])
    setDetect(det)
    // Nothing to ask when there are no dates, or they were real
    // Excel date cells, or the column proved its own format.
    if (det.format === 'empty' || det.format === 'excel') {
      setResolvedFmt(fmt || 'DD/MM/YYYY')   // unused: no text dates to parse
      setStep('preview')
    } else if (det.format === 'DD/MM/YYYY' || det.format === 'MM/DD/YYYY') {
      setResolvedFmt(det.format)
      setStep('dates')                      // shown, but pre-answered and skippable
    } else {
      setStep('dates')                      // ambiguous or conflict: must ask
    }
  }

  const reset = () => {
    setParsed(null); setMapped(null); setDetect(null)
    setResolvedFmt(null); setFilename(''); setErr('')
    setStep('choose')
  }

  return (
    <div style={{ ...card, borderColor: 'var(--brand,#4F46E5)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:12, marginBottom:10 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>Import people from a file</div>
        <button style={btn()} onClick={onClose}>Close</button>
      </div>

      {err && (
        <div style={{ padding:10, borderRadius:8, border:'1px solid #DC2626',
                      color:'#DC2626', fontSize:13, marginBottom:10 }}>{err}</div>
      )}

      {/* ---- date format for the organisation ---- */}
      {step === 'format' && (
        <div>
          <span style={lbl}>How does this organisation write dates?</span>
          <div style={{ fontSize:13, marginBottom:10, lineHeight:1.6 }}>
            This has not been recorded for {orgName || 'this organisation'} yet.
            It decides which template you get, and how dates in an uploaded file
            are read. Getting it wrong puts the wrong date of birth on a record,
            so Taksyn asks rather than guessing.
          </div>
          <select value={fmt} onChange={e=>setFmt(e.target.value)} style={sel}>
            <option value="">Choose…</option>
            {Object.keys(DATE_FORMATS).map(k => (
              <option key={k} value={k}>{k} — for example {DATE_FORMATS[k].example}</option>
            ))}
          </select>
          <div style={{ marginTop:12 }}>
            <button style={btn('var(--brand,#4F46E5)','#fff')} disabled={!fmt || savingFmt} onClick={saveFormat}>
              {savingFmt ? 'Saving…' : 'Save and continue'}
            </button>
          </div>
        </div>
      )}

      {/* ---- choose a file ---- */}
      {step === 'choose' && (
        <div>
          <div style={{ fontSize:13, marginBottom:12, lineHeight:1.6 }}>
            Upload a spreadsheet of clients or contractors. Only a name is
            required — every other column can be left blank. Dates should be
            written as <strong>{fmt}</strong>.
          </div>

          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <button
              style={btn()}
              onClick={async () => {
                setErr('')
                try { await downloadTemplate({ dateFormat: fmt, orgName }) }
                catch (ex) { setErr(ex?.message || String(ex)) }
              }}
            >
              Download template
            </button>

            <label style={{ ...btn('var(--brand,#4F46E5)','#fff'), display:'inline-block' }}>
              {busy ? 'Reading…' : 'Choose a file'}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={onFile}
                disabled={busy}
                style={{ display:'none' }}
              />
            </label>
          </div>

          <div style={{ fontSize:12, color:'var(--t2)', marginTop:10, lineHeight:1.5 }}>
            Nothing is saved until you have seen exactly what will be added.
          </div>
          {/* [PATCH:ui-defects] */}
          {/* Someone with a staff list will try this panel first. */}
          <div style={{ fontSize:12, color:'var(--t2)', marginTop:8, lineHeight:1.5 }}>
            Staff are not imported here. They need a login, so they are invited
            instead — use <strong>Invite staff from a file</strong>.
          </div>
        </div>
      )}

      {/* ---- mapping ---- */}
      {step === 'mapping' && parsed && (
        <>
          <div style={{ fontSize:12, color:'var(--t2)', marginBottom:10 }}>
            {filename} · <button style={{ ...btn(), padding:'2px 8px', fontSize:12 }} onClick={reset}>choose a different file</button>
          </div>
          <ColumnMapper sheets={parsed.sheets} onReady={onMapped} />
        </>
      )}

      {/* ---- dates ---- */}
      {step === 'dates' && mapped && (
        <>
          <DateFormatPrompt
            detection={detection}
            values={mapped.dateColumnValues}
            orgDateFormat={fmt}
            onResolve={(f) => { setResolvedFmt(f); setStep('preview') }}
          />
          <button style={btn()} onClick={() => setStep('mapping')}>Back to columns</button>
        </>
      )}

      {/* ---- preview, commit, undo ---- */}
      {step === 'preview' && mapped && (
        <>
          <div style={{ fontSize:12, color:'var(--t2)', marginBottom:10 }}>
            {filename} · {mapped.rows.length} rows · {mapped.personType === 'client' ? 'Clients' : 'Contractors'}
            {resolvedFmt && detection && detection.format !== 'empty' && detection.format !== 'excel'
              && <> · dates read as {resolvedFmt}</>}
          </div>
          <ImportPreview
            org={org}
            personType={mapped.personType}
            rows={mapped.rows}
            dateFormat={resolvedFmt}
            filename={filename}
            rpc={rpc}
            onDone={() => { if (onImported) onImported() }}
          />
          <button style={btn()} onClick={reset}>Import another file</button>
        </>
      )}
    </div>
  )
}
