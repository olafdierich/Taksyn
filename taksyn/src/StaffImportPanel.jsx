// ============================================================
// Staff bulk import — panel
//
// Mirrors ImportPanel for clients, with two differences that
// matter:
//
//   1. Nothing is created at import time. Rows are STAGED.
//      profiles.id and org_members.user_id are both FKs to
//      auth.users, so a staff member cannot exist without an auth
//      account, and invite-user creates the account AND sends the
//      email in one call. There is no create-without-sending.
//
//   2. Sending is a separate, explicit step that walks the staged
//      rows one at a time, recording each outcome. It runs in the
//      browser on purpose: a server-side loop would exceed edge
//      function time limits on a large file, and a client loop can
//      be watched and stopped. If the tab closes halfway, the
//      unsent rows are still staged and the loop resumes.
//
// Sending is the one-way door. Everything before it is reversible.
// ============================================================

import { useState, useEffect, useRef } from 'react'
import {
  autoMapStaffHeaders, staffMappingProblems, extractStaffRows,
  buildStaffPayload, STAFF_MAPPABLE, ACCESS_LEVELS,
} from './staffFields.js'
import { downloadStaffTemplate } from './staffTemplate.js'
import { parseWorkbook, findHeaderRow, isGuidanceSheet } from './importParse.js'

const card = { background:'var(--card)', border:'1px solid var(--border)',
               borderRadius:10, padding:16, marginBottom:14 }
const lbl  = { display:'block', fontSize:12, fontWeight:700, color:'var(--t2)',
               marginBottom:6, textTransform:'uppercase', letterSpacing:.3 }
const btn  = (bg,fg) => ({ padding:'8px 12px', borderRadius:8, fontSize:13, fontWeight:600,
               cursor:'pointer', border:'1px solid var(--border)',
               background:bg||'transparent', color:fg||'var(--text)' })
const sel  = { padding:'7px 9px', borderRadius:8, border:'1px solid var(--border)',
               fontSize:13, background:'var(--card)', color:'var(--text)',
               fontFamily:'inherit', minWidth:180 }

const VERDICT = {
  stage: { label: 'Will be invited', colour: 'var(--ok, #067647)' },
  error: { label: 'Error',           colour: 'var(--danger, #b42318)' },
}

