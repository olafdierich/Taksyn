// ============================================================
// Bulk import — date format resolution
//
// Shown after a file is parsed and the date column identified.
// Four outcomes, from detectDateFormat():
//
//   excel      the column held real date cells. Nothing to ask;
//              this renders a one-line confirmation.
//   DD/MM|MM/DD  proven by a value that can only read one way.
//              Shown with the evidence, and overridable.
//   ambiguous  every value fits both. The user must choose.
//   conflict   the column contains values proving BOTH. Something
//              is wrong with the file; no choice is safe.
//   empty      no dates at all. Nothing to ask.
//
// The choice is always between two concrete readings of the
// user's own rows, never an abstract question about formats.
//
// Presentational only: no Supabase, no fetches. The caller owns
// the resulting format and passes it to buildRowPayload.
// ============================================================

import { useState } from 'react'
import { buildFormatChoices } from './importFields.js'

const card = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 16, marginBottom: 14,
}
const lbl = {
  display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--t2)',
  marginBottom: 6, textTransform: 'uppercase', letterSpacing: .3,
}
const note = { fontSize: 12, color: 'var(--t2)', marginTop: 6, lineHeight: 1.5 }

function optionStyle(selected) {
  return {
    display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
    padding: '10px 12px', borderRadius: 8, marginBottom: 8, fontFamily: 'inherit',
    border: '1px solid ' + (selected ? 'var(--brand)' : 'var(--border)'),
    background: selected ? 'color-mix(in srgb, var(--brand) 8%, transparent)' : 'transparent',
    color: 'var(--text)',
  }
}

export default function DateFormatPrompt({
  detection,          // result of detectDateFormat(columnValues)
  values,             // the raw column values, for samples
  orgDateFormat,      // organisations.date_format, may be null
  onResolve,          // (format) => void
}) {
  const det = detection || { format: 'empty', certain: true }

  // Pre-select: what the data proved, else what the org uses.
  // If neither, nothing is pre-selected — the user must choose,
  // rather than being nudged toward a guess.
  const proven = det.format === 'DD/MM/YYYY' || det.format === 'MM/DD/YYYY'
  const [choice, setChoice] = useState(
    proven ? det.format : (orgDateFormat || null)
  )

  // Nothing to ask.
  if (det.format === 'empty') {
    return (
      <div style={card}>
        <span style={lbl}>Dates</span>
        <div style={{ fontSize: 13 }}>No dates of birth in this file.</div>
      </div>
    )
  }

  if (det.format === 'excel') {
    return (
      <div style={card}>
        <span style={lbl}>Dates</span>
        <div style={{ fontSize: 13 }}>
          The dates in this file are real date cells, so there is nothing to interpret.
        </div>
        <div style={note}>
          Excel stored them as numbers; the way they were displayed does not affect how they are read.
        </div>
      </div>
    )
  }

  const choices = buildFormatChoices(values)
  const viable = choices.filter(c => c.parsesAll)

  return (
    <div style={card}>
      <span style={lbl}>How should the dates be read?</span>

      {proven && (
        <div style={{ fontSize: 13, marginBottom: 10 }}>
          These dates look like <strong>{det.format}</strong>
          {det.evidence ? <> — <code>{det.evidence}</code> can only be read that way.</> : '.'}
          {' '}Change it below if that is wrong.
        </div>
      )}

      {det.format === 'ambiguous' && (
        <div style={{ fontSize: 13, marginBottom: 10 }}>
          Every date in this file fits both readings, so it cannot be worked out
          from the data. Choose the one that matches the system this file came from.
        </div>
      )}

      {det.format === 'conflict' && (
        <div style={{ fontSize: 13, marginBottom: 10, color: 'var(--danger, #b42318)' }}>
          This column contains dates that contradict each other
          {det.evidence ? <> — <code>{det.evidence[0]}</code> and <code>{det.evidence[1]}</code> cannot both be right</> : ''}.
          The file has probably been assembled from two sources. Fix it and upload again
          rather than choosing here.
        </div>
      )}

      {det.format !== 'conflict' && choices.map(c => {
        const selected = choice === c.format
        const dead = !c.parsesAll && viable.length > 0
        return (
          <button
            key={c.format}
            onClick={() => !dead && setChoice(c.format)}
            disabled={dead}
            style={{ ...optionStyle(selected), opacity: dead ? .45 : 1, cursor: dead ? 'default' : 'pointer' }}
          >
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              {c.format}
              {orgDateFormat === c.format && (
                <span style={{ fontWeight: 400, color: 'var(--t2)' }}> — this organisation's usual format</span>
              )}
            </div>
            {c.samples.map((s, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--t2)' }}>
                <code>{s.raw}</code>{' → '}
                {s.label || <em>cannot be read this way</em>}
              </div>
            ))}
          </button>
        )
      })}

      {det.format !== 'conflict' && (
        <button
          onClick={() => choice && onResolve(choice)}
          disabled={!choice}
          style={{
            marginTop: 4, padding: '9px 16px', borderRadius: 8, border: 'none',
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            background: choice ? 'var(--brand)' : 'var(--border)',
            color: choice ? '#fff' : 'var(--t2)',
            cursor: choice ? 'pointer' : 'default',
          }}
        >
          Use this reading
        </button>
      )}

      {!orgDateFormat && (
        <div style={note}>
          This organisation has no date format recorded. Setting one in the
          organisation's settings will pre-select it next time.
        </div>
      )}
    </div>
  )
}
