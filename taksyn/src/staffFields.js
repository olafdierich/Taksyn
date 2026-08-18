// ============================================================
// Staff bulk import — field definitions and helpers
//
// Deliberately separate from importFields.js. Staff and clients
// go to different places: a client becomes an org_people row, a
// staff member becomes an auth account with a login. Different
// columns, different rules, different template.
//
// Pure: no React, no Supabase, no DOM.
// ============================================================

import { normaliseHeader } from './importParse.js'
// parseDate is the SAME function the client import uses: both slash
// formats, ISO, two-digit years and Excel serials, 37 assertions.
// Duplicating it here would let the two imports read a date
// differently, which is the one outcome worth avoiding.
import { parseDate } from './importFields.js'

// ---------- access levels ----------
//
// client_admin is absent on purpose. invite-user clamps a caller
// to roles STRICTLY BELOW their own, so a client_admin running an
// import can grant manager, supervisor or worker and nothing else.
// Offering client_admin would produce rows that pass the template
// and then fail at send.
export const ACCESS_LEVELS = [
  { key: 'manager',    label: 'Manager',      level: 3 },
  { key: 'supervisor', label: 'Supervisor',   level: 2 },
  { key: 'worker',     label: 'Staff Member', level: 1 },
]

// Accept the friendly label, the internal key, or a few obvious
// synonyms. People type what they see, and what they see varies.
const ACCESS_SYNONYMS = {
  manager:    ['manager', 'mgr'],
  supervisor: ['supervisor', 'team leader', 'team lead', 'leader', 'supervisor/lead'],
  worker:     ['staff member', 'staff', 'worker', 'employee', 'team member', 'member'],
}

export function normaliseAccessLevel(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase()
  if (!v) return null
  for (const lvl of ACCESS_LEVELS) {
    if (v === lvl.key) return lvl.key
    if ((ACCESS_SYNONYMS[lvl.key] || []).includes(v)) return lvl.key
  }
  return null
}

// What this caller may grant: strictly below their own level.
export function grantableLevels(callerRole, isSuperAdmin = false) {
  const callerLevel = isSuperAdmin ? 5 : ({
    client_admin: 4, manager: 3, supervisor: 2, worker: 1,
  }[callerRole] || 0)
  return ACCESS_LEVELS.filter(l => l.level < callerLevel)
}

// ---------- fields ----------

export const STAFF_FIELDS = [
  { key: 'email',       header: 'Email',        required: true,  width: 30 },
  { key: 'first_name',  header: 'First name',   required: true,  width: 20 },
  { key: 'surname',     header: 'Surname',      required: true,  width: 20 },
  { key: 'access_role', header: 'Access level', required: true,  width: 18 },
  { key: 'job_role',    header: 'Job role',     required: false, width: 22 },
  { key: 'date_of_birth', header: 'Date of birth', required: false, width: 22, isDate: true },
]

export const STAFF_HEADERS = STAFF_FIELDS.map(f => f.header)

export const STAFF_MAPPABLE = [
  { key: 'email',       label: 'Email' },
  { key: 'full_name',   label: 'Full name (single column)' },
  { key: 'first_name',  label: 'First name' },
  { key: 'surname',     label: 'Surname' },
  { key: 'access_role', label: 'Access level' },
  { key: 'job_role',    label: 'Job role' },
  { key: 'date_of_birth', label: 'Date of birth' },
]

// Bare 'role' maps to JOB role, not access level. Another system's
// export saying "Role" means what someone does, not what they may
// do in Taksyn — access level is a Taksyn concept their file has
// no reason to contain.
export const STAFF_ALIASES = {
  email:       ['email address', 'email', 'e mail', 'work email', 'mail'],
  surname:     ['surname', 'last name', 'lastname', 'family name', 'last'],
  first_name:  ['first name', 'firstname', 'given name', 'given names', 'forename', 'first', 'given'],
  full_name:   ['full name', 'fullname', 'name', 'employee name', 'staff name'],
  access_role: ['access level', 'access', 'permission', 'permissions',
                'taksyn role', 'user role', 'system role', 'level'],
  job_role:    ['job role', 'job title', 'position', 'occupation', 'title', 'role'],
  date_of_birth: ['date of birth', 'dateofbirth', 'dob', 'birth date', 'birthdate',
                  'date born', 'born'],
}

function scoreStaff(header, fieldKey) {
  const h = normaliseHeader(header)
  if (!h) return 0
  const words = h.split(' ')
  const aliases = STAFF_ALIASES[fieldKey] || []
  let best = 0
  for (let i = 0; i < aliases.length; i++) {
    const a = aliases[i]
    let score = 0
    if (h === a) score = 1000 - i
    else if (h.startsWith(a + ' ') || h.endsWith(' ' + a)) score = 500 - i
    else {
      const aw = a.split(' ')
      for (let w = 0; w + aw.length <= words.length; w++) {
        if (aw.every((x, k) => words[w + k] === x)) { score = 200 - i; break }
      }
    }
    if (score > best) best = score
  }
  return best
}

