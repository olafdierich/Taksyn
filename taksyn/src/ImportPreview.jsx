// ============================================================
// Bulk import — preview, commit, undo
//
// The screen where the server's judgement becomes visible.
//
// Flow:
//   dry run -> per-row verdicts -> optional overrides -> commit
//   -> batch id -> undo (archives, never deletes)
//
// Ticking an override RE-RUNS the dry run rather than marking the
// row locally. The user then sees the actual effect before
// committing, and an external_ref collision visibly stays skipped
// no matter what is ticked — the client never has to know the
// rules, and cannot drift from them.
//
// The server refuses any commit containing an error row, so the
// commit button is disabled while errors > 0. Fixing errors means
// fixing the file and starting again; that is deliberate.
//
// rpc is injected: (name, args) => Promise<{ data, error }>.
// Keeps this component free of an import path and testable.
// ============================================================

import { useState, useEffect, useCallback } from 'react'
import { buildRowPayload } from './importFields.js'

const card = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 16, marginBottom: 14,
}
const lbl = {
  display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--t2)',
  marginBottom: 6, textTransform: 'uppercase', letterSpacing: .3,
}
const btn = (enabled, tone) => ({
  padding: '9px 16px', borderRadius: 8, border: 'none', fontSize: 13,
  fontWeight: 600, fontFamily: 'inherit',
  background: enabled ? (tone === 'quiet' ? 'transparent' : 'var(--brand)') : 'var(--border)',
  color: enabled ? (tone === 'quiet' ? 'var(--t2)' : '#fff') : 'var(--t2)',
  cursor: enabled ? 'pointer' : 'default',
  ...(tone === 'quiet' ? { border: '1px solid var(--border)' } : {}),
})

const VERDICT = {
  import:  { label: 'Will import', colour: 'var(--ok, #067647)' },
  skipped: { label: 'Skipped',     colour: 'var(--t2)' },
  error:   { label: 'Error',       colour: 'var(--danger, #b42318)' },
}

