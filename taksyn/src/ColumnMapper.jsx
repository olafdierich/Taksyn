// ============================================================
// Bulk import — sheet selection and column mapping
//
// Shown after a file is parsed, before the preview.
//
// Always visible, but collapsed to a one-line summary when every
// column matched and nothing is missing. The summary NAMES the
// matched fields rather than saying "all matched", so a wrong
// pairing reads oddly even when skimmed — which is the whole
// point of showing it at all.
//
// It expands automatically whenever anything is unmatched, a
// required name field is missing, or the person type is unknown.
// Confident and complete is the only case that collapses.
//
// Presentational: no Supabase, no fetches. The caller owns the
// parsed workbook and receives the resolved mapping.
// ============================================================

import { useState, useEffect, useMemo } from 'react'
import {
  MAPPABLE_FIELDS, autoMapHeaders, findHeaderRow,
  extractRows, mappingProblems, personTypeForSheet, isGuidanceSheet,
} from './importParse.js'

const card = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 16, marginBottom: 14,
}
const lbl = {
  display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--t2)',
  marginBottom: 6, textTransform: 'uppercase', letterSpacing: .3,
}
const sel = {
  padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)',
  fontSize: 13, background: 'var(--card)', color: 'var(--text)',
  fontFamily: 'inherit', minWidth: 190,
}
const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--brand)', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
}
const warn = {
  fontSize: 12, color: 'var(--danger, #b42318)', marginTop: 8, lineHeight: 1.5,
}

export default function ColumnMapper({ sheets, onReady }) {
  // The guidance sheet from our own template is never data.
  const dataSheets = useMemo(
    () => (sheets || []).filter(s => !isGuidanceSheet(s.name)),
    [sheets]
  )

  const [sheetName, setSheetName] = useState(dataSheets[0]?.name || '')
  const sheet = dataSheets.find(s => s.name === sheetName) || dataSheets[0]

  const [headerRow, setHeaderRow] = useState(0)
  const [mapping, setMapping]     = useState({})
  const [personType, setPersonType] = useState('')
  const [expanded, setExpanded]   = useState(false)
  const [touched, setTouched]     = useState(false)

  // Re-derive everything when the chosen sheet changes.
  useEffect(() => {
    if (!sheet) return
    const hr = findHeaderRow(sheet.rows)
    setHeaderRow(hr)
    setMapping(autoMapHeaders(sheet.rows[hr] || []))
    setPersonType(personTypeForSheet(sheet.name) || '')
    setTouched(false)
  }, [sheet])

  const headers = (sheet?.rows?.[headerRow]) || []
  const problems = mappingProblems(mapping)
  const mappedCols = new Set(Object.values(mapping))
  const unmapped = headers.filter((h, i) =>
    String(h || '').trim() !== '' && !mappedCols.has(i))

  const confident =
    problems.length === 0 &&
    unmapped.length === 0 &&
    personType !== '' &&
    headers.length > 0

  // Expand on anything unresolved. Never auto-collapse once the
  // user has opened it themselves.
  const showDetail = expanded || touched || !confident

  const setField = (fieldKey, colValue) => {
    setTouched(true)
    setMapping(prev => {
      const next = { ...prev }
      if (colValue === '') delete next[fieldKey]
      else {
        const col = Number(colValue)
        // One column cannot feed two fields.
        for (const k of Object.keys(next)) if (next[k] === col) delete next[k]
        next[fieldKey] = col
      }
      return next
    })
  }

  const summaryPairs = MAPPABLE_FIELDS
    .filter(f => mapping[f.key] !== undefined)
    .map(f => `${headers[mapping[f.key]]} → ${f.label}`)

  const handleContinue = () => {
    const rows = extractRows(sheet.rows, headerRow, mapping)
    onReady({
      sheetName: sheet.name,
      personType,
      mapping,
      headerRowIndex: headerRow,
      rows,
      dateColumnValues: mapping.date_of_birth === undefined
        ? []
        : rows.map(r => r.date_of_birth),
    })
  }

  if (!sheet) {
    return (
      <div style={card}>
        <span style={lbl}>Columns</span>
        <div style={{ fontSize: 13 }}>This file has no data sheets.</div>
      </div>
    )
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span style={lbl}>Columns</span>
        {confident && (
          <button style={linkBtn} onClick={() => setExpanded(e => !e)}>
            {showDetail ? 'Hide' : 'Change'}
          </button>
        )}
      </div>

      {dataSheets.length > 1 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 4 }}>
            This file has {dataSheets.length} sheets. Import one at a time.
          </div>
          <select value={sheetName} onChange={e => setSheetName(e.target.value)} style={sel}>
            {dataSheets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      )}

      {!showDetail && (
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>
          {summaryPairs.length} columns matched: {summaryPairs.join(', ')}.
        </div>
      )}

      {showDetail && (
        <>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 4 }}>
              Are these clients or contractors?
            </div>
            <select value={personType} onChange={e => { setTouched(true); setPersonType(e.target.value) }} style={sel}>
              <option value="">Choose…</option>
              <option value="client">Clients</option>
              <option value="contractor">Contractors</option>
            </select>
            {personTypeForSheet(sheet.name) && (
              <span style={{ fontSize: 12, color: 'var(--t2)', marginLeft: 8 }}>
                taken from the sheet name
              </span>
            )}
          </div>

          <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 8 }}>
            Headers were read from row {headerRow + 1}.
            {' '}
            <button style={linkBtn} onClick={() => { setTouched(true); setHeaderRow(h => Math.max(0, h - 1)) }}>row above</button>
            {' · '}
            <button style={linkBtn} onClick={() => { setTouched(true); setHeaderRow(h => h + 1) }}>row below</button>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {MAPPABLE_FIELDS.map(f => (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, minWidth: 170 }}>{f.label}</div>
                <select
                  value={mapping[f.key] === undefined ? '' : String(mapping[f.key])}
                  onChange={e => setField(f.key, e.target.value)}
                  style={sel}
                >
                  <option value="">— not in this file —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {String(h || '').trim() || `(column ${i + 1})`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {unmapped.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 10, lineHeight: 1.5 }}>
              Not imported: {unmapped.map(h => String(h).trim()).join(', ')}.
              Taksyn has nowhere to put these, so they will be ignored.
            </div>
          )}

          {problems.map((p, i) => <div key={i} style={warn}>{p}</div>)}
        </>
      )}

      <button
        onClick={handleContinue}
        disabled={problems.length > 0 || !personType}
        style={{
          marginTop: 14, padding: '9px 16px', borderRadius: 8, border: 'none',
          fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
          background: (problems.length === 0 && personType) ? 'var(--brand)' : 'var(--border)',
          color: (problems.length === 0 && personType) ? '#fff' : 'var(--t2)',
          cursor: (problems.length === 0 && personType) ? 'pointer' : 'default',
        }}
      >
        Continue
      </button>
    </div>
  )
}
