import { supabase } from './supabase.js'

// Project report — a governance document for one project, rendered as
// HTML and printed from the browser.
//
// NOT jsPDF, for the reason boardReport.js records: coordinate-placed
// documents draw off the bottom of a page unnoticed the moment content
// grows. A browser paginates.
//
// UNLIKE boardReport, this fetches its own data. That module takes
// everything as arguments so two documents cannot drift by recomputing
// the same figure differently — but the figures here are different ones
// over a different window, so there is nothing to drift against.
//
// COLOUR IS THE TEAM, AND MATCHES THE SCREEN.
// The hash and palette below are the same ones ProjectsView uses, so a
// team is the same colour in the app and in the printed document. Two
// palettes would be worse than none: someone comparing a screen to a
// page would read the mismatch as a mistake.
//
// WHAT IS COMPUTED AND WHAT IS NOT
// Everything factual is derived. The judgement — strengths, weaknesses,
// how to structure what comes next — is typed by a person and stored
// with their name on it. A machine-written assessment of named staff
// has no place in a document that may go to a regulator.

// Taksyn's own values, taken by frequency from App.jsx.
const TEAM_COLOURS = [
  { solid: '#10B981', faded: '#A7E8D0' },
  { solid: '#F59E0B', faded: '#FBD89B' },
  { solid: '#3B82F6', faded: '#B3CDFB' },
  { solid: '#8B5CF6', faded: '#CDBDF9' },
  { solid: '#5BC8C0', faded: '#BFE9E6' },
  { solid: '#F97316', faded: '#FCC49A' },
  { solid: '#6366F1', faded: '#C0C1F7' },
  { solid: '#64748B', faded: '#C4CBD5' }
]
function teamColour(id) {
  const k = String(id || '_')
  let h = 0
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0
  return TEAM_COLOURS[h % TEAM_COLOURS.length]
}

