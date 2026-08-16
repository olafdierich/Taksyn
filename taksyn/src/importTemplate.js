// ============================================================
// Bulk import — download template generator
//
// Builds the .xlsx that organisations fill in or paste into.
// Columns and headers come from importFields.js, so the template
// cannot drift from what the validator accepts.
//
// Structure: three sheets.
//   Clients      headers only, ready to paste into
//   Contractors  same
//   How to use   guidance and a worked example
//
// The example lives on its own sheet deliberately. An example row
// sitting in the data sheet is one someone forgets to delete, and
// then imports as a real person.
//
// KNOWN LIMITATION: SheetJS community edition cannot set a
// whole-column number format, so the date column is not forced to
// text. A pasted value may therefore be reinterpreted by Excel's
// own locale before we ever see it. This is why the column scan
// in detectDateFormat() is the real protection, not the header.
//
// SheetJS is loaded with dynamic import() so it stays out of the
// main bundle, which is already ~1.9 MB.
// ============================================================

import {
  FIELDS, PERSON_TYPES, headersFor,
  DATE_FORMATS, DEFAULT_DATE_FORMAT,
} from './importFields.js'

// ---------- pure: the sheet contents ----------

// Returned shape is plain data so it can be tested without SheetJS.
export function buildTemplateSheets(dateFormat) {
  const fmt = DATE_FORMATS[dateFormat] ? dateFormat : DEFAULT_DATE_FORMAT
  const headers = headersFor(fmt)

  const dataSheets = PERSON_TYPES.map(t => ({
    name: t.sheet,
    rows: [headers],
    widths: FIELDS.map(f => f.width || 18),
  }))

  const ex = DATE_FORMATS[fmt].example

  const guidance = [
    ['Filling in this template'],
    [],
    ['Put clients on the Clients sheet and contractors on the Contractors sheet.'],
    ['One person per row. Do not add, remove, or rename the columns.'],
    [],
    ['Only Surname and First name are required.'],
    ['Every other column may be left blank — a blank is never an error.'],
    [],
    [`Dates must be written as ${fmt}, for example ${ex}.`],
    ['If you paste dates from another system, check a few before uploading.'],
    [],
    ['Reference / Client ID is the number this person has in your existing'],
    ['system, if they have one. It is the most reliable way to avoid'],
    ['creating someone twice, so include it where you can.'],
    [],
    ['Example of a filled-in row:'],
    [],
    headers,
    ['CL-001', 'Rusoke', 'Judith', ex, 'judith@example.com', '+61 400 000 000'],
    [],
    ['Delete nothing on the data sheets — just add your rows under the headers.'],
  ]

  return {
    sheets: [
      ...dataSheets,
      { name: 'How to use', rows: guidance, widths: [24, 22, 22, 24, 30, 22] },
    ],
    dateFormat: fmt,
    headers,
  }
}

export function templateFilename(orgName, dateFormat) {
  const safe = String(orgName || 'organisation')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'organisation'
  const fmt = (DATE_FORMATS[dateFormat] ? dateFormat : DEFAULT_DATE_FORMAT).replace(/\//g, '')
  return `taksyn-people-import-${safe}-${fmt}.xlsx`
}

// ---------- workbook construction ----------

// XLSX is passed in rather than imported here, so this function
// can be exercised in node without touching the browser path.
export function buildWorkbook(XLSX, dateFormat) {
  const { sheets } = buildTemplateSheets(dateFormat)
  const wb = XLSX.utils.book_new()

  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows)
    if (s.widths) ws['!cols'] = s.widths.map(w => ({ wch: w }))
    // Freeze the header row on the data sheets so it stays visible.
    if (s.name !== 'How to use') ws['!freeze'] = { xSplit: 0, ySplit: 1 }
    XLSX.utils.book_append_sheet(wb, ws, s.name)
  }
  return wb
}

// ---------- browser: build and download ----------

export async function downloadTemplate({ dateFormat, orgName } = {}) {
  if (!dateFormat || !DATE_FORMATS[dateFormat]) {
    throw new Error('A date format is required before the template can be built. Ask the organisation which format they use; do not assume.')
  }
  const XLSX = await import('xlsx')
  const wb = buildWorkbook(XLSX, dateFormat)
  XLSX.writeFile(wb, templateFilename(orgName, dateFormat))
}
