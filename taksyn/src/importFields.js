// ============================================================
// Bulk import — field definitions and pure helpers
//
// Single source of truth for:
//   * which columns the download template carries
//   * how a client's spreadsheet maps onto org_people
//   * how dates are read
//
// The template generator, the column mapper, and the dry-run
// payload builder all read from here, so they cannot drift.
//
// Deliberately pure: no React, no Supabase, no DOM. Everything
// in this file can be tested with node directly.
//
// Backend reference (proven on SANDBOX):
//   import_people_batch(p_org, p_rows, p_filename, p_sha256,
//                       p_dry_run, p_overrides)
//   p_rows entries accept: row_no, person_type, full_name,
//   contact_email, contact_phone, external_ref, date_of_birth
//   date_of_birth must reach the RPC as YYYY-MM-DD.
// ============================================================

// ---------- date formats ----------

export const DATE_FORMATS = {
  'DD/MM/YYYY': { label: 'DD/MM/YYYY', dayFirst: true,  example: '25/12/1958' },
  'MM/DD/YYYY': { label: 'MM/DD/YYYY', dayFirst: false, example: '12/25/1958' },
  'YYYY-MM-DD': { label: 'YYYY-MM-DD', iso: true,       example: '1958-12-25' },
}

export const DEFAULT_DATE_FORMAT = 'DD/MM/YYYY'

// Countries that write month first. Everything else is day-first.
// Kept short deliberately: this only pre-fills a setting the
// organisation can change, it is not a source of truth.
const MONTH_FIRST_COUNTRIES = [
  'us', 'usa', 'u.s.', 'u.s.a.', 'united states', 'united states of america',
]

export function dateFormatForCountry(country) {
  const c = String(country || '').trim().toLowerCase()
  if (!c) return null                     // unknown: ASK, never assume
  return MONTH_FIRST_COUNTRIES.includes(c) ? 'MM/DD/YYYY' : 'DD/MM/YYYY'
}

// ---------- person types ----------

// org_people_type_check permits exactly these two. 'staff' is
// refused by the database — staff belong to auth.users /
// profiles / org_members and need an invite, not a register row.
export const PERSON_TYPES = [
  { key: 'client',     sheet: 'Clients',     label: 'Client' },
  { key: 'contractor', sheet: 'Contractors', label: 'Contractor' },
]

// ---------- field definitions ----------

// `target` is the org_people column. Two source fields share
// full_name: the template splits the name because most care
// software exports it split, and we join on the way in.
export const FIELDS = [
  {
    key: 'external_ref',
    header: 'Reference / Client ID',
    target: 'external_ref',
    required: false,
    width: 22,
    hint: 'Their number in your existing system, if you have one',
  },
  {
    key: 'surname',
    header: 'Surname',
    target: 'full_name',
    joinOrder: 2,
    required: true,
    width: 20,
  },
  {
    key: 'first_name',
    header: 'First name',
    target: 'full_name',
    joinOrder: 1,
    required: true,
    width: 20,
  },
  {
    key: 'date_of_birth',
    header: 'Date of birth',      // suffixed with the format at generation
    target: 'date_of_birth',
    required: false,
    width: 22,
    isDate: true,
  },
  {
    key: 'contact_email',
    header: 'Email',
    target: 'contact_email',
    required: false,
    width: 28,
    isEmail: true,
  },
  {
    key: 'contact_phone',
    header: 'Phone',
    target: 'contact_phone',
    required: false,
    width: 20,
  },
]

// The header a given field carries, for a given org date format.
export function headerFor(field, dateFormat) {
  if (!field.isDate) return field.header
  const fmt = DATE_FORMATS[dateFormat] ? dateFormat : DEFAULT_DATE_FORMAT
  return `${field.header} (${fmt})`
}

export function headersFor(dateFormat) {
  return FIELDS.map(f => headerFor(f, dateFormat))
}

// ---------- normalisation ----------

// Must match the SQL exactly, or the client-side duplicate hint
// and the server's verdict will disagree:
//   lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g'))
export function normaliseName(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase()
}

export function joinName(firstName, surname, firstNameFirst = true) {
  const f = String(firstName == null ? '' : firstName).trim()
  const s = String(surname == null ? '' : surname).trim()
  if (!f) return s
  if (!s) return f
  return firstNameFirst ? `${f} ${s}` : `${s} ${f}`
}

// ---------- dates ----------