const CSS = `
  :root{
    --paper:#FBFAF7; --ink:#1A2033; --ink-2:#4A5568; --ink-3:#8A94A6;
    --rule:#D8D4CB; --rule-2:#EDEAE3;
    --brand:#00A87E; --green:#10B981; --amber:#F59E0B; --red:#EF4444;
    --blue:#3B82F6; --violet:#8B5CF6;
    --band-ok:#E7F7F0; --band-warn:#FEF3C7; --band-bad:#FEE2E2; --band-info:#E6F1FB;
  }
  *{box-sizing:border-box}
  body{margin:0;background:#E9E6DF;color:var(--ink);
    font-family:'Source Serif 4',Georgia,serif;font-size:15px;line-height:1.55;
    font-variant-numeric:tabular-nums}
  .sheet{max-width:900px;margin:24px auto;background:var(--paper);
    padding:52px 56px 60px;box-shadow:0 1px 3px rgba(20,30,45,.1),0 12px 40px rgba(20,30,45,.06)}
  h1,h2,h3,h4,.eyebrow,.stat-n,th,.pill,.gl{font-family:'Bricolage Grotesque',system-ui,sans-serif}
  h1{font-size:38px;line-height:1.05;font-weight:800;letter-spacing:-.022em;margin:.28em 0 .3em}
  h2{font-size:20px;font-weight:700;letter-spacing:-.012em;margin:44px 0 8px;
    padding-bottom:9px;border-bottom:2px solid var(--ink)}
  h3{font-size:15px;font-weight:700;margin:24px 0 4px;color:var(--brand)}
  h4{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
    color:var(--ink-2);margin:22px 0 7px}
  p{margin:0 0 12px;max-width:68ch}
  .wide{max-width:none}
  .lede{font-size:17px;color:var(--ink-2)}
  .summary{font-size:16.5px;line-height:1.62;max-width:none;margin:14px 0 4px}
  .eyebrow{font-size:10.5px;font-weight:600;letter-spacing:.15em;
    text-transform:uppercase;color:var(--brand)}
  .note{font-size:12.5px;color:var(--ink-2)}
  .masthead{border-bottom:3px solid var(--ink);padding-bottom:20px}
  .mast-top{display:flex;align-items:center;gap:18px;margin-bottom:10px}
  .mast-logo{max-height:52px;max-width:180px;object-fit:contain;flex:none}
  .mast-org{min-width:0}
  .mast-name{font-family:'Bricolage Grotesque',system-ui,sans-serif;
    font-size:15px;font-weight:700;color:var(--ink);line-height:1.2;margin-top:2px}
  .mast-meta{font-size:11.5px;color:var(--ink-3);margin-top:2px}
  .runline{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;
    font-size:12.5px;color:var(--ink-2);margin-top:14px}
  .runline b{font-weight:600;color:var(--ink)}

  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:20px 0 4px}
  .stat{padding:14px 16px 13px;border-radius:10px;border-left:4px solid var(--ink-3)}
  .s-ok{background:var(--band-ok);border-left-color:var(--green)}
  .s-info{background:var(--band-info);border-left-color:var(--blue)}
  .s-warn{background:var(--band-warn);border-left-color:var(--amber)}
  .s-bad{background:var(--band-bad);border-left-color:var(--red)}
  .stat-n{font-size:27px;font-weight:800;letter-spacing:-.02em;line-height:1}
  .stat-l{font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
    color:var(--ink-2);margin-top:6px}

  table{border-collapse:collapse;width:100%;font-size:13px;margin:12px 0 6px}
  th{font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;
    color:var(--ink-2);text-align:left;padding:0 14px 8px 0;vertical-align:bottom;
    border-bottom:1px solid var(--rule)}
  th.n,td.n{text-align:right;padding-right:14px}
  th:last-child,td:last-child{padding-right:0}
  td{border-top:1px solid var(--rule-2);padding:9px 14px 9px 0;vertical-align:top}
  td.mono,.mono{font-family:'IBM Plex Mono',monospace;font-size:12.5px}
  tbody tr:nth-child(even) td{background:rgba(0,0,0,.014)}

  .pill{display:inline-block;font-size:10.5px;padding:3px 9px;border-radius:11px;font-weight:600}
  .p-ok{background:var(--band-ok);color:#0F6E56}
  .p-warn{background:var(--band-warn);color:#854F0B}
  .p-bad{background:var(--band-bad);color:#A32D2D}
  .p-info{background:var(--band-info);color:#185FA5}
  .p-mute{background:#EFEDE7;color:var(--ink-2)}

  .who{font-size:12px;color:var(--ink-2);margin-top:3px}
  .who b{font-weight:600;color:var(--ink)}
  .moved{font-size:12px;color:#854F0B;background:var(--band-warn);
    display:inline-block;padding:2px 8px;border-radius:6px;margin-top:5px}
  .locked{font-size:12px;color:#A32D2D;background:var(--band-bad);
    display:inline-block;padding:2px 8px;border-radius:6px;margin-top:5px}

  .gantt{margin:14px 0 8px;border:1px solid var(--rule-2);border-radius:10px;padding:14px 16px;
    background:#fff}
  .gscale{display:flex;justify-content:space-between;font-size:10.5px;color:var(--ink-3);
    border-bottom:1px solid var(--rule-2);padding-bottom:5px;margin-bottom:8px;
    font-family:'IBM Plex Mono',monospace}
  .grow{display:grid;grid-template-columns:190px 1fr;align-items:center;gap:10px;min-height:26px}
  .gl{font-size:11.5px;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .gl b{font-weight:600;color:var(--ink)}
  .gt{position:relative;height:18px}
  .gbar{position:absolute;height:18px;border-radius:4px}
  .gtoday{position:absolute;top:0;bottom:0;width:1px;background:var(--ink-3)}
  .gsec{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
    color:var(--ink-3);margin:12px 0 4px}
  .glegend{display:flex;gap:16px;flex-wrap:wrap;font-size:11.5px;color:var(--ink-2);
    margin-top:10px;padding-top:9px;border-top:1px solid var(--rule-2)}
  .glegend i{display:inline-block;width:11px;height:11px;border-radius:3px;
    vertical-align:-1px;margin-right:5px}

  .written{border-left:4px solid var(--brand);background:#F3FAF7;
    padding:12px 16px;border-radius:0 8px 8px 0;margin:10px 0 16px}
  .written p{margin:0;max-width:none}
  .blank{border:1px dashed var(--rule);border-radius:8px;padding:18px 20px;
    color:var(--ink-3);background:#fff}
  .empty{color:var(--ink-3);font-style:italic}
  .foot{margin-top:44px;padding-top:14px;border-top:1px solid var(--rule);
    font-size:12px;color:var(--ink-3)}

  @media print{
    body{background:#fff}
    .sheet{margin:0;box-shadow:none;max-width:none;padding:26px 30px}
    h2{page-break-after:avoid}
    tr,.gantt,.written{page-break-inside:avoid}
    .noprint{display:none}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
  .noprint{position:sticky;top:0;z-index:9;background:var(--ink);color:#fff;
    padding:10px 16px;font-family:system-ui,sans-serif;font-size:13px;display:flex;
    gap:12px;align-items:center;justify-content:space-between}
  .noprint button{font:inherit;background:var(--brand);color:#fff;border:0;
    border-radius:6px;padding:7px 15px;cursor:pointer;font-weight:600}
`

