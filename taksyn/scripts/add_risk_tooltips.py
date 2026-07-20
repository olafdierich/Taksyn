#!/usr/bin/env python3
# Phase A.1 - Incident risk-rating info tooltips (initial + residual, likelihood + consequence)
# Abort-safe: every replacement asserts exactly one match; writes only if ALL succeed.
# Display-only. No risk-math change.

import sys

PATH = '/workspaces/Taksyn/taksyn/src/App.jsx'

with open(PATH, 'r', encoding='utf-8') as f:
    src = f.read()

orig = src
edits = []   # (label, old, new)

# ---------------------------------------------------------------
# EDIT 1 — Define the InfoDot component.
# Anchor: the Stat component definition line (unique, seen in grep at ~983).
# We insert InfoDot immediately BEFORE it.
# ---------------------------------------------------------------
stat_anchor = "const Stat = ({ label, val, sub, icon, color='#00A87E', bg='rgba(0,168,126,.1)' }) => ("

INFODOT = r"""const RISK_INFO = {
  likelihood: {
    title: 'Likelihood',
    rows: [
      ['5 \u00b7 Certain', '>50% \u2014 expected to occur in most circumstances'],
      ['4 \u00b7 Likely', '21\u201350% \u2014 will probably occur in most circumstances'],
      ['3 \u00b7 Possible', '6\u201320% \u2014 might occur at some time'],
      ['2 \u00b7 Unlikely', '2\u20135% \u2014 could occur at some time'],
      ['1 \u00b7 Rare', '<2% \u2014 may occur only in exceptional circumstances'],
    ],
  },
  consequence: {
    title: 'Consequence',
    rows: [
      ['5 \u00b7 Catastrophic', 'Serious/fatal harm, or a near miss needing immediate correction. Business: risk of closure, loss of accreditation, huge financial loss.'],
      ['4 \u00b7 Major', 'Major harm or impact. Business: extensive financial and accreditation implications.'],
      ['3 \u00b7 Moderate', 'Moderate effect; a near miss with important lessons. Business: high financial impact, some external assistance needed.'],
      ['2 \u00b7 Minor', 'Inconvenience or minor effect; a near miss with some lessons. Business: medium financial impact, investigation.'],
      ['1 \u00b7 Insignificant', 'Little or no impact; a near miss with slight lessons. Business: little or no financial loss.'],
    ],
  },
};
const InfoDot = ({ kind }) => {
  const [open, setOpen] = useState(false);
  const info = RISK_INFO[kind];
  if (!info) return null;
  return (
    <span style={{position:'relative',display:'inline-block'}}>
      <button type="button" onClick={()=>setOpen(o=>!o)} aria-label={'About '+info.title}
        style={{width:16,height:16,lineHeight:'14px',padding:0,marginLeft:5,borderRadius:'50%',
          border:'1px solid var(--border2)',background:'var(--card)',color:'var(--t2)',
          fontSize:11,fontWeight:700,cursor:'pointer',verticalAlign:'middle'}}>i</button>
      {open && (
        <>
          <div onClick={()=>setOpen(false)}
            style={{position:'fixed',inset:0,zIndex:40}}/>
          <div style={{position:'absolute',top:20,left:0,zIndex:41,width:280,
            background:'var(--card)',border:'1px solid var(--border2)',borderRadius:10,
            boxShadow:'0 8px 28px rgba(0,0,0,.25)',padding:'12px 14px'}}>
            <div style={{fontSize:13,fontWeight:700,color:'var(--text)',marginBottom:8}}>{info.title}</div>
            {info.rows.map((r,i)=>(
              <div key={i} style={{marginBottom:7}}>
                <div style={{fontSize:12,fontWeight:600,color:'var(--text)'}}>{r[0]}</div>
                <div style={{fontSize:11.5,color:'var(--t2)',lineHeight:1.4}}>{r[1]}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </span>
  );
};
"""

if src.count(stat_anchor) != 1:
    print(f"ABORT edit1: Stat anchor found {src.count(stat_anchor)} times (need 1). No changes written.")
    sys.exit(1)
edits.append(("insert InfoDot", stat_anchor, INFODOT + stat_anchor))

# ---------------------------------------------------------------
# EDITS 2-5 — add <InfoDot> into each of the four labels.
# Each label <div> is immediately followed by its unique <select id=...>.
# We match the label-div + newline + select-open as one block (unique via the id)
# and inject InfoDot inside the label div.
# ---------------------------------------------------------------

def label_block(select_id, kind, indent):
    # old: the label div line + the select line start (unique through the id)
    old = (
        '<div style={{fontSize:12,color:\'var(--t3)\',marginBottom:4}}>' + LABELTEXT[kind] + '</div>\n'
        + indent + '<select id="' + select_id + '"'
    )
    new = (
        '<div style={{fontSize:12,color:\'var(--t3)\',marginBottom:4,display:\'flex\',alignItems:\'center\'}}>'
        + LABELTEXT[kind] + '<InfoDot kind="' + kind + '" /></div>\n'
        + indent + '<select id="' + select_id + '"'
    )
    return old, new

LABELTEXT = {
    'likelihood': 'Likelihood (1\u20135)',
    'consequence': 'Consequence (1\u20135)',
}

# indentation differs between initial (10 spaces before <select>) and residual (18 spaces).
# We read the actual indent from the file rather than hardcode, to be safe.
def find_indent_before(select_id):
    marker = '<select id="' + select_id + '"'
    idx = src.find(marker)
    if idx == -1:
        return None
    line_start = src.rfind('\n', 0, idx) + 1
    return src[line_start:idx]

specs = [
    ('inc-likelihood', 'likelihood'),
    ('inc-consequence', 'consequence'),
    ('inc-res-likelihood', 'likelihood'),
    ('inc-res-consequence', 'consequence'),
]

for select_id, kind in specs:
    indent = find_indent_before(select_id)
    if indent is None:
        print(f"ABORT: could not locate select '{select_id}'. No changes written.")
        sys.exit(1)
    old, new = label_block(select_id, kind, indent)
    if src.count(old) != 1:
        print(f"ABORT edit[{select_id}]: block matched {src.count(old)} times (need 1). No changes written.")
        sys.exit(1)
    edits.append((select_id, old, new))

# ---------------------------------------------------------------
# Apply all edits (all anchors already verified unique against the ORIGINAL source).
# Re-verify each is still uniquely present right before applying.
# ---------------------------------------------------------------
for label, old, new in edits:
    if src.count(old) != 1:
        print(f"ABORT apply[{label}]: expected exactly 1, found {src.count(old)}. No changes written.")
        sys.exit(1)
    src = src.replace(old, new, 1)

if src == orig:
    print("ABORT: no change produced. No file written.")
    sys.exit(1)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(src)

print("OK - applied", len(edits), "edits:")
for label, _, _ in edits:
    print("   -", label)