export function autoMapStaffHeaders(headers) {
  const pairs = []
  ;(headers || []).forEach((h, col) => {
    for (const f of STAFF_MAPPABLE) {
      const s = scoreStaff(h, f.key)
      if (s > 0) pairs.push({ col, field: f.key, score: s })
    }
  })
  pairs.sort((a, b) => b.score - a.score || a.col - b.col)

  const mapping = {}
  const used = new Set()
  for (const p of pairs) {
    if (mapping[p.field] !== undefined) continue
    if (used.has(p.col)) continue
    mapping[p.field] = p.col
    used.add(p.col)
  }
  if (mapping.full_name !== undefined
      && mapping.first_name !== undefined
      && mapping.surname !== undefined) {
    delete mapping.full_name
  }
  return mapping
}

export function staffMappingProblems(mapping) {
  const problems = []
  if (mapping.email === undefined) {
    problems.push('No email column is mapped. Staff need an email address to sign in, so it cannot be left out.')
  }
  const hasFull = mapping.full_name !== undefined
  const hasFirst = mapping.first_name !== undefined
  const hasLast = mapping.surname !== undefined
  if (!hasFull && !hasFirst && !hasLast) {
    problems.push('No name column is mapped. Map either a single full name column, or first name and surname.')
  } else if (!hasFull && (!hasFirst || !hasLast)) {
    problems.push(hasFirst
      ? 'Only first name is mapped. Map surname too, or map a single full name column instead.'
      : 'Only surname is mapped. Map first name too, or map a single full name column instead.')
  }
  if (mapping.access_role === undefined) {
    problems.push('No access level column is mapped. Every person needs one, so Taksyn knows what they may do.')
  }
  return problems
}

// ---------- extraction ----------

export function extractStaffRows(rows, headerRowIndex, mapping) {
  const out = []
  const get = (row, field) => {
    const col = mapping[field]
    if (col === undefined) return ''
    const v = row[col]
    // Dates and numbers pass through untouched, mirroring
    // importParse.extractRows. Stringifying a Date here turned
    // 3 November 1990 into 'Sun Mar 11 1990 00:00:00 GMT+1000',
    // which parseDate then correctly refused — and the row was
    // reported as having an unreadable date of birth.
    if (v instanceof Date) return v
    if (typeof v === 'number') return v
    return String(v == null ? '' : v).trim()
  }

  for (let i = headerRowIndex + 1; i < (rows || []).length; i++) {
    const row = rows[i] || []
    const rec = {
      row_no: i + 1,
      email:       get(row, 'email'),
      full_name:   get(row, 'full_name'),
      first_name:  get(row, 'first_name'),
      surname:     get(row, 'surname'),
      access_role: get(row, 'access_role'),
      job_role:    get(row, 'job_role'),
      date_of_birth: get(row, 'date_of_birth'),
    }
    const anything = ['email','full_name','first_name','surname','access_role','job_role','date_of_birth']
      .some(k => rec[k] !== '')
    if (anything) out.push(rec)
  }
  return out
}

// ---------- payload ----------

// Shapes rows for stage_staff_batch. Access level is normalised
// here so "Staff Member" from the template becomes 'worker'; an
// unrecognised value is passed through unchanged so the server
// reports it against the right row rather than silently blanking it.
// dateFormat is the organisation's own, resolved before this is
// called, exactly as the client import does it.
export function buildStaffPayload(rows, { dateFormat } = {}) {
  return (rows || []).map((r, i) => {
    const full = String(r.full_name || '').trim()
    const name = full || [String(r.first_name || '').trim(),
                          String(r.surname || '').trim()].filter(Boolean).join(' ')
    const access = normaliseAccessLevel(r.access_role)
    return {
      row_no: r.row_no != null ? r.row_no : i + 1,
      email: String(r.email || '').trim().toLowerCase(),
      full_name: name,
      access_role: access || String(r.access_role || '').trim(),
      job_role: String(r.job_role || '').trim() || null,
      // Parsed to ISO here. An unparseable value is passed through
      // raw so the server reports it against the right row rather
      // than the row arriving silently without a date of birth.
      date_of_birth: (() => {
        const raw = r.date_of_birth
        if (raw == null || String(raw).trim() === '') return null
        return parseDate(raw, dateFormat) || String(raw).trim()
      })(),
    }
  })
}