// Excel stores real dates as a serial number counting from
// 1899-12-30. When SheetJS hands us a number, no ambiguity
// exists and no format question needs asking.
export function excelSerialToISO(serial) {
  const n = Number(serial)
  if (!Number.isFinite(n) || n <= 0) return null
  const ms = Math.round((n - 25569) * 86400 * 1000)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function isValidYMD(y, m, d) {
  if (!(y >= 1900 && y <= 2200)) return false
  if (!(m >= 1 && m <= 12)) return false
  if (!(d >= 1 && d <= 31)) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y
      && probe.getUTCMonth() === m - 1
      && probe.getUTCDate() === d
}

function splitDateParts(value) {
  const s = String(value == null ? '' : value).trim()
  if (!s) return null
  const m = s.match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})$/)
  if (!m) return null
  return [m[1], m[2], m[3]].map(x => parseInt(x, 10))
}

// Parse one value against a known format. Returns YYYY-MM-DD or null.
export function parseDate(value, dateFormat) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return excelSerialToISO(value)
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  const parts = splitDateParts(value)
  if (!parts) return null
  const [a, b, c] = parts

  let y, mo, d
  if (dateFormat === 'YYYY-MM-DD' || a > 31) {
    y = a; mo = b; d = c
  } else if (dateFormat === 'MM/DD/YYYY') {
    mo = a; d = b; y = c
  } else {
    d = a; mo = b; y = c
  }

  if (y < 100) y += y < 30 ? 2000 : 1900   // two-digit year
  return isValidYMD(y, mo, d) ? `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}` : null
}

// Work out how a whole column should be read.
//
//   'excel'     every value was a real date cell; nothing to ask
//   'DD/MM/YYYY' | 'MM/DD/YYYY'  proven by a value that can only
//                parse one way
//   'ambiguous' every value fits both; the user must choose
//   'empty'     no dates at all
//
// One value dated after the 12th settles the entire column, which
// is why any list of more than a dozen people almost never needs
// to ask.
export function detectDateFormat(values) {
  let seen = 0, excel = 0
  let firstOver12 = null, secondOver12 = null
  let evidence = null, evidenceSecond = null

  for (const v of values || []) {
    if (v == null || v === '') continue
    seen++

    if (typeof v === 'number' || v instanceof Date) { excel++; continue }

    const parts = splitDateParts(v)
    if (!parts) continue
    const [a, b] = parts

    if (a > 31) continue                    // leading 4-digit year, ISO-ish
    if (a > 12 && firstOver12 === null)  { firstOver12 = v;  evidence = v }
    if (b > 12 && secondOver12 === null) { secondOver12 = v; evidenceSecond = v }
  }

  if (seen === 0) return { format: 'empty', certain: true }
  if (excel === seen) return { format: 'excel', certain: true }

  // Both kinds of evidence means the column is internally
  // contradictory — worth surfacing rather than silently picking.
  if (firstOver12 !== null && secondOver12 !== null) {
    return {
      format: 'conflict', certain: false,
      evidence: [String(firstOver12), String(secondOver12)],
    }
  }
  if (firstOver12 !== null)  return { format: 'DD/MM/YYYY', certain: true, evidence: String(evidence) }
  if (secondOver12 !== null) return { format: 'MM/DD/YYYY', certain: true, evidence: String(evidenceSecond) }

  return { format: 'ambiguous', certain: false }
}

// ---------- payload ----------

// Turn mapped spreadsheet rows into the p_rows array the RPC
// expects. Rows are NOT validated here — that is the server's
// job, and duplicating it client-side would let the two drift.
export function buildRowPayload(rows, { personType, dateFormat, firstNameFirst = true } = {}) {
  return (rows || []).map((r, i) => {
    const out = {
      row_no: r.row_no != null ? r.row_no : i + 1,
      person_type: personType,
      full_name: joinName(r.first_name, r.surname, firstNameFirst),
    }
    const ref   = String(r.external_ref  == null ? '' : r.external_ref).trim()
    const email = String(r.contact_email == null ? '' : r.contact_email).trim()
    const phone = String(r.contact_phone == null ? '' : r.contact_phone).trim()
    if (ref)   out.external_ref  = ref
    if (email) out.contact_email = email
    if (phone) out.contact_phone = phone

    const dob = parseDate(r.date_of_birth, dateFormat)
    if (dob) out.date_of_birth = dob
    else if (r.date_of_birth != null && String(r.date_of_birth).trim() !== '') {
      // Unparseable: pass the raw value through so the server
      // reports it as an error against the right row, rather
      // than the row silently arriving with no date of birth.
      out.date_of_birth = String(r.date_of_birth).trim()
    }
    return out
  })
}
