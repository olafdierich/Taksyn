// ============================================================
// Bulk import — file parsing and column matching
//
// Turns an uploaded .xlsx or .csv into mapped rows ready for
// buildRowPayload(). Pure logic apart from parseWorkbook, which
// takes SheetJS as an argument so it can be tested in node.
//
// Three problems this solves, in order:
//   1. which row holds the headers (exports often have a title
//      row, a blank row, or an export timestamp above them)
//   2. which of their columns is which of our fields
//   3. pulling the data rows out against that mapping
//
// A single "Name" column is taken AS GIVEN and never split.
// Splitting "Judith Rusoke" guesses; three-part names and
// surnames containing spaces both break it, and the failure is
// silent — a person filed under the wrong name.
// ============================================================

import { FIELDS } from './importFields.js'

// ---------- header matching ----------

export function normaliseHeader(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')        // drop "(DD/MM/YYYY)" and similar
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Ordered: earlier aliases win when a header could match two
// fields. 'name' sits last in full_name so 'first name' and
// 'surname' are claimed by their own fields first.
export const FIELD_ALIASES = {
  external_ref: [
    'reference client id', 'reference', 'client id', 'clientid', 'client number',
    'ndis number', 'ndis', 'participant number', 'participant id',
    'file number', 'record number', 'member id', 'ref', 'id',
  ],
  surname: [
    'surname', 'last name', 'lastname', 'family name', 'last',
  ],
  first_name: [
    'first name', 'firstname', 'given name', 'given names', 'forename',
    'first', 'given',
  ],
  full_name: [
    'full name', 'fullname', 'name', 'person', 'client name', 'contact name',
  ],
  date_of_birth: [
    'date of birth', 'dateofbirth', 'dob', 'birth date', 'birthdate',
    'date born', 'born',
  ],
  contact_email: [
    'email address', 'email', 'e mail', 'mail',
  ],
  contact_phone: [
    'phone number', 'mobile number', 'contact number', 'phone', 'mobile',
    'telephone', 'tel', 'contact',
  ],
}

// Fields the mapper can target. full_name is included as an
// alternative to the first_name + surname pair.
export const MAPPABLE_FIELDS = [
  { key: 'external_ref',  label: 'Reference / Client ID' },
  { key: 'full_name',     label: 'Full name (single column)' },
  { key: 'first_name',    label: 'First name' },
  { key: 'surname',       label: 'Surname' },
  { key: 'date_of_birth', label: 'Date of birth' },
  { key: 'contact_email', label: 'Email' },
  { key: 'contact_phone', label: 'Phone' },
]

// Score how well one header matches one field.
//
// Two rules learned the hard way:
//   * take the BEST score across all aliases, never the first
//     match. 'given names' hit the weaker alias 'given name' by
//     containment and returned before reaching its own exact
//     entry, losing the column to a full-name guess.
//   * match on WORD boundaries, never raw substrings. 'Widget'
//     contains 'id', and matched external_ref.
function matchScore(header, fieldKey) {
  const h = normaliseHeader(header)
  if (!h) return 0
  const words = h.split(' ')
  const aliases = FIELD_ALIASES[fieldKey] || []
  let best = 0

  for (let i = 0; i < aliases.length; i++) {
    const a = aliases[i]
    let score = 0
    if (h === a) {
      score = 1000 - i
    } else if (h.startsWith(a + ' ') || h.endsWith(' ' + a)) {
      score = 500 - i
    } else {
      // whole-word containment only
      const aWords = a.split(' ')
      for (let w = 0; w + aWords.length <= words.length; w++) {
        if (aWords.every((aw, k) => words[w + k] === aw)) { score = 200 - i; break }
      }
    }
    if (score > best) best = score
  }
  return best
}

// Greedy best-match: highest-scoring pairs claimed first, so a
// strong match cannot be stolen by a weaker one earlier in the row.
export function autoMapHeaders(headers) {
  const pairs = []
  ;(headers || []).forEach((h, col) => {
    for (const f of MAPPABLE_FIELDS) {
      const s = matchScore(h, f.key)
      if (s > 0) pairs.push({ col, field: f.key, score: s })
    }
  })
  pairs.sort((a, b) => b.score - a.score || a.col - b.col)

  const mapping = {}
  const usedCols = new Set()
  for (const p of pairs) {
    if (mapping[p.field] !== undefined) continue
    if (usedCols.has(p.col)) continue
    mapping[p.field] = p.col
    usedCols.add(p.col)
  }

  // A file with both a full name column and split columns: prefer
  // the split pair, since it is unambiguous. Do not silently keep both.
  if (mapping.full_name !== undefined
      && mapping.first_name !== undefined
      && mapping.surname !== undefined) {
    delete mapping.full_name
  }
  return mapping
}

// ---------- header row ----------

// Exports often carry a title, a blank line, or an export
// timestamp above the real headers. Take the first row that
// matches at least two known fields; fall back to the first
// non-empty row.
export function findHeaderRow(rows, { scan = 10 } = {}) {
  const limit = Math.min(scan, (rows || []).length)
  let firstNonEmpty = -1

  for (let i = 0; i < limit; i++) {
    const row = rows[i] || []
    const nonEmpty = row.filter(c => String(c == null ? '' : c).trim() !== '')
    if (nonEmpty.length === 0) continue
    if (firstNonEmpty === -1) firstNonEmpty = i

    const mapped = Object.keys(autoMapHeaders(row)).length
    if (mapped >= 2) return i
  }
  return firstNonEmpty === -1 ? 0 : firstNonEmpty
}

// ---------- workbook ----------

export function parseWorkbook(XLSX, data) {
  const wb = XLSX.read(data, { type: 'array', cellDates: true })
  return {
    sheets: wb.SheetNames.map(name => ({
      name,
      // blankrows MUST stay true. Dropping blank rows shifts every
      // subsequent index, so row_no would no longer match the row
      // the user sees in Excel — and row_no is how every error and
      // skip is reported back to them.
      rows: XLSX.utils.sheet_to_json(wb.Sheets[name], {
        header: 1, blankrows: true, defval: '', raw: true,
      }),
    })),
  }
}

// Our own template names its sheets, which tells us the person
// type without asking. Any other name means we must ask.
export function personTypeForSheet(sheetName) {
  const n = normaliseHeader(sheetName)
  if (n === 'clients' || n === 'client') return 'client'
  if (n === 'contractors' || n === 'contractor') return 'contractor'
  return null
}

export function isGuidanceSheet(sheetName) {
  return normaliseHeader(sheetName) === 'how to use'
}

// ---------- extraction ----------

// Pull data rows out against a mapping. row_no is the
// spreadsheet's own row number so anything reported back to the
// user points at the row they can actually see.
export function extractRows(rows, headerRowIndex, mapping) {
  const out = []
  const get = (row, field) => {
    const col = mapping[field]
    if (col === undefined) return ''
    const v = row[col]
    if (v instanceof Date) return v
    if (typeof v === 'number') return v
    return String(v == null ? '' : v).trim()
  }

  for (let i = headerRowIndex + 1; i < (rows || []).length; i++) {
    const row = rows[i] || []
    const rec = {
      row_no: i + 1,                       // 1-based, as the user sees it
      external_ref:  get(row, 'external_ref'),
      full_name:     get(row, 'full_name'),
      first_name:    get(row, 'first_name'),
      surname:       get(row, 'surname'),
      date_of_birth: get(row, 'date_of_birth'),
      contact_email: get(row, 'contact_email'),
      contact_phone: get(row, 'contact_phone'),
    }
    // Skip rows that are entirely blank. A row with only a name
    // is NOT blank and must reach the server, which will judge it.
    const anything = ['external_ref','full_name','first_name','surname',
                      'date_of_birth','contact_email','contact_phone']
      .some(k => String(rec[k] == null ? '' : rec[k]).trim() !== '')
    if (anything) out.push(rec)
  }
  return out
}

// Which mapped fields are missing for this to be importable.
export function mappingProblems(mapping) {
  const problems = []
  const hasFull  = mapping.full_name !== undefined
  const hasFirst = mapping.first_name !== undefined
  const hasLast  = mapping.surname !== undefined

  if (!hasFull && !hasFirst && !hasLast) {
    problems.push('No name column is mapped. Map either a single full name column, or first name and surname.')
  } else if (!hasFull && (!hasFirst || !hasLast)) {
    problems.push(hasFirst
      ? 'Only first name is mapped. Map surname too, or map a single full name column instead.'
      : 'Only surname is mapped. Map first name too, or map a single full name column instead.')
  }
  return problems
}