export default function ImportPreview({
  org, personType, rows, dateFormat, filename,
  rpc, onDone,
}) {
  const [phase, setPhase]         = useState('checking')  // checking|preview|committing|done|failed
  const [result, setResult]       = useState(null)
  const [committed, setCommitted] = useState(null)
  const [overrides, setOverrides] = useState([])
  const [err, setErr]             = useState('')
  const [undoing, setUndoing]     = useState(false)
  const [undone, setUndone]       = useState(null)

  const payload = useCallback(
    () => buildRowPayload(rows, { personType, dateFormat }),
    [rows, personType, dateFormat]
  )

  const runDry = useCallback(async (ovr) => {
    setPhase('checking'); setErr('')
    const { data, error } = await rpc('import_people_batch', {
      p_org: org,
      p_rows: payload(),
      p_filename: filename || null,
      p_dry_run: true,
      p_overrides: ovr || [],
    })
    if (error) { setErr(error.message || String(error)); setPhase('failed'); return }
    setResult(data)
    setPhase('preview')
  }, [org, payload, filename, rpc])

  useEffect(() => { runDry([]) }, [runDry])

  const toggleOverride = async (rowNo) => {
    const next = overrides.includes(rowNo)
      ? overrides.filter(n => n !== rowNo)
      : [...overrides, rowNo]
    setOverrides(next)
    await runDry(next)          // re-check, so the effect is real
  }

  const commit = async () => {
    setPhase('committing'); setErr('')
    const { data, error } = await rpc('import_people_batch', {
      p_org: org,
      p_rows: payload(),
      p_filename: filename || null,
      p_dry_run: false,
      p_overrides: overrides,
    })
    if (error) { setErr(error.message || String(error)); setPhase('preview'); return }
    setCommitted(data)
    setPhase('done')
    if (onDone) onDone(data?.batch_id)
  }

  const undo = async () => {
    if (!committed?.batch_id) return
    setUndoing(true); setErr('')
    const { data, error } = await rpc('undo_import_batch', { p_batch_id: committed.batch_id })
    setUndoing(false)
    if (error) { setErr(error.message || String(error)); return }
    setUndone(data)
  }

  // ---------- states ----------

  if (phase === 'checking' && !result) {
    return <div style={card}><span style={lbl}>Checking</span>
      <div style={{ fontSize: 13 }}>Checking {(rows || []).length} rows…</div></div>
  }

  if (phase === 'failed') {
    return <div style={card}><span style={lbl}>Could not check the file</span>
      <div style={{ fontSize: 13, color: 'var(--danger, #b42318)' }}>{err}</div></div>
  }

  if (phase === 'done' && committed) {
    const c = committed.counts || {}
    return (
      <div style={card}>
        <span style={lbl}>Imported</span>
        <div style={{ fontSize: 14, marginBottom: 8 }}>
          {c.imported} {c.imported === 1 ? 'person' : 'people'} added to the register.
          {c.skipped > 0 && <> {c.skipped} skipped.</>}
        </div>

        {undone ? (
          <div style={{ fontSize: 13, color: 'var(--t2)' }}>
            Import undone — {undone.rows_archived} of {undone.rows_total} archived.
            Archived people no longer appear in the register or on incident forms.
            They are not deleted, so anything already referring to them still works.
          </div>
        ) : (
          <>
            <button onClick={undo} disabled={undoing} style={btn(!undoing, 'quiet')}>
              {undoing ? 'Undoing…' : 'Undo this import'}
            </button>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 8, lineHeight: 1.5 }}>
              Undo archives these {c.imported} records. It stops working once any of
              them is named on an incident or linked to a login.
            </div>
          </>
        )}
        {err && <div style={{ fontSize: 13, color: 'var(--danger, #b42318)', marginTop: 8 }}>{err}</div>}
      </div>
    )
  }

  const counts = result?.counts || {}
  const rowsOut = result?.rows || []
  const hasErrors = (counts.errors || 0) > 0
  const busy = phase === 'checking' || phase === 'committing'

  return (
    <div style={card}>
      <span style={lbl}>Preview</span>

      <div style={{ fontSize: 14, marginBottom: 10 }}>
        {counts.imported} of {counts.total} will be added
        {counts.skipped > 0 && <>, {counts.skipped} skipped</>}
        {hasErrors && <>, <strong style={{ color: 'var(--danger, #b42318)' }}>{counts.errors} with errors</strong></>}.
      </div>

      {hasErrors && (
        <div style={{ fontSize: 12, color: 'var(--danger, #b42318)', marginBottom: 10, lineHeight: 1.5 }}>
          Nothing can be imported while any row has an error — the whole file is
          refused, so a half-finished import cannot happen. Correct these rows in
          the spreadsheet and upload it again.
        </div>
      )}

      <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg, transparent)' }}>
              <th style={{ textAlign: 'left', padding: '7px 9px', width: 44 }}>Row</th>
              <th style={{ textAlign: 'left', padding: '7px 9px' }}>Name</th>
              <th style={{ textAlign: 'left', padding: '7px 9px', width: 92 }}>Verdict</th>
              <th style={{ textAlign: 'left', padding: '7px 9px' }}>Reason</th>
              <th style={{ textAlign: 'left', padding: '7px 9px', width: 80 }}>Add anyway</th>
            </tr>
          </thead>
          <tbody>
            {rowsOut.map(r => {
              const v = VERDICT[r.verdict] || { label: r.verdict, colour: 'var(--t2)' }
              const ticked = overrides.includes(r.row_no)
              // Only skipped rows can be overridden. An error is a broken
              // value, not a judgement call, and the server refuses either way.
              const canOverride = r.verdict === 'skipped' || ticked
              return (
                <tr key={r.row_no} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 9px', color: 'var(--t2)' }}>{r.row_no}</td>
                  <td style={{ padding: '6px 9px' }}>{r.full_name || <em style={{ color: 'var(--t2)' }}>no name</em>}</td>
                  <td style={{ padding: '6px 9px', color: v.colour, fontWeight: 600 }}>{v.label}</td>
                  <td style={{ padding: '6px 9px', color: 'var(--t2)' }}>{r.reason || ''}</td>
                  <td style={{ padding: '6px 9px' }}>
                    {canOverride && (
                      <input
                        type="checkbox"
                        checked={ticked}
                        disabled={busy}
                        onChange={() => toggleOverride(r.row_no)}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {overrides.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 8, lineHeight: 1.5 }}>
          {overrides.length} row{overrides.length === 1 ? '' : 's'} ticked. Any that still
          show as skipped cannot be overridden — a duplicate reference number is a
          direct identity clash, not a judgement call.
        </div>
      )}

      {err && <div style={{ fontSize: 13, color: 'var(--danger, #b42318)', marginTop: 10 }}>{err}</div>}

      <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={commit}
          disabled={busy || hasErrors || (counts.imported || 0) === 0}
          style={btn(!busy && !hasErrors && (counts.imported || 0) > 0)}
        >
          {phase === 'committing'
            ? 'Importing…'
            : `Import ${counts.imported || 0} ${counts.imported === 1 ? 'person' : 'people'}`}
        </button>
        {busy && <span style={{ fontSize: 12, color: 'var(--t2)' }}>Checking…</span>}
      </div>
    </div>
  )
}