export default function StaffImportPanel({
  org, orgName, jobRoles, orgDateFormat, supabase, sendInvite, onClose, onDone,
}) {
  // PATCH:staff-dob-panel
  // The organisation's own format, used to read the spreadsheet's
  // dates and to label the template header. Falls back only for the
  // template; an unrecognised date still reaches the server raw.
  const dateFormat = orgDateFormat || 'DD/MM/YYYY'
  // choose | mapping | preview | sending | done
  const [step, setStep]       = useState('choose')
  const [parsed, setParsed]   = useState(null)
  const [sheetName, setSheet] = useState('')
  const [headerRow, setHeaderRow] = useState(0)
  const [mapping, setMapping] = useState({})
  const [rows, setRows]       = useState([])
  const [check, setCheck]     = useState(null)
  const [batchId, setBatchId] = useState(null)
  const [staged, setStaged]   = useState([])
  const [progress, setProgress] = useState({ done:0, ok:0, failed:0 })
  const [filename, setFilename] = useState('')
  const [err, setErr]         = useState('')
  const [busy, setBusy]       = useState(false)
  // [PATCH:stop-ref]
  // A ref, not state: the loop below reads this on every iteration
  // and must see a change the moment the button is pressed. React
  // state would not be visible until the loop finished, by which
  // point every remaining invite has already been sent.
  const stopRef = useRef(false)
  const [stopRequested, setStop] = useState(false)
  // [PATCH:rate-limit]
  // Set when the mail provider refuses further sends. The remaining
  // rows stay staged, so Send simply resumes later.
  const [rateLimited, setRateLimited] = useState(false)

  const sheet = (parsed?.sheets || []).find(s => s.name === sheetName)
  const headers = sheet?.rows?.[headerRow] || []
  const problems = staffMappingProblems(mapping)

  useEffect(() => {
    if (!sheet) return
    const hr = findHeaderRow(sheet.rows)
    setHeaderRow(hr)
    setMapping(autoMapStaffHeaders(sheet.rows[hr] || []))
  }, [sheet])

  // ---- file ----
  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    setErr(''); setBusy(true); setFilename(file.name)
    try {
      const XLSX = await import('xlsx')
      const wb = parseWorkbook(XLSX, await file.arrayBuffer(), { filename: file.name })
      const usable = wb.sheets.filter(s => !isGuidanceSheet(s.name) && (s.rows||[]).length > 0)
      if (!usable.length) {
        setErr('That file has no rows Taksyn can read. Check you saved it as .xlsx or .csv.')
        setBusy(false); return
      }
      setParsed({ sheets: usable })
      setSheet(usable[0].name)
      setStep('mapping')
    } catch (ex) {
      setErr('Could not read that file: ' + (ex?.message || String(ex)))
    }
    setBusy(false)
  }

  const setField = (field, colValue) => {
    setMapping(prev => {
      const next = { ...prev }
      if (colValue === '') delete next[field]
      else {
        const col = Number(colValue)
        for (const k of Object.keys(next)) if (next[k] === col) delete next[k]
        next[field] = col
      }
      return next
    })
  }

  // ---- dry run ----
  const runCheck = async () => {
    setBusy(true); setErr('')
    const extracted = extractStaffRows(sheet.rows, headerRow, mapping)
    setRows(extracted)
    const { data, error } = await supabase.rpc('stage_staff_batch', {
      p_org: org,
      p_rows: buildStaffPayload(extracted, { dateFormat }),
      p_filename: filename || null,
      p_dry_run: true,
    })
    setBusy(false)
    if (error) { setErr(error.message || String(error)); return }
    setCheck(data)
    setStep('preview')
  }

  // ---- stage for real ----
  const stageAll = async () => {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('stage_staff_batch', {
      p_org: org,
      p_rows: buildStaffPayload(rows, { dateFormat }),
      p_filename: filename || null,
      p_dry_run: false,
    })
    if (error) { setBusy(false); setErr(error.message || String(error)); return }
    setBatchId(data.batch_id)

    const { data: staffRows, error: readErr } = await supabase
      .from('import_staff_rows')
      .select('id,row_no,email,full_name,access_role,job_role,date_of_birth,status')
      .eq('batch_id', data.batch_id).order('row_no')
    setBusy(false)
    if (readErr) { setErr(readErr.message); return }
    setStaged(staffRows || [])
    setStep('sending')
  }

  // ---- the send loop ----
  //
  // One invite at a time, awaited, with the outcome recorded before
  // the next begins. Slower than firing them in parallel, and
  // deliberately so: each call creates an account and sends an
  // email, and a half-finished parallel batch is far harder to
  // reason about than a half-finished sequential one.
  const sendAll = async () => {
    setBusy(true); setErr('')
    stopRef.current = false; setStop(false); setRateLimited(false)
    let done = 0, ok = 0, failed = 0

    for (const r of staged) {
      if (r.status !== 'staged') continue
      if (stopRef.current) break

      let result = null, sendErr = null
      try {
        result = await sendInvite({
          email: r.email,
          name: r.full_name,
          role: r.access_role,
          position: r.job_role || null,
          dateOfBirth: r.date_of_birth || null,
        })
      } catch (ex) {
        sendErr = ex?.message || String(ex)
      }

      const succeeded = !sendErr && result && result.success

      // Rate limiting is not a fault in the row. Stop, and leave
      // everything after this one staged so it can be resumed.
      const message = String(sendErr || result?.error || '')
      if (!succeeded && /rate limit|too many requests|429/i.test(message)) {
        setRateLimited(true)
        setBusy(false)
        setProgress({ done, ok, failed })
        return
      }

      try {
        await supabase.rpc('mark_staff_row', {
          p_row_id: r.id,
          p_status: succeeded ? 'invited' : 'failed',
          p_user_id: result?.userId || null,
          p_error: succeeded ? null : (sendErr || result?.error || 'invite failed'),
        })
      } catch (ex) {
        // Recording failed but the invite may have been sent. Say so
        // rather than letting the count quietly disagree with reality.
        setErr('An invite was sent but its result could not be recorded: ' + (ex?.message || ex))
      }

      done++
      if (succeeded) ok++; else failed++
      setProgress({ done, ok, failed })
      setStaged(prev => prev.map(x => x.id === r.id
        ? { ...x, status: succeeded ? 'invited' : 'failed' } : x))
    }

    setBusy(false)
    if (onDone) onDone()
    if (done > 0 && !stopRef.current) setStep('done')
  }

  const pending = staged.filter(r => r.status === 'staged').length

  return (
    <div style={{ ...card, borderColor:'var(--brand,#4F46E5)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:12, marginBottom:10 }}>
        <div style={{ fontWeight:700, fontSize:15 }}>Invite staff from a file</div>
        <button style={btn()} onClick={onClose} disabled={busy}>Close</button>
      </div>

      {err && (
        <div style={{ padding:10, borderRadius:8, border:'1px solid #DC2626',
                      color:'#DC2626', fontSize:13, marginBottom:10 }}>{err}</div>
      )}

      {/* ---- choose ---- */}
      {step === 'choose' && (
        <div>
          <div style={{ fontSize:13, marginBottom:12, lineHeight:1.6 }}>
            Everyone on the file will be sent an invitation to join Taksyn and will
            set their own password. Email, name and access level are required.
            {!jobRoles?.length && (
              <> No job roles have been set up for {orgName || 'this organisation'} yet —
              add them under Roles &amp; Positions if you want to assign them here.</>
            )}
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <button style={btn()} onClick={async () => {
              setErr('')
              try { await downloadStaffTemplate({ orgName, jobRoles, dateFormat }) }
              catch (ex) { setErr(ex?.message || String(ex)) }
            }}>Download staff template</button>
            <label style={{ ...btn('var(--brand,#4F46E5)','#fff'), display:'inline-block' }}>
              {busy ? 'Reading…' : 'Choose a file'}
              <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile}
                     disabled={busy} style={{ display:'none' }}/>
            </label>
          </div>
          <div style={{ fontSize:12, color:'var(--t2)', marginTop:10, lineHeight:1.5 }}>
            No invitations are sent until you have seen the whole list and confirmed it.
          </div>
        </div>
      )}

      {/* ---- mapping ---- */}
      {step === 'mapping' && sheet && (
        <div>
          <div style={{ fontSize:12, color:'var(--t2)', marginBottom:10 }}>
            {filename} · headers read from row {headerRow + 1}
          </div>
          {parsed.sheets.length > 1 && (
            <select value={sheetName} onChange={e=>setSheet(e.target.value)} style={{ ...sel, marginBottom:10 }}>
              {parsed.sheets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          )}
          <div style={{ display:'grid', gap:8 }}>
            {STAFF_MAPPABLE.map(f => (
              <div key={f.key} style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <div style={{ fontSize:13, minWidth:170 }}>{f.label}</div>
                <select value={mapping[f.key] === undefined ? '' : String(mapping[f.key])}
                        onChange={e=>setField(f.key, e.target.value)} style={sel}>
                  <option value="">— not in this file —</option>
                  {headers.map((h,i) => (
                    <option key={i} value={i}>{String(h||'').trim() || `(column ${i+1})`}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {problems.map((p,i) => (
            <div key={i} style={{ fontSize:12, color:'var(--danger,#b42318)', marginTop:8 }}>{p}</div>
          ))}
          <button style={{ ...btn('var(--brand,#4F46E5)','#fff'), marginTop:14 }}
                  disabled={problems.length > 0 || busy} onClick={runCheck}>
            {busy ? 'Checking…' : 'Check the list'}
          </button>
        </div>
      )}

      {/* ---- preview ---- */}
      {step === 'preview' && check && (
        <div>
          <div style={{ fontSize:14, marginBottom:10 }}>
            {check.counts.staged} of {check.counts.total} can be invited
            {check.counts.errors > 0 && <>, <strong style={{ color:'var(--danger,#b42318)' }}>
              {check.counts.errors} with errors</strong></>}.
          </div>
          {check.counts.errors > 0 && (
            <div style={{ fontSize:12, color:'var(--danger,#b42318)', marginBottom:10, lineHeight:1.5 }}>
              Nothing can be invited while any row has an error. Correct them in the
              spreadsheet and upload it again.
            </div>
          )}
          <div style={{ maxHeight:360, overflowY:'auto', border:'1px solid var(--border)', borderRadius:8 }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead><tr>
                <th style={{ textAlign:'left', padding:'7px 9px', width:44 }}>Row</th>
                <th style={{ textAlign:'left', padding:'7px 9px' }}>Name</th>
                <th style={{ textAlign:'left', padding:'7px 9px' }}>Email</th>
                <th style={{ textAlign:'left', padding:'7px 9px' }}>Access</th>
                <th style={{ textAlign:'left', padding:'7px 9px' }}>Born</th>
                <th style={{ textAlign:'left', padding:'7px 9px' }}>Verdict</th>
                <th style={{ textAlign:'left', padding:'7px 9px' }}>Reason</th>
              </tr></thead>
              <tbody>
                {check.rows.map(r => {
                  const v = VERDICT[r.verdict] || { label:r.verdict, colour:'var(--t2)' }
                  return (
                    <tr key={r.row_no} style={{ borderTop:'1px solid var(--border)' }}>
                      <td style={{ padding:'6px 9px', color:'var(--t2)' }}>{r.row_no}</td>
                      <td style={{ padding:'6px 9px' }}>{r.full_name}</td>
                      <td style={{ padding:'6px 9px', color:'var(--t2)' }}>{r.email}</td>
                      <td style={{ padding:'6px 9px' }}>
                        {(ACCESS_LEVELS.find(l=>l.key===r.access_role)||{}).label || r.access_role}
                      </td>
                      <td style={{ padding:'6px 9px', color:'var(--t2)' }}>{r.date_of_birth || ''}</td>
                      <td style={{ padding:'6px 9px', color:v.colour, fontWeight:600 }}>{v.label}</td>
                      <td style={{ padding:'6px 9px', color:'var(--t2)' }}>{r.reason || ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* [PATCH:ui-defects] */}
          {/* The button was disabled correctly but styled as though it
              were live, so a blocked action read as a broken one. */}
          <div style={{ marginTop:14, display:'flex', gap:8 }}>
            {(() => {
              const blocked = busy || check.counts.errors > 0 || check.counts.staged === 0
              return (
                <button
                  style={blocked
                    ? { ...btn(), color:'var(--t2)', cursor:'default', opacity:.6 }
                    : btn('var(--brand,#4F46E5)','#fff')}
                  disabled={blocked}
                  onClick={stageAll}>
                  {busy
                    ? 'Preparing…'
                    : check.counts.errors > 0
                      ? `Fix ${check.counts.errors} ${check.counts.errors === 1 ? 'error' : 'errors'} to continue`
                      : `Prepare ${check.counts.staged} invitations`}
                </button>
              )
            })()}
            <button style={btn()} disabled={busy} onClick={()=>setStep('mapping')}>Back</button>
          </div>
          <div style={{ fontSize:12, color:'var(--t2)', marginTop:8 }}>
            This prepares the list. Nothing is sent yet.
          </div>
        </div>
      )}

      {/* ---- sending ---- */}
      {step === 'sending' && (
        <div>
          <div style={{ fontSize:14, marginBottom:6 }}>
            {pending} {pending === 1 ? 'invitation is' : 'invitations are'} ready to send.
          </div>
          <div style={{ fontSize:12, color:'var(--t2)', marginBottom:12, lineHeight:1.5 }}>
            Each person gets an email and an account is created for them. This cannot
            be undone — an account that has been created stays created, and an email
            that has been sent cannot be recalled. Leave this page open while it runs;
            if it stops, anyone not yet sent stays on the list.
          </div>

          {progress.done > 0 && (
            <div style={{ fontSize:13, marginBottom:10 }}>
              {progress.done} sent · {progress.ok} succeeded
              {progress.failed > 0 && <> · <strong style={{ color:'var(--danger,#b42318)' }}>
                {progress.failed} failed</strong></>}
            </div>
          )}

          {rateLimited && (
            <div style={{ padding:10, borderRadius:8, border:'1px solid #B45309',
                          background:'rgba(180,83,9,.06)', marginBottom:12,
                          fontSize:13, lineHeight:1.6 }}>
              <strong>Paused — the mail provider is limiting how fast invitations go out.</strong>
              <div style={{ marginTop:6 }}>
                {progress.ok} {progress.ok === 1 ? 'person has' : 'people have'} been invited.
                The remaining {pending} are still on the list and nothing has been lost.
                Come back in an hour and press Send again to continue where this left off.
              </div>
            </div>
          )}

          <div style={{ maxHeight:300, overflowY:'auto', border:'1px solid var(--border)', borderRadius:8, marginBottom:12 }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <tbody>
                {staged.map(r => (
                  <tr key={r.id} style={{ borderTop:'1px solid var(--border)' }}>
                    <td style={{ padding:'6px 9px' }}>{r.full_name}</td>
                    <td style={{ padding:'6px 9px', color:'var(--t2)' }}>{r.email}</td>
                    <td style={{ padding:'6px 9px', fontWeight:600,
                                 color: r.status === 'invited' ? 'var(--ok,#067647)'
                                      : r.status === 'failed'  ? 'var(--danger,#b42318)'
                                      : 'var(--t2)' }}>
                      {r.status === 'invited' ? 'Sent' : r.status === 'failed' ? 'Failed' : 'Waiting'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display:'flex', gap:8 }}>
            <button style={btn('var(--brand,#4F46E5)','#fff')} disabled={busy || pending === 0} onClick={sendAll}>
              {busy ? `Sending… (${progress.done})` : `Send ${pending} invitations`}
            </button>
            {busy && (
              <button style={btn()} onClick={()=>{ stopRef.current = true; setStop(true) }}>
                {stopRequested ? 'Stopping…' : 'Stop after this one'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---- done ---- */}
      {step === 'done' && (
        <div>
          <span style={lbl}>Invitations sent</span>
          <div style={{ fontSize:14, marginBottom:8 }}>
            {progress.ok} sent successfully{progress.failed > 0 && <>, {progress.failed} failed</>}.
          </div>
          {progress.failed > 0 && (
            <>
              <div style={{ fontSize:12, color:'var(--t2)', lineHeight:1.5, marginBottom:8 }}>
                These could not be sent. Each reason is recorded against the person.
                They can be invited individually from Workforce.
              </div>
              {/* The reason was recorded per row and then not shown,
                  on a screen that said it had been. */}
              <div style={{ border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <tbody>
                    {staged.filter(r => r.status === 'failed').map(r => (
                      <tr key={r.id} style={{ borderTop:'1px solid var(--border)' }}>
                        <td style={{ padding:'6px 9px' }}>{r.full_name}</td>
                        <td style={{ padding:'6px 9px', color:'var(--t2)' }}>{r.email}</td>
                        <td style={{ padding:'6px 9px', color:'var(--danger,#b42318)' }}>
                          {r.error || 'no reason recorded'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
