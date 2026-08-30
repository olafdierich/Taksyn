// Board report — a monthly governance document, rendered as HTML and printed
// from the browser.
//
// Deliberately NOT jsPDF. exportTrendPDF places every element by coordinate,
// which is how axisBlock came to draw rows off the bottom of a page unnoticed
// for weeks. Shaded grids and 5x5 risk matrices placed that way would be
// worse. A browser paginates; jsPDF does not.
//
// Takes everything it needs as arguments. It reads no state and imports
// nothing from App.jsx, so the two documents cannot drift apart by one of them
// quietly recomputing a figure the other took from somewhere else.

const CSS = `
  :root{
    --paper:#FBFAF7; --ink:#151E2D; --ink-2:#4A5568; --ink-3:#8A94A6;
    --rule:#D8D4CB; --rule-2:#EDEAE3;
    --band-0:#FFF; --band-1:#EAF2EE; --band-2:#FDF3D4;
    --band-3:#FBDFC3; --band-4:#F7C7C4; --band-5:#E2D3EC;
    --accent:#1F5E58; --flag:#A3341F; --good:#2E6B4F;
  }
  *{box-sizing:border-box}
  body{margin:0;background:#E9E6DF;color:var(--ink);
    font-family:'Source Serif 4',Georgia,serif;font-size:15px;line-height:1.55;
    font-variant-numeric:tabular-nums}
  .sheet{max-width:880px;margin:24px auto;background:var(--paper);padding:52px 56px 60px;
    box-shadow:0 1px 3px rgba(20,30,45,.1),0 12px 40px rgba(20,30,45,.06)}
  h1,h2,h3,h4,.eyebrow,.stat-n,th,.delta,.mx-l,.sub-head b{
    font-family:'Bricolage Grotesque',system-ui,sans-serif}
  h1{font-size:42px;line-height:1.02;font-weight:800;letter-spacing:-.022em;margin:.28em 0 .34em}
  h2{font-size:21px;font-weight:700;letter-spacing:-.012em;margin:48px 0 6px;
    padding-bottom:9px;border-bottom:2px solid var(--ink)}
  h3{font-size:14px;font-weight:700;margin:0 0 5px}
  h4{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
    color:var(--ink-2);margin:22px 0 7px}
  p{margin:0 0 12px;max-width:68ch}
  .lede{font-size:17px;color:var(--ink-2)}
  .eyebrow{font-size:10.5px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:var(--accent)}
  .note{font-size:13px;color:var(--ink-2)}
  .masthead{border-bottom:3px solid var(--ink);padding-bottom:20px}
  .runline{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;
    font-size:12.5px;color:var(--ink-2);margin-top:14px}
  .runline b{font-weight:600;color:var(--ink)}
  table{border-collapse:collapse;width:100%;font-size:13px;margin:14px 0 6px}
  th{font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;
    color:var(--ink-2);text-align:center;padding:0 0 8px;vertical-align:bottom}
  th.cat{text-align:left;width:30%}
  th.sep,td.sep{border-left:1px solid var(--rule)}
  td{border-top:1px solid var(--rule-2);padding:0;text-align:center;height:32px}
  td.cat{text-align:left;padding:0 12px 0 2px;font-size:13.5px;white-space:nowrap;
    border-right:1px solid var(--rule)}
  td.tot{font-family:'IBM Plex Mono',monospace;font-weight:600;
    border-left:1px solid var(--rule);width:56px}
  td.trend{border-left:1px solid var(--rule);width:78px}
  th.yoy,td.yoy{border-right:2px solid var(--rule);width:56px;
    font-family:'IBM Plex Mono',monospace;color:var(--ink-3);background:#F5F3EE}
  .cell{display:block;height:32px;line-height:32px;font-family:'IBM Plex Mono',monospace;font-size:12.5px}
  .b0{background:var(--band-0);color:var(--ink-3)}.b1{background:var(--band-1)}
  .b2{background:var(--band-2)}.b3{background:var(--band-3)}
  .b4{background:var(--band-4)}.b5{background:var(--band-5)}
  .delta{font-size:11.5px;font-weight:600;white-space:nowrap}
  .up{color:var(--flag)}.down{color:var(--good)}.flat{color:var(--ink-3)}
  .key{display:flex;flex-wrap:wrap;border:1px solid var(--rule);margin:12px 0 2px}
  .key div{flex:1 1 0;min-width:88px;padding:6px 8px 7px;
    font-family:'Bricolage Grotesque',sans-serif;font-size:9.5px;font-weight:600;
    letter-spacing:.045em;text-transform:uppercase;border-right:1px solid var(--rule)}
  .key div:last-child{border-right:0}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(124px,1fr));
    border:1px solid var(--rule);margin:18px 0 6px}
  .stat{padding:13px 14px 14px;border-right:1px solid var(--rule)}
  .stat:last-child{border-right:0}
  .stat-n{font-size:30px;font-weight:800;letter-spacing:-.03em;line-height:1;display:block}
  .stat-l{font-size:10px;letter-spacing:.055em;text-transform:uppercase;color:var(--ink-2);
    margin-top:7px;display:block;font-family:'Bricolage Grotesque',sans-serif;font-weight:600}
  .stat-s{font-size:12px;color:var(--ink-3);margin-top:3px;display:block}
  .stat.alarm .stat-n{color:var(--flag)}
  .subs{border:1px solid var(--rule);margin:10px 0 18px}
  .sub-head{display:flex;justify-content:space-between;align-items:baseline;
    padding:9px 13px 8px;background:#F3F1EB;border-bottom:1px solid var(--rule)}
  .sub-head b{font-size:13.5px;font-weight:700;text-transform:capitalize}
  .sub-head span{font-size:12px;color:var(--ink-2)}
  .sub-row{display:grid;grid-template-columns:1fr 130px 40px;gap:10px;align-items:center;
    padding:5px 13px;border-bottom:1px solid var(--rule-2);font-size:13px}
  .sub-row:last-child{border-bottom:0}
  .sbar{height:10px;background:var(--rule-2);position:relative}
  .sbar span{position:absolute;inset:0 auto 0 0;background:var(--accent)}
  .sn{font-family:'IBM Plex Mono',monospace;font-size:12.5px;font-weight:600;text-align:right}
  .mx{display:grid;grid-template-columns:70px repeat(5,1fr);border:1px solid var(--rule);margin:10px 0 4px}
  .mx div{padding:8px 3px;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:12.5px;
    border-right:1px solid var(--rule-2);border-bottom:1px solid var(--rule-2)}
  .mx .mx-l{font-family:'Bricolage Grotesque',sans-serif;font-size:9px;font-weight:600;
    letter-spacing:.04em;text-transform:uppercase;color:var(--ink-2);background:#F3F1EB;
    display:flex;align-items:center;justify-content:center;line-height:1.2}
  .r-low{background:#E7F0E9}.r-mod{background:#FDF3D4}
  .r-high{background:#FBDFC3}.r-ext{background:#F7C7C4}
  .r-none{background:#fff;color:var(--ink-3)}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:28px}
  .flagbox{border-left:4px solid var(--flag);background:#FCF3F1;padding:14px 17px 15px;margin:18px 0}
  .flagbox h3{color:var(--flag)}
  .goodbox{border-left:4px solid var(--good);background:#EFF5F1;padding:14px 17px 15px;margin:18px 0}
  .goodbox h3{color:var(--good)}
  .gapbox{border:1px dashed var(--ink-3);background:#F5F3EE;padding:14px 17px 15px;margin:16px 0}
  .gapbox h3{color:var(--ink-2)}
  .flagbox p,.goodbox p,.gapbox p{margin:0;font-size:14px}
  .foot{margin-top:48px;padding-top:15px;border-top:1px solid var(--rule);font-size:12px;color:var(--ink-3)}
  .noprint{border-left:3px solid var(--rule);padding-left:12px}
  .bar{position:sticky;top:0;z-index:5;display:flex;justify-content:flex-end;gap:8px;
    padding:10px 0 12px;margin:-52px -56px 18px;padding-right:56px;
    background:rgba(251,250,247,.94);backdrop-filter:blur(6px);
    border-bottom:1px solid var(--rule-2)}
  .bar button{font-family:'Bricolage Grotesque',system-ui,sans-serif;font-size:12px;
    font-weight:600;letter-spacing:.03em;padding:8px 15px;cursor:pointer;
    border:1px solid var(--ink);background:var(--ink);color:var(--paper);border-radius:2px}
  .bar button.ghost{background:transparent;color:var(--ink-2);border-color:var(--rule)}
  .bar button:hover{opacity:.85}
  .bar button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  @media(max-width:760px){ .bar{margin:-30px -20px 14px;padding-right:20px} }
  @media print{ .noprint{display:none} }
  @media print{
    body{background:#fff}
    .sheet{margin:0;padding:0;box-shadow:none;max-width:none}
    h2{break-after:avoid}
    .subs,.stats,table,.mx,.flagbox,.goodbox,.gapbox,.stat,.two{break-inside:avoid}
    /* auto-fit wraps the sixth card onto its own line inside the same box,
       leaving a large empty area beside it. Fix the column count at print. */
    .stats{grid-template-columns:repeat(6,1fr)}
    .stat{padding:10px 9px 11px}
    .stat-n{font-size:24px}
    .stat-l{font-size:8.5px;letter-spacing:.04em}
    .stat-s{font-size:10.5px}
    /* Browser headers and footers cannot be suppressed from CSS -- only from
       the print dialogue's "Headers and footers" tick. A larger top margin at
       least keeps them clear of the masthead. */
    @page{margin:18mm 16mm}
  }
`

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]))

