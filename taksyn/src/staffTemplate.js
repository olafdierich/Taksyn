// ============================================================
// Staff bulk import — template generator
//
// A separate download from the client/contractor template. The
// two imports have different destinations: one writes register
// rows, the other creates user accounts with logins. One file
// containing both invites exactly the confusion this separation
// avoids.
//
// SheetJS community edition CANNOT write Excel dropdowns — tested,
// the dataValidation property is silently dropped and no XML
// reaches the file. So the permitted values are printed in a
// reference block beside the entry area, where they are visible
// while typing, and validated strictly on upload.
// ============================================================

import { ACCESS_LEVELS, STAFF_FIELDS, STAFF_HEADERS } from './staffFields.js'

// jobRoles: the organisation's own list, from org_custom_roles.
// May be empty — an org that has not configured roles yet should
// still get a usable template.
export function buildStaffTemplateSheets(orgName, jobRoles = []) {
  const roles = (jobRoles || []).map(r => String(r).trim()).filter(Boolean)

  // Header row, then a reference block to the right of the data
  // columns. Column G is left blank as a gutter so the reference
  // is visibly separate from anything to be filled in.
  const header = [...STAFF_HEADERS, '', 'ACCESS LEVELS →', ...ACCESS_LEVELS.map(l => l.label)]

  const rows = [header]

  // If the org has job roles, list them on the row below, same shape.
  if (roles.length) {
    rows.push([...STAFF_HEADERS.map(() => ''), '', 'JOB ROLES →', ...roles])
  }

  const guidance = [
    ['Inviting staff'],
    [],
    ['Everyone on this sheet will be sent an invitation to join Taksyn.'],
    ['They create their own password; you never see or set it.'],
    [],
    ['Email, First name, Surname and Access level are all required.'],
    ['Job role is optional.'],
    [],
    ['ACCESS LEVEL controls what someone may do in Taksyn.'],
    ['Type one of these exactly:'],
    ...ACCESS_LEVELS.map(l => ['', l.label]),
    [],
    ['You cannot invite someone at or above your own access level.'],
    [],
    roles.length ? ['JOB ROLE is what they do at ' + (orgName || 'your organisation') + '.']
                 : ['JOB ROLE is what they do at ' + (orgName || 'your organisation') + '.'],
    roles.length ? ['Type one of these exactly:']
                 : ['No job roles have been set up yet. Add them under Roles & Positions,'],
    ...(roles.length ? roles.map(r => ['', r])
                     : [['or leave this column blank for now.']]),
    [],
    ['Nothing is sent until you have seen the whole list and confirmed it.'],
    [],
    ['Example:'],
    [],
    STAFF_HEADERS,
    ['judith@example.com', 'Judith', 'Rusoke', 'Staff Member', roles[0] || ''],
  ]

  return {
    sheets: [
      { name: 'Staff', rows, widths: [...STAFF_FIELDS.map(f => f.width), 4, 18, 18, 18, 18] },
      { name: 'How to use', rows: guidance, widths: [30, 24, 22, 22, 22] },
    ],
    headers: STAFF_HEADERS,
  }
}

export function staffTemplateFilename(orgName) {
  const safe = String(orgName || 'organisation')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'organisation'
  return `taksyn-staff-invite-${safe}.xlsx`
}

export function buildStaffWorkbook(XLSX, orgName, jobRoles) {
  const { sheets } = buildStaffTemplateSheets(orgName, jobRoles)
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows)
    if (s.widths) ws['!cols'] = s.widths.map(w => ({ wch: w }))
    if (s.name === 'Staff') ws['!freeze'] = { xSplit: 0, ySplit: 1 }
    XLSX.utils.book_append_sheet(wb, ws, s.name)
  }
  return wb
}

export async function downloadStaffTemplate({ orgName, jobRoles } = {}) {
  const XLSX = await import('xlsx')
  const wb = buildStaffWorkbook(XLSX, orgName, jobRoles)
  XLSX.writeFile(wb, staffTemplateFilename(orgName))
}
