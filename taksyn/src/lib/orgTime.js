// Org-timezone date helpers.
// Every calculation uses Intl.DateTimeFormat with the `timeZone` option so daylight-saving
// transitions are handled correctly. NEVER do manual "+N hours" offset math here — it breaks on DST.

// Format a Date to a 'YYYY-MM-DD' string in the given IANA timezone.
// Falls back to 'UTC' if the timezone is missing or not a valid IANA name.
function ymdInTz(date, timezone) {
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit' }
  try {
    // 'en-CA' renders dates as YYYY-MM-DD, which sorts and compares as plain strings.
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', ...opts }).format(date)
  } catch {
    // Invalid/unknown timezone name → fall back to UTC rather than throwing.
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', ...opts }).format(date)
  }
}

// Today's date as a 'YYYY-MM-DD' string in the given IANA timezone.
//   orgToday('Africa/Kampala') // e.g. '2026-07-09'
//   orgToday(null)             // falls back to UTC
export function orgToday(timezone) {
  return ymdInTz(new Date(), timezone)
}

// True if `isoTs` falls on the same calendar day as "now", evaluated in the given IANA timezone.
//   isSameOrgDay('2026-07-09T21:30:00Z', 'Africa/Kampala') // true while it is still the 9th in Kampala
//   isSameOrgDay('2026-07-08T23:00:00Z', 'Australia/Sydney') // may already be the 9th in Sydney → false
export function isSameOrgDay(isoTs, timezone) {
  if (!isoTs) return false
  const d = new Date(isoTs)
  if (isNaN(d.getTime())) return false
  return ymdInTz(d, timezone) === ymdInTz(new Date(), timezone)
}