export function openBoardReport(o) {
  const {
    orgName = '', incidents = [], months = [], inMonth,
    categoryLabels = {}, severityLabels = {}, periodLabel = '',
    excludedCount = 0, repeatPeople = 0, isLate = () => false,
    // Corrective actions and investigation findings for the whole org.
    // Filtered to each section's incidents below, so every service gets its
    // own figures without a second query.
    actions = [], findings = [], findingLabels = {},
    // IND: [[industry_id, name], ...] with the PRIMARY FIRST. Empty or a
    // single entry means the report is drawn exactly as it always was --
    // one pass, no headings.
    industries = [],
  } = o
  const last = months[months.length - 1] || { year: 0, month: 0, label: '' }
  const catLabel = k => categoryLabels[k] || k
  const band = (l,c) => { const r = l*c; return r>=15?'r-ext':r>=9?'r-high':r>=4?'r-mod':'r-low' }
  const d = (a,b) => a===b ? '<span class="delta flat">▬ 0</span>'
    : '<span class="delta '+(a>b?'up':'down')+'">'+(a>b?'▲ ':'▼ ')+Math.abs(a-b)+'</span>'

  // ONE report body, drawn from ONE list of incidents. Called once for the
  // whole organisation and then once per service. `orgWide` marks the
  // combined pass: figures the caller counted organisation-wide belong there
  // and nowhere else.
  const section = (source, orgWide) => {
    const H = []
    // Counted set: excluded reports are on the register but count in nothing.
    const inc = source.filter(i => !i.excluded_at &&
      months.some(m => inMonth(i, m.year, m.month)))
    const cur = inc.filter(i => inMonth(i, last.year, last.month))
    const prev = months.length > 1
      ? inc.filter(i => inMonth(i, months[months.length-2].year, months[months.length-2].month)) : []
    const catMap = {}
    inc.forEach(i => { catMap[i.category] = (catMap[i.category]||0) + 1 })
    const cats = Object.keys(catMap).sort((a,b) => catMap[b] - catMap[a])
    // Worst severity in the cell, not the count. One critical incident darkens a
    // cell more than nine minor ones -- a board reading a month should see what
    // could reach a regulator, not what has the biggest number.
    const cell = (c, m) => {
      const r = inc.filter(i => i.category === c && inMonth(i, m.year, m.month))
      return { n: r.length, worst: r.reduce((w,i) => Math.max(w, i.severity||0), 0) }
    }
    // Same month a year earlier, per category. Counted from ALL of this
    // section's incidents rather than the six-month set, since last year's
    // records fall outside it by definition. Excluded reports are dropped on
    // both sides so the comparison is counted the same way.
    const yoyCell = (c) => source.filter(i => !i.excluded_at &&
      i.category === c && inMonth(i, last.year - 1, last.month)).length
    // Current month against the MEAN of those before it. A single quiet month
    // distorts a month-on-month comparison; a running mean does not.
    const trend = (c) => {
      const now = cell(c, last).n
      const before = months.slice(0, -1).map(m => cell(c, m).n)
      const mean = before.reduce((a,b) => a+b, 0) / (before.length || 1)
      if (!mean) return now ? { t:'new', d:'up' } : { t:'—', d:'flat' }
      // A percentage against a tiny base overstates wildly: one incident in
      // the prior months gives a mean of 0.2, so ten this month reads as
      // 4900%. Arithmetically right, useless to a board, and a number like
      // that gets the whole report dismissed. Below a base worth a
      // percentage, show the raw pair and let the reader see the size of it.
      // Same reasoning as the rated.length >= 20 guard on the risk matrix.
      // Against the TOTAL of the prior months, not their mean. "10 vs 1"
      // is something a board can hold in its head; "10 vs 0.2" is not --
      // an average of a fifth of an incident per month is not how anyone
      // thinks about incidents.
      const total = before.reduce((a,b) => a+b, 0)
      if (mean < 2) return { t: now+' vs '+total,
                             d: now>mean?'up':(now<mean?'down':'flat') }
      const pct = Math.round((now - mean) / mean * 100)
      if (Math.abs(pct) < 25) return { t:'▬ '+Math.abs(pct)+'%', d:'flat' }
      return { t:(pct>0?'▲ ':'▼ ')+Math.abs(pct)+'%', d: pct>0?'up':'down' }
    }
    const rated = inc.filter(i => i.risk_likelihood && i.risk_consequence)
    const resid = inc.filter(i => i.residual_likelihood && i.residual_consequence)
    const mx = (rows, res) => {
      const out = ['<div class="mx"><div class="mx-l">Likelihood ↓<br>Conseq →</div>']
      ;[1,2,3,4,5].forEach(c => out.push('<div class="mx-l">'+c+'</div>'))
      ;[5,4,3,2,1].forEach(l => {
        out.push('<div class="mx-l">'+l+'</div>')
        ;[1,2,3,4,5].forEach(c => {
          const n = rows.filter(i =>
            (res ? i.residual_likelihood : i.risk_likelihood) === l &&
            (res ? i.residual_consequence : i.risk_consequence) === c).length
          out.push('<div class="'+(n?band(l,c):'r-none')+'">'+(n||'—')+'</div>')
        })
      })
      return out.join('') + '</div>'
    }
    const moved = inc.filter(i => i.risk_rating && i.residual_rating && i.residual_rating < i.risk_rating)
    const stuck = inc.filter(i => i.risk_rating && i.residual_rating && i.residual_rating >= i.risk_rating)
    const closeRows = [1,2,3,4,5].map(s => {
      const done = inc.filter(i => i.severity===s && i.status==='closed' && i.closed_at)
      const days = done.map(i => Math.max(0, Math.round(
        (new Date(i.closed_at) - new Date(i.occurred_at)) / 86400000))).sort((a,b) => a-b)
      const met = done.filter(i => !i.close_due_at || new Date(i.closed_at) <= new Date(i.close_due_at)).length
      return { s, n: done.length,
        median: days.length ? days[Math.floor(days.length/2)] : null,
        longest: days.length ? days[days.length-1] : null,
        met: done.length ? Math.round(met/done.length*100) : null }
    }).filter(r => r.n)
    // Where the open ones are sitting. Workflow order, not by count: the table
    // then reads as a pipeline rather than a ranking. Oldest matters more than
    // median -- a median of three days hides the one that has sat at Review for
    // five weeks, and that is the one holding the queue up.
    const WF = [['reported','Reported'],['assessing','Assessing'],
                ['investigating','Investigating'],['actions_open','Action'],
                ['review','Review']]
    const stuckRows = WF.map(([key,label]) => {
      const rows = inc.filter(i => i.status === key)
      const days = rows.map(i => Math.max(0, Math.round(
        (Date.now() - new Date(i.occurred_at)) / 86400000))).sort((a,b) => a-b)
      return { key, label, n: rows.length,
        median: days.length ? days[Math.floor(days.length/2)] : null,
        oldest: days.length ? days[days.length-1] : null,
        oldestRef: days.length
          ? (rows.slice().sort((a,b) => new Date(a.occurred_at) - new Date(b.occurred_at))[0] || {}).ref
          : null }
    }).filter(r => r.n)

    // Outcomes grouped by domain rather than by ladder: outcome_domain is on the
    // incident, whereas the ladder key needs the org's category pack.
    const byDomain = {}
    inc.forEach(i => (i.incident_outcomes || []).filter(x => !x.voided_at).forEach(x => {
      const dm = i.outcome_domain || 'other'
      byDomain[dm] = byDomain[dm] || {}
      byDomain[dm][x.outcome_label] = (byDomain[dm][x.outcome_label] || 0) + 1
    }))
    const notifReq = inc.filter(i => i.external_notification_required)
    const notifDone = notifReq.filter(i => i.notified_at)
    const admissions = inc.reduce((a,i) =>
      a + (i.incident_outcomes||[]).filter(x => !x.voided_at && x.outcome_key === 'hospital_admission').length, 0)
    const open = inc.filter(i => i.status !== 'closed').length
    const late = inc.filter(isLate).length
    const meanSev = cur.length
      ? (cur.reduce((a,i) => a + (i.severity||0), 0) / cur.length).toFixed(1) : '—'
    // Year-on-year. Counted from ALL of this section's incidents, not the
    // six-month window -- last year's records fall outside it by definition.
    const counted = source.filter(i => !i.excluded_at)
    const yoyMonth = counted.filter(i => inMonth(i, last.year - 1, last.month)).length
    const yoyWindow = counted.filter(i =>
      months.some(m => inMonth(i, m.year - 1, m.month))).length
    const yoyLabel = String(last.label).replace(/\d+$/, m => String(Number(m) - 1))

    H.push('<h2>Where the month sits</h2><div class="stats">')
    H.push('<div class="stat"><span class="stat-n">'+cur.length+'</span><span class="stat-l">Incidents</span><span class="stat-s">'+d(cur.length, prev.length)+' on last month</span></div>')
    H.push('<div class="stat"><span class="stat-n">'+yoyMonth+'</span><span class="stat-l">Same month<br>last year</span>'+'<span class="stat-s">'+esc(yoyLabel)+'</span></div>')
    H.push('<div class="stat"><span class="stat-n">'+meanSev+'</span><span class="stat-l">Mean severity</span><span class="stat-s">this month</span></div>')
    H.push('<div class="stat"><span class="stat-n">'+admissions+'</span><span class="stat-l">Hospital admissions</span><span class="stat-s">period total</span></div>')
    H.push('<div class="stat'+(notifReq.length>notifDone.length?' alarm':'')+'"><span class="stat-n">'+notifReq.length+'</span><span class="stat-l">Notifiable</span><span class="stat-s">'+(notifReq.length-notifDone.length)+' not yet notified</span></div>')
    H.push('<div class="stat'+(late?' alarm':'')+'"><span class="stat-n">'+late+'</span><span class="stat-l">Past target</span><span class="stat-s">'+open+' still open</span></div>')
    H.push('</div>')
    H.push('<h2>Category by month</h2>')
    H.push('<p>Each cell is shaded by the <em>worst severity recorded in it</em>, not by how many incidents it holds. One critical incident darkens a cell more than nine minor ones. The last column compares '+esc(last.label)+' against the months before it: a percentage where there is enough history to carry one, and otherwise the two counts side by side \u2014 this month against the total of the five before.</p>')
    H.push('<div class="key"><div class="b0">— none</div><div class="b1">1 minor</div><div class="b2">2 moderate</div><div class="b3">3 major</div><div class="b4">4 severe</div><div class="b5">5 critical</div></div>')
    H.push('<table><thead><tr><th class="cat">Category</th>')
    H.push('<th class="yoy">'+esc(yoyLabel)+'</th>')
    months.forEach(m => H.push('<th>'+esc(String(m.label).split(' ')[0])+'</th>'))
    H.push('<th class="sep">Total</th><th class="sep">vs before</th></tr></thead><tbody>')
    cats.forEach(c => {
      H.push('<tr><td class="cat">'+esc(catLabel(c))+'</td>')
      const y = yoyCell(c)
      H.push('<td class="yoy">'+(y||'—')+'</td>')
      months.forEach(m => { const x = cell(c,m)
        H.push('<td><span class="cell b'+x.worst+'">'+(x.n||'—')+'</span></td>') })
      const t = trend(c)
      H.push('<td class="tot">'+catMap[c]+'</td><td class="trend"><span class="delta '+t.d+'">'+t.t+'</span></td></tr>')
    })
    H.push('</tbody></table>')
    // Raw pair, not a percentage: with a small base month an arrow overstates.
    H.push('<p class="note"><b>'+inc.length+'</b> incidents across '+esc(periodLabel)
      +', against <b>'+yoyWindow+'</b> in the same six months a year earlier.</p>')
    H.push('<h2>Consequence, not just count</h2>')
    H.push('<p>Severity is recorded on every incident. Risk rating — likelihood by consequence — is recorded during investigation, and again after corrective actions as residual risk. The second number is the only evidence that anything worked.</p>')
    H.push('<h4>Severity mix, '+esc(last.label)+' against the months before it</h4>')
    H.push('<table><thead><tr><th class="cat">Severity</th><th>'+esc(String(last.label).split(' ')[0])+'</th><th>Prior mean</th><th class="sep">Share of month</th></tr></thead><tbody>')
    ;[1,2,3,4,5].forEach(s => {
      const n = cur.filter(i => i.severity===s).length
      const before = months.slice(0,-1).map(m => inc.filter(i => i.severity===s && inMonth(i,m.year,m.month)).length)
      const mean = (before.reduce((a,b)=>a+b,0) / (before.length||1)).toFixed(1)
      H.push('<tr><td class="cat">'+s+' · '+esc(severityLabels[s]||'')+'</td>')
      H.push('<td><span class="cell b'+(n?s:0)+'">'+(n||'—')+'</span></td>')
      H.push('<td class="tot">'+mean+'</td><td class="tot">'+(cur.length?Math.round(n/cur.length*100):0)+'%</td></tr>')
    })
    H.push('</tbody></table>')
    H.push('<h4>Risk rating completeness</h4>')
    H.push('<p class="note"><b>'+rated.length+' of '+inc.length+'</b> incidents carry a risk rating; <b>'+resid.length+'</b> carry a residual rating after corrective actions. Ratings are recorded during investigation, so an incident closed without one has none.</p>')
    // 20, not 5. A 25-cell matrix drawn from five incidents shows two
    // populated cells and reads as though risk is concentrated where it is
    // merely sparse -- the exact page the conditional exists to prevent.
    if (rated.length >= 20) {
      H.push('<div class="two"><div><h4>At assessment</h4>'+mx(rated,false)+'</div>')
      H.push('<div><h4>Residual after actions</h4>'+mx(resid,true)+'</div></div>')
      if (moved.length || stuck.length) {
        H.push('<div class="'+(stuck.length?'flagbox':'goodbox')+'"><h3>'+moved.length+' of '+(moved.length+stuck.length)+' rated incidents moved down at least one risk band</h3>')
        H.push('<p>'+(stuck.length
          ? stuck.length+' closed with residual risk no lower than assessed. A closure that changes nothing is worth a second look.'
          : 'Every rated incident reduced.')+'</p></div>')
      }
    } else {
      H.push('<div class="gapbox"><h3>Not enough rated incidents to plot a risk matrix</h3>')
      H.push('<p>With '+rated.length+' of '+inc.length+' rated, a 5×5 matrix would be mostly empty and would mislead. The completeness figure above is the finding.</p></div>')
    }
    H.push('<h2>What happened to people</h2>')
    H.push('<p>One incident can carry several outcomes, so these totals exceed the incident count by design.</p>')
    Object.keys(byDomain).sort().forEach(dom => {
      const rows = Object.entries(byDomain[dom]).sort((a,b) => b[1]-a[1])
      const max = rows[0] ? rows[0][1] : 1
      const domLabel = dom.charAt(0).toUpperCase() + dom.slice(1)
      H.push('<div class="subs"><div class="sub-head"><b>'+esc(domLabel)+'</b><span>'+rows.reduce((a,r)=>a+r[1],0)+' outcomes</span></div>')
      rows.forEach(([l,n]) => H.push('<div class="sub-row"><div>'+esc(l)+'</div><div class="sbar"><span style="width:'+Math.round(n/max*100)+'%"></span></div><div class="sn">'+n+'</div></div>'))
      H.push('</div>')
    })
    H.push('<h2>Notification, closure and timeliness</h2>')
    if (notifReq.length > notifDone.length) {
      const gap = notifReq.length - notifDone.length
      H.push('<div class="flagbox"><h3>'+gap+' notifiable incident'+(gap===1?'':'s')+' with no notification recorded</h3>')
      H.push('<p>'+notifReq.length+' incidents in this period require external notification. '+notifDone.length+' carry a body, a date and a reference.</p></div>')
    }
    if (closeRows.length) {
      H.push('<h4>Time to close, by severity</h4><table><thead><tr><th class="cat">Severity</th><th>Closed</th><th>Median days</th><th>Longest</th><th class="sep">Target met</th></tr></thead><tbody>')
      closeRows.forEach(r => H.push('<tr><td class="cat">'+r.s+' · '+esc(severityLabels[r.s]||'')+'</td><td class="tot">'+r.n+'</td><td class="tot">'+r.median+'</td><td class="tot">'+r.longest+'</td><td class="tot">'+r.met+'%</td></tr>'))
      H.push('</tbody></table>')
    }
    if (stuckRows.length) {
      H.push('<h4>Where the open incidents are sitting</h4>')
      H.push('<table><thead><tr><th class="cat">Stage</th><th>Open</th><th>Median days</th>'
        + '<th class="sep">Oldest</th></tr></thead><tbody>')
      stuckRows.forEach(r => {
        H.push('<tr><td class="cat">'+esc(r.label)+'</td><td class="tot">'+r.n+'</td>'
          + '<td class="tot">'+r.median+'</td>'
          + '<td class="tot">'+r.oldest+(r.oldestRef ? ' <span style="font-weight:400;color:var(--ink-3)">'+esc(r.oldestRef)+'</span>' : '')+'</td></tr>')
      })
      H.push('</tbody></table>')
      const worst = stuckRows.slice().sort((a,b) => (b.oldest||0)-(a.oldest||0))[0]
      if (worst && worst.oldest >= 21) {
        H.push('<div class="flagbox"><h3>The oldest open incident has been at '+esc(worst.label)
          +' for '+worst.oldest+' days</h3>')
        H.push('<p>'+(worst.oldestRef ? esc(worst.oldestRef)+'. ' : '')
          + 'An incident that has not moved in three weeks is waiting on something. '
          + 'What it is waiting on differs by stage \u2014 at Review it is usually a signature, '
          + 'earlier it is usually the work itself.</p></div>')
      }
    }
    H.push('<p class="note">An incident cannot appear here without a closure status: every incident holds one of six workflow states at all times.</p>')

    // ---- What was done about it -------------------------------------
    // Scoped to this section's incidents, so a service's actions belong to
    // that service. Void actions are excluded from every count and reported
    // separately: a voided action is a decision, not an outstanding job.
    const incIds = new Set(inc.map(i => i.id))
    const mine = actions.filter(a => incIds.has(a.incident_id))
    const voided = mine.filter(a => a.status === 'void').length
    const acts = mine.filter(a => a.status !== 'void')
    // Same closed set the register uses, so the two never disagree.
    const CLOSED = ['verified','done','completed']
    const actOpen = acts.filter(a => CLOSED.indexOf(a.status) === -1)
    const actOverdue = actOpen.filter(a => a.due_date && new Date(a.due_date) < new Date())
    const actClosed = acts.filter(a => CLOSED.indexOf(a.status) !== -1)
    const actVerified = acts.filter(a => a.status === 'verified' || a.verified_at)
    // effectiveness is free text: count that a review exists, never print it.
    const actEff = actClosed.filter(a => String(a.effectiveness || '').trim() !== '')
    const finds = findings.filter(f => incIds.has(f.incident_id))
    const rca = finds.filter(f => f.section === 'rca')
    const invest = finds.filter(f => f.section === 'investigation')
    const investDone = invest.filter(f => f.state === 'done').length
    const rcaLooked = rca.filter(f => f.state !== 'not_examined').length
    const contrib = {}
    rca.filter(f => f.state === 'contributing').forEach(f => {
      contrib[f.item_key] = (contrib[f.item_key] || 0) + 1
    })
    const contribRows = Object.entries(contrib).sort((a,b) => b[1]-a[1])

    H.push('<h2>What was done about it</h2>')
    H.push('<p>Corrective actions are raised during investigation and closed when the work is done. Closing one proves a task was ticked. An action <em>verified</em>, and then reviewed for effectiveness, is the only evidence that the incident is less likely to happen again.</p>')
    H.push('<div class="stats">')
    H.push('<div class="stat"><span class="stat-n">'+acts.length+'</span><span class="stat-l">Actions raised</span><span class="stat-s">'+(voided?voided+' voided, not counted':'in this period')+'</span></div>')
    H.push('<div class="stat"><span class="stat-n">'+actOpen.length+'</span><span class="stat-l">Still open</span><span class="stat-s">of '+acts.length+' raised</span></div>')
    H.push('<div class="stat'+(actOverdue.length?' alarm':'')+'"><span class="stat-n">'+actOverdue.length+'</span><span class="stat-l">Past their date</span><span class="stat-s">open, due date gone</span></div>')
    H.push('<div class="stat"><span class="stat-n">'+actClosed.length+'</span><span class="stat-l">Closed</span><span class="stat-s">'+actVerified.length+' verified</span></div>')
    H.push('<div class="stat'+(actClosed.length&&!actEff.length?' alarm':'')+'"><span class="stat-n">'+actEff.length+'</span><span class="stat-l">Effectiveness reviewed</span><span class="stat-s">of '+actClosed.length+' closed</span></div>')
    H.push('</div>')
    if (actOverdue.length) {
      H.push('<div class="flagbox"><h3>'+actOverdue.length+' corrective action'+(actOverdue.length===1?'':'s')+' past the date set for '+(actOverdue.length===1?'it':'them')+'</h3>')
      H.push('<p>An action with a date that has passed and no closure is the clearest signal in this report. '+actOpen.length+' of '+acts.length+' actions remain open.</p></div>')
    }
    if (actClosed.length && !actEff.length) {
      H.push('<div class="flagbox"><h3>No closed action has been reviewed for effectiveness</h3>')
      H.push('<p>'+actClosed.length+' action'+(actClosed.length===1?' was':'s were')+' closed in this period. Without an effectiveness review there is no record that any of them changed the conditions that produced the incident.</p></div>')
    }
    H.push('<h4>Investigation and root cause</h4>')
    if (!invest.length && !rca.length) {
      H.push('<div class="gapbox"><h3>No investigation or root cause work recorded</h3>')
      H.push('<p>Neither the investigation checklist nor the root cause list has been opened for the incidents in this period.</p></div>')
    } else {
      H.push('<p class="note"><b>'+investDone+' of '+invest.length+'</b> investigation items are marked done; <b>'+rcaLooked+' of '+rca.length+'</b> root cause items have been examined. An item never examined is not the same as one ruled out.</p>')
    }
    if (contribRows.length) {
      const cmax = contribRows[0][1]
      H.push('<h4>Contributing factors, most frequent first</h4>')
      H.push('<p>Counted from root cause items marked as contributing. A factor appearing across several incidents is the one worth acting on.</p>')
      H.push('<div class="subs"><div class="sub-head"><b>Recorded as contributing</b><span>'+contribRows.reduce((a,r)=>a+r[1],0)+' across '+contribRows.length+' factor'+(contribRows.length===1?'':'s')+'</span></div>')
      contribRows.forEach(([k,n]) => H.push('<div class="sub-row"><div>'+esc(findingLabels[k] || k)+'</div><div class="sbar"><span style="width:'+Math.round(n/cmax*100)+'%"></span></div><div class="sn">'+n+'</div></div>'))
      H.push('</div>')
    } else if (rca.length) {
      H.push('<div class="gapbox"><h3>No contributing factor has been recorded</h3>')
      H.push('<p>Of '+rca.length+' root cause items, '+rcaLooked+' have been examined and none marked as contributing. Until a cause is named, corrective actions have nothing to aim at.</p></div>')
    }
    // Counted organisation-wide by the caller, so it belongs to the combined
    // pass alone. Repeating the same figure under each service would read as
    // a per-service count and would be wrong.
    if (orgWide) {
      H.push('<h2>Repeat involvement</h2>')
      H.push('<p>'+repeatPeople+' '+(repeatPeople===1?'person appears':'people appear')+' in more than one incident this period. Matching is on the register entry, not typed initials. Counted across the whole organisation.</p>')
      H.push('<p class="note"><b>Names are deliberately absent.</b> This report gives a count, never a list. The register holds the names, access-logged, for anyone who needs to act on them.</p>')
    }
    return H.join('')
  }

  // IND: the primary is industries[0]. Incidents with no industry_id resolve
  // through the org's primary everywhere else in the product, so they are
  // counted there here too -- otherwise they would appear in the combined
  // total and in none of the sections, and the sections would not sum.
  const multi = industries.length > 1
  const primaryId = industries.length ? industries[0][0] : null
  const forIndustry = (id) => incidents.filter(i =>
    i.industry_id === id || (id === primaryId && !i.industry_id))

  const H = []
  H.push('<!DOCTYPE html><html lang="en-AU"><head><meta charset="utf-8">')
  H.push('<title>Trend analysis — '+esc(orgName)+' — '+esc(last.label)+'</title>')
  H.push('<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">')
  H.push('<style>'+CSS+'</style></head><body><div class="sheet">')
  // Before the masthead so it sticks to the top of the scroll, and marked
  // noprint so it does not appear on the page itself.
  H.push('<div class="bar noprint">'
    + '<button class="ghost" onclick="window.close()">Close</button>'
    + '<button onclick="window.print()">Save as PDF</button></div>')
  H.push('<header class="masthead"><div class="eyebrow">Incident intelligence · '+esc(orgName)+'</div>')
  H.push('<h1>Trend&nbsp;Analysis<br>'+esc(last.label)+'</h1>')
  H.push('<p class="lede">Drawn from the incident register. Every figure traces to a record.</p>')
  H.push('<div class="runline"><span>Period <b>'+esc(periodLabel)+'</b></span>')
  H.push('<span>Generated <b>'+new Date().toLocaleString('en-AU')+'</b></span>')
  H.push('<span><b>'+excludedCount+'</b> excluded reports omitted</span>')
  if (multi) H.push('<span>Services <b>'+esc(industries.map(x=>x[1]).join(' · '))+'</b></span>')
  H.push('</div></header>')

  // A single-service organisation gets exactly the report it always got:
  // one pass, no heading, nothing to say about services.
  if (!multi) {
    H.push(section(incidents, true))
  } else {
    // IND: print-color-adjust is not decoration. Browsers drop background
    // colours from printed pages by default, so without it this band prints
    // as grey text and the section divider disappears from the PDF -- which
    // is the copy that gets handed to a board or a regulator.
    const bandBase = 'margin:56px 0 16px;padding:22px 26px;background:#151E2D;color:#FBFAF7;'
      + 'border-left:8px solid #1F5E58;border-radius:4px;line-height:1.15;'
      + '-webkit-print-color-adjust:exact;print-color-adjust:exact'
    const sectionBand = (eyebrow, label, extra) =>
      '<div style="'+bandBase+(extra||'')+'">'
      + '<div style="font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;opacity:.72;margin-bottom:7px">'+esc(eyebrow)+'</div>'
      + '<div style="font-size:38px;font-weight:800;letter-spacing:-.4px">'+esc(label)+'</div></div>'
    H.push(sectionBand('Whole organisation', 'All services combined'))
    H.push('<p class="note">Every incident in the period, whichever service it was reported under. Each service is then repeated on its own below, in the same format.</p>')
    H.push(section(incidents, true))
    industries.forEach(([id, name]) => {
      // page-break-before so a single service's section can be handed to the
      // body that governs it without the others on the reverse.
      H.push(sectionBand('Service', name, ';page-break-before:always'))
      H.push('<p class="note">Incidents reported under '+esc(name)+' only.'
        + (id === primaryId ? ' Includes incidents recorded before a service was chosen, which resolve to this one.' : '')
        + '</p>')
      H.push(section(forIndustry(id), false))
    })
  }

  H.push('<p class="note noprint" style="margin-top:32px"><b>Before you save:</b> in the print dialogue, open More settings and untick “Headers and footers”. Otherwise the browser prints its own URL and date across the top of the page.</p>')
  H.push('<div class="foot">'+esc(orgName)+' · incident register · generated '+new Date().toLocaleDateString('en-AU')+'</div>')
  H.push('</div></body></html>')
  const w = window.open('', '_blank')
  if (!w) { alert('Allow pop-ups for this site to open the Trend Analysis Report.'); return }
  w.document.write(H.join(''))
  w.document.close()
}