const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;' }[c]))
const D = s => (s ? new Date(s + 'T00:00:00') : null)
const fmt = d => d ? d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '—'
const fmtShort = d => d ? d.toLocaleDateString('en-GB', { day:'numeric', month:'short' }) : '—'
const DONE = ['approved', 'completed']
const isDone = t => DONE.includes(t.status)
const dayDiff = (a, b) => Math.round((a - b) / 86400000)

// A rate over a handful of tasks is noise dressed as analysis. Below
// this the report shows the pair and lets the reader judge — the same
// reasoning as the board report's guard on percentages against a tiny
// base.
const RATE_FLOOR = 5

export async function openProjectReport(o) {
  const { projectId, orgName = '', periodFrom = null, periodTo = null,
          user = null, saved = null, replayHtml = null } = o

  // A filed report reopens from what was stored, not from today's data.
  // Nothing is recomputed here, so nothing can differ from the document
  // that was filed.
  if (replayHtml) {
    const rw = window.open('', '_blank')
    if (!rw) throw new Error('The report window was blocked. Allow pop-ups for this site and try again.')
    rw.document.write(replayHtml)
    rw.document.close()
    return null
  }

  const to = periodTo || new Date().toISOString().slice(0, 10)
  const from = periodFrom || null
  const periodLabel = from ? `${fmt(D(from))} to ${fmt(D(to))}` : `Up to ${fmt(D(to))}`

  const [{ data: project }, { data: sections }, { data: tasks },
         { data: ms }, { data: deps }, { data: events }, { data: reports },
         { data: org }] =
    await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase.from('project_sections').select('id,parent_id,name,sort_order')
        .eq('project_id', projectId).order('sort_order'),
      supabase.from('tasks')
        .select('id,title,status,due_date,completed_at,section_id,team_id,team_name,milestone_id,blocks_milestone,assigned_user_names,assigned_user_name,approver_name,due_date_locked,due_date_lock_reason')
        .eq('project_id', projectId),
      supabase.from('project_milestone_state').select('*')
        .eq('project_id', projectId).order('due_date'),
      supabase.from('task_dependencies')
        .select('predecessor_section_id,successor_section_id,gap_days,match_by_team')
        .eq('project_id', projectId),
      supabase.from('project_schedule_events')
        .select('task_id,section_id,kind,old_due_date,new_due_date,delta_days,caused_by_section_id,note,created_at')
        .eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_reports')
        .select('period_label,created_at,created_by_name')
        .eq('project_id', projectId).order('created_at', { ascending: false }).limit(5),
      // The logo is stored as a data URI, which embeds without a session
      // and does not expire. address and website give the masthead the
      // rest of a letterhead where an organisation has filled them in.
      supabase.from('organisations')
        .select('name,logo,website,address_city,address_state')
        .eq('id', (await supabase.from('projects').select('org')
          .eq('id', projectId).single()).data?.org || '').maybeSingle()
    ])

  if (!project) throw new Error('Project not found.')

  const T = tasks || [], S = sections || [], M = ms || [], E = events || []
  const nameOf = id => S.find(s => s.id === id)?.name || '—'
  const stages = S.filter(s => s.parent_id).sort((a, b) => a.sort_order - b.sort_order)
  const tops = S.filter(s => !s.parent_id).sort((a, b) => a.sort_order - b.sort_order)

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const done = T.filter(isDone)
  const open = T.filter(t => !isDone(t))
  const overdue = open.filter(t => D(t.due_date) && D(t.due_date) < today)
  const blockers = T.filter(t => t.blocks_milestone && !isDone(t))

  const moved = {}
  E.forEach(e => { if (e.task_id && !moved[e.task_id]) moved[e.task_id] = e })
  const shifts = Object.values(moved).filter(e => e.kind === 'shift')
  const blocked = Object.values(moved).filter(e => e.kind === 'blocked')
  const worstSlip = shifts.reduce((m, e) => Math.max(m, e.delta_days || 0), 0)

  const causeTally = {}
  shifts.forEach(e => {
    if (!e.caused_by_section_id) return
    causeTally[e.caused_by_section_id] = (causeTally[e.caused_by_section_id] || 0) + (e.delta_days || 0)
  })
  const causes = Object.entries(causeTally)
    .map(([id, d]) => ({ name: nameOf(id), days: d }))
    .sort((a, b) => b.days - a.days)

  const teamTally = {}
  T.forEach(t => {
    const k = t.team_name || 'Unassigned'
    const e = teamTally[k] || (teamTally[k] =
      { total: 0, done: 0, late: 0, lateDays: 0, worst: 0, overdue: 0, open: 0, id: t.team_id })
    e.total++
    if (isDone(t)) {
      e.done++
      // A day's grace: finishing on the due date is on time, and a
      // timestamp a few hours past midnight is not a missed deadline.
      if (t.completed_at && D(t.due_date)) {
        const over = Math.floor(
          (new Date(t.completed_at) - new Date(D(t.due_date).getTime() + 864e5)) / 864e5)
        if (over > 0) { e.late++; e.lateDays += over; e.worst = Math.max(e.worst, over) }
      }
    } else {
      e.open++
      if (D(t.due_date) && D(t.due_date) < today) e.overdue++
    }
  })
  const teams = Object.entries(teamTally).sort((a, b) => b[1].total - a[1].total)

  const pct = (a, b) => b ? Math.round((a / b) * 100) : 0

  const snapshot = {
    tasks_total: T.length, tasks_done: done.length, tasks_overdue: overdue.length,
    stages: stages.length, milestones_total: M.length,
    milestones_met: M.filter(m => m.status === 'met').length,
    blockers_open: blockers.length, dates_moved: shifts.length,
    worst_slip_days: worstSlip, locked_at_risk: blocked.length,
    period_from: from, period_to: to
  }

  const H = []
  const P = x => H.push(x)

  P(`<div class="noprint"><span>${esc(project.ref)} — ${esc(project.name)}</span>
     <span><button onclick="window.print()">Print or save as PDF</button></span></div>`)
  P('<div class="sheet">')

  const logo = org?.logo && String(org.logo).startsWith('data:') ? org.logo : null
  const place = [org?.address_city, org?.address_state].filter(Boolean).join(', ')

  P(`<div class="masthead">
       <div class="mast-top">
         ${logo ? `<img class="mast-logo" src="${logo}" alt="${esc(org?.name || orgName)}">` : ''}
         <div class="mast-org">
           <div class="eyebrow">Project report</div>
           ${logo ? '' : `<div class="mast-name">${esc(org?.name || orgName)}</div>`}
           ${place || org?.website
             ? `<div class="mast-meta">${esc(place)}${
                 place && org?.website ? ' · ' : ''}${esc(org?.website || '')}</div>` : ''}
         </div>
       </div>
       <h1>${esc(project.name)}</h1>
       <div class="lede">${esc(project.description || '')}</div>
       <div class="runline">
         <span><b>${esc(project.ref)}</b></span>
         <span>Period: <b>${esc(periodLabel)}</b></span>
         <span>Status: <b>${esc(project.status)}</b></span>
         <span>Produced <b>${new Date().toLocaleDateString('en-GB')}</b>${
           user?.name ? ` by <b>${esc(user.name)}</b>` : ''}</span>
       </div>
     </div>`)

  // ---- Executive summary --------------------------------------------
  P('<h2>Executive summary</h2>')
  const statClass = (bad, warn) => bad ? 's-bad' : warn ? 's-warn' : 's-ok'
  P(`<div class="stats">
      <div class="stat ${done.length === T.length && T.length ? 's-ok' : 's-info'}">
        <div class="stat-n">${done.length}/${T.length}</div>
        <div class="stat-l">Tasks approved</div></div>
      <div class="stat ${statClass(false, M.filter(m => m.status === 'open').length)}">
        <div class="stat-n">${snapshot.milestones_met}/${M.length}</div>
        <div class="stat-l">Milestones met</div></div>
      <div class="stat ${statClass(overdue.length, false)}">
        <div class="stat-n">${overdue.length}</div>
        <div class="stat-l">Overdue</div></div>
      <div class="stat ${statClass(blocked.length, worstSlip)}">
        <div class="stat-n">${worstSlip}</div>
        <div class="stat-l">Worst slip, days</div></div>
     </div>`)

  const lines = []
  lines.push(`${done.length} of ${T.length} tasks are approved across ${stages.length} stage${
    stages.length !== 1 ? 's' : ''}${T.length ? `, ${pct(done.length, T.length)} per cent of the plan` : ''}.`)
  lines.push(overdue.length
    ? `${overdue.length} task${overdue.length > 1 ? 's are' : ' is'} past ${
        overdue.length > 1 ? 'their' : 'its'} due date.`
    : 'Nothing is overdue.')
  if (shifts.length) {
    lines.push(`${shifts.length} date${shifts.length > 1 ? 's have' : ' has'} moved as work shifted, the largest by ${worstSlip} days${
      causes.length ? `, driven mainly by ${causes[0].name}` : ''}.`)
  }
  if (blocked.length) {
    lines.push(`${blocked.length} date${blocked.length > 1 ? 's are' : ' is'} locked and could not move, so ${
      blocked.length > 1 ? 'they are' : 'it is'} now at risk.`)
  }
  if (blockers.length) {
    lines.push(`${blockers.length} open item${blockers.length > 1 ? 's are' : ' is'} holding a milestone.`)
  }
  const openGates = M.filter(m => m.status === 'open').length
  if (M.length) {
    lines.push(openGates
      ? `${openGates} of ${M.length} milestone${M.length > 1 ? 's remain' : ' remains'} open, so the project cannot yet be signed off.`
      : 'Every milestone has been met.')
  }
  P(`<p class="summary">${esc(lines.join(' '))}</p>`)

  // ---- Timeline ------------------------------------------------------
  // The picture people actually want. Bars are positioned across the
  // project's own span, one row per stage per team, coloured by team so
  // a team can be followed down the page.
  const dated = T.map(t => D(t.due_date)).filter(Boolean)
  if (dated.length) {
    let lo = new Date(Math.min(...dated, today))
    let hi = new Date(Math.max(...dated, today))
    lo.setDate(lo.getDate() - 4); hi.setDate(hi.getDate() + 4)
    const span = Math.max(dayDiff(hi, lo), 1)
    const pos = d => (dayDiff(d, lo) / span) * 100

    P('<h2>Timeline</h2>')
    P('<div class="gantt">')
    P(`<div class="gscale"><span>${fmtShort(lo)}</span><span>${fmtShort(hi)}</span></div>`)
    P(`<div style="position:relative">`)

    tops.forEach(top => {
      const kids = stages.filter(s => s.parent_id === top.id)
      if (!kids.length) return
      P(`<div class="gsec">${esc(top.name)}</div>`)
      kids.forEach(stage => {
        // Attachments are excluded from the geometry: unplanned work
        // hanging off a milestone should not stretch a bar that says
        // when a team is on site.
        const rows = T.filter(t => t.section_id === stage.id && !t.blocks_milestone)
        if (!rows.length) return
        const byTeam = {}
        rows.forEach(t => (byTeam[t.team_id || '_'] = byTeam[t.team_id || '_'] || []).push(t))
        Object.entries(byTeam).forEach(([k, ts], i) => {
          const ds = ts.map(t => D(t.due_date)).filter(Boolean)
          if (!ds.length) return
          let a = new Date(Math.min(...ds)); const b = new Date(Math.max(...ds))
          if (dayDiff(b, a) < 2) a = new Date(a.getTime() - 2 * 864e5)
          const left = pos(a), width = Math.max(pos(b) - left, 2)
          const col = teamColour(k)
          const allDone = ts.every(isDone)
          const late = ts.some(t => !isDone(t) && D(t.due_date) < today)
          const lock = ts.some(t => t.due_date_locked)
          P(`<div class="grow">
              <div class="gl">${i === 0 ? `<b>${esc(stage.name)}</b> · ` : ''}${
                esc(ts[0].team_name || 'Unassigned')}</div>
              <div class="gt">
                <div class="gbar" style="left:${left}%;width:${width}%;
                  background:${allDone ? col.solid : col.faded};
                  ${late ? 'border-left:3px solid #EF4444;' : ''}
                  ${lock ? 'border-left:3px solid #1A2033;' : ''}"></div>
              </div>
            </div>`)
        })
      })
    })

    P(`<div class="gtoday" style="left:calc(190px + 10px + ${pos(today)}%*(100% - 200px)/100%)"></div>`)
    P('</div>')

    const legend = teams.map(([name, e]) =>
      `<span><i style="background:${teamColour(e.id).solid}"></i>${esc(name)}</span>`).join('')
    P(`<div class="glegend">${legend}
        <span><i style="background:#CBD5E1"></i>faded = still open</span>
        <span><i style="background:#EF4444;width:4px;border-radius:1px"></i>overdue</span>
        <span><i style="background:#1A2033;width:4px;border-radius:1px"></i>date locked</span>
      </div>`)
    P('</div>')
  }

  // ---- Stage by stage ------------------------------------------------
  P('<h2>Stage by stage</h2>')
  if (!stages.length) P('<p class="empty">No stages have been created for this project.</p>')

  // Sections and stages with no tasks are left out. On screen an empty
  // stage needs its card so there is somewhere to press "+ Add task";
  // a printed report has no buttons, so it is only furniture. Counted
  // below rather than silently dropped.
  let emptyStages = 0
  let emptySections = 0

  tops.forEach(top => {
    const kids = stages.filter(s => s.parent_id === top.id)
    if (!kids.length) return

    const filled = kids.filter(stage => T.some(t => t.section_id === stage.id))
    emptyStages += kids.length - filled.length
    if (!filled.length) { emptySections++; return }

    P(`<h3>${esc(top.name)}</h3>`)
    P('<table><thead><tr><th>Stage</th><th>Team</th><th>Task</th><th>Due</th><th>State</th></tr></thead><tbody>')
    filled.forEach(stage => {
      const rows = T.filter(t => t.section_id === stage.id)
        .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
      const preds = (deps || []).filter(d => d.successor_section_id === stage.id)
        .map(d => nameOf(d.predecessor_section_id))
      rows.forEach((t, i) => {
        const ev = moved[t.id]
        const late = !isDone(t) && D(t.due_date) && D(t.due_date) < today
        const state = isDone(t) ? '<span class="pill p-ok">Approved</span>'
          : late ? '<span class="pill p-bad">Overdue</span>'
          : t.status === 'awaiting_review' ? '<span class="pill p-info">With approver</span>'
          : t.status === 'in_progress' ? '<span class="pill p-warn">In progress</span>'
          : '<span class="pill p-mute">Not started</span>'
        const who = (t.assigned_user_names && t.assigned_user_names[0]) || t.assigned_user_name
        const dot = t.team_id
          ? `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;
              background:${teamColour(t.team_id).solid};margin-right:6px"></span>` : ''
        P(`<tr>
            <td>${i === 0 ? `<b>${esc(stage.name)}</b>` + (preds.length
              ? `<div class="note">after ${esc(preds.join(' and '))}</div>` : '') : ''}</td>
            <td>${dot}${esc(t.team_name || '—')}</td>
            <td>${t.due_date_locked ? '&#128274; ' : ''}${t.blocks_milestone ? '&#9873; ' : ''}${esc(t.title)}
              <div class="who">Assigned to: <b>${esc(who || 'nobody')}</b>${
                t.approver_name ? ` · Approver: <b>${esc(t.approver_name)}</b>` : ''}</div>
              ${ev && ev.kind === 'shift'
                ? `<div class="moved">Moved ${ev.delta_days} days from ${fmt(D(ev.old_due_date))}${
                    ev.caused_by_section_id ? ` because ${esc(nameOf(ev.caused_by_section_id))} ran late` : ''}</div>` : ''}
              ${ev && ev.kind === 'blocked' ? `<div class="locked">${esc(ev.note || '')}</div>` : ''}
              ${t.due_date_locked && t.due_date_lock_reason
                ? `<div class="note">${esc(t.due_date_lock_reason)}</div>` : ''}
            </td>
            <td class="mono">${fmt(D(t.due_date))}</td>
            <td>${state}</td>
          </tr>`)
      })
    })
    P('</tbody></table>')
  })

  if (emptyStages || emptySections) {
    const bits = []
    if (emptySections) bits.push(`${emptySections} section${emptySections > 1 ? 's' : ''}`)
    if (emptyStages) bits.push(`${emptyStages} stage${emptyStages > 1 ? 's' : ''}`)
    P(`<p class="wide note">${bits.join(' and ')} ${
      (emptySections + emptyStages) > 1 ? 'hold' : 'holds'} no tasks and ${
      (emptySections + emptyStages) > 1 ? 'are' : 'is'} not shown. They exist in the
      plan but have nothing scheduled against them yet.</p>`)
  }

  // ---- Milestones -----------------------------------------------------
  P('<h2>Milestones</h2>')
  if (!M.length) {
    P('<p class="empty">No milestones have been set for this project.</p>')
  } else {
    P('<table><thead><tr><th>Milestone</th><th>Date</th><th class="n">Tasks</th><th>State</th></tr></thead><tbody>')
    M.forEach(m => {
      const state = m.status === 'met'
        ? `<span class="pill p-ok">Met</span>${m.met_at
            ? `<div class="note">${new Date(m.met_at).toLocaleDateString('en-GB')}</div>` : ''}`
        : m.at_risk ? `<span class="pill p-bad">At risk</span><div class="note">Open work runs to ${fmt(D(m.latest_open_due))}</div>`
        : m.blockers_open ? `<span class="pill p-warn">${m.blockers_open} blocker${m.blockers_open > 1 ? 's' : ''}</span>`
        : m.ready_to_meet ? '<span class="pill p-info">Ready to meet</span>'
        : `<span class="pill p-mute">${m.tasks_open} open</span>`
      P(`<tr>
          <td>${m.date_locked ? '&#128274; ' : ''}<b>${esc(m.name)}</b>${
            m.date_locked ? '<div class="note">Cannot be rescheduled</div>' : ''}</td>
          <td class="mono">${fmt(D(m.due_date))}</td>
          <td class="n mono">${m.tasks_done}/${m.task_count}</td>
          <td>${state}</td>
        </tr>`)
    })
    P('</tbody></table>')
  }

  // ---- What moved ------------------------------------------------------
  P('<h2>What moved, and why</h2>')
  if (!shifts.length && !blocked.length) {
    P('<p class="empty">No dates have been moved by the dependency chain.</p>')
  } else {
    P(`<p class="wide note">Every date change made by the schedule is recorded with
       its cause at the time it happened. This section is that record, not a
       reconstruction.</p>`)
    P('<table><thead><tr><th>Task</th><th>Original date</th><th>New date</th><th class="n">Days later</th><th>Caused by</th></tr></thead><tbody>')
    Object.values(moved)
      .filter(e => e.kind === 'shift' || e.kind === 'blocked')
      .sort((a, b) => (b.delta_days || 0) - (a.delta_days || 0))
      .forEach(e => {
        const t = T.find(x => x.id === e.task_id)
        P(`<tr>
            <td><b>${esc(t?.title || e.task_id)}</b>${t?.team_name
              ? `<div class="note">${esc(t.team_name)}</div>` : ''}</td>
            <td class="mono">${fmt(D(e.old_due_date))}</td>
            <td class="mono">${e.kind === 'blocked'
              ? '<span class="pill p-bad">Held</span>' : fmt(D(e.new_due_date))}</td>
            <td class="n mono">${e.kind === 'blocked' ? '—' : '+' + e.delta_days}</td>
            <td>${e.kind === 'blocked'
              ? esc(e.note || 'Date is locked')
              : esc(e.caused_by_section_id ? nameOf(e.caused_by_section_id) : '—')}</td>
          </tr>`)
      })
    P('</tbody></table>')
  }

  // ---- Patterns ---------------------------------------------------------
  P('<h2>Patterns</h2>')
  P(`<p class="wide note">Counted, not judged. These are the figures; what they
     mean is the writer's conclusion below.</p>`)

  P('<h4>By team</h4>')
  P('<table><thead><tr><th>Team</th><th class="n">Total</th><th class="n">Approved</th>'
    + '<th class="n">Open</th><th class="n">Overdue now</th><th class="n">On time</th>'
    + '<th class="n">Late</th><th class="n">Average days late</th></tr></thead><tbody>')
  teams.forEach(([name, e]) => {
    const rate = e.done >= RATE_FLOOR ? `${pct(e.done - e.late, e.done)}%`
      : e.done ? `${e.done - e.late} of ${e.done}` : '—'
    const avg = e.late ? Math.round(e.lateDays / e.late) : 0
    P(`<tr>
        <td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;
          background:${teamColour(e.id).solid};margin-right:7px"></span>${esc(name)}</td>
        <td class="n mono">${e.total}</td>
        <td class="n mono">${e.done}</td>
        <td class="n mono">${e.open}</td>
        <td class="n mono" ${e.overdue ? 'style="color:#A32D2D"' : ''}>${e.overdue || '—'}</td>
        <td class="n mono">${rate}</td>
        <td class="n mono" ${e.late ? 'style="color:#854F0B"' : ''}>${e.late || '—'}</td>
        <td class="n mono" ${e.late ? 'style="color:#854F0B"' : ''}>${
          e.late ? avg + (e.worst > avg ? ` (worst ${e.worst})` : '') : '—'}</td>
      </tr>`)
  })
  P('</tbody></table>')
  P(`<p class="wide note">"Late" counts work that was finished after its due date;
     the average is over those tasks only, so one badly overdue item does not hide
     behind a column of on-time ones. "Overdue now" is open work already past its
     date — it has not been finished late yet, but it will be.</p>`)
  if (teams.some(([, e]) => e.done > 0 && e.done < RATE_FLOOR)) {
    P(`<p class="wide note">Where a team has completed fewer than ${RATE_FLOOR} tasks,
       the count is shown instead of a rate. A percentage over three tasks reads as
       precision the numbers do not carry.</p>`)
  }

  if (causes.length) {
    P('<h4>Where the delay came from</h4>')
    P('<table><thead><tr><th>Stage</th><th class="n">Days pushed downstream</th></tr></thead><tbody>')
    causes.forEach(c => P(`<tr><td><b>${esc(c.name)}</b></td><td class="n mono">${c.days}</td></tr>`))
    P('</tbody></table>')
    P(`<p class="wide note">Days pushed downstream is the total delay this stage
       caused elsewhere — the sum of every date that moved because it ran late. It
       is not how late the stage itself was.</p>`)
  }

  // ---- Conclusion --------------------------------------------------------
  P('<h2>Conclusion and next steps</h2>')
  const anyWritten = saved && (saved.conclusion || saved.strengths || saved.weaknesses || saved.next_steps)
  if (anyWritten) {
    const block = (h, v) => v
      ? `<h4>${h}</h4><div class="written"><p>${esc(v).replace(/\n/g, '<br>')}</p></div>` : ''
    P(block('Assessment', saved.conclusion))
    P(block('What went well', saved.strengths))
    P(block('What did not', saved.weaknesses))
    P(block('How to structure what comes next', saved.next_steps))
    P(`<p class="note">Written by ${esc(saved.created_by_name || '—')} on ${
      new Date(saved.created_at || Date.now()).toLocaleDateString('en-GB')}.</p>`)
  } else {
    P(`<div class="blank">
        <b style="font-family:'Bricolage Grotesque',system-ui,sans-serif;color:#A32D2D">
          &#9888; Not yet written — required before this report is filed</b>
        <p style="margin:8px 0 0;color:#8A94A6;max-width:none">
          The figures above are counted from the record. The assessment — what went
          well, what did not, and how to structure what comes next — is a judgement,
          and belongs to a person with their name against it. Write it in the report
          panel on the project page.
        </p>
      </div>`)
  }

  if (reports && reports.length) {
    P('<h4>Earlier reports</h4>')
    P('<p class="wide note">' + reports.map(r =>
      `${esc(r.period_label)} — ${esc(r.created_by_name || '—')}, ${
        new Date(r.created_at).toLocaleDateString('en-GB')}`).join('<br>') + '</p>')
  }

  P(`<div class="foot">
      ${esc(project.ref)} · ${esc(orgName)} · produced ${new Date().toLocaleString('en-GB')}.
      Figures are counted from the project record at the time of production; a
      report run later over the same period will differ, because the work will have
      moved on.
     </div>`)
  P('</div>')

  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>${esc(project.ref)} — ${esc(project.name)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700;800&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
    <style>${CSS}</style></head><body>${H.join('')}</body></html>`

  const w = window.open('', '_blank')
  if (!w) throw new Error('The report window was blocked. Allow pop-ups for this site and try again.')
  w.document.write(doc)
  w.document.close()

  // The caller stores html alongside snapshot, so the filed figures are
  // exactly the ones the document showed rather than a second count.
  return { snapshot, html: doc }
}
