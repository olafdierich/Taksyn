#!/usr/bin/env python3
# Abort-safe insertion of the residual-risk UI into App.jsx.
# Anchors on the initial-risk band pill's closing line; inserts the residual
# section immediately after it, inside the same card. Changes NOTHING unless the
# anchor matches EXACTLY ONCE.

import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

# The exact end of the initial-risk band-pill IIFE line (line ~13326), including
# the closing "})()}" and the trailing newline. This is our unique anchor.
ANCHOR = "return <div style={{marginTop:8,fontSize:13,display:'flex',alignItems:'center',gap:8}}>Risk rating: <strong>{r}</strong> <span style={{background:bg,color:'#fff',fontWeight:700,fontSize:12,padding:'2px 8px',borderRadius:12}}>{band}</span> <span style={{color:'var(--t2)',fontSize:12}}>({sel.risk_likelihood}\u00d7{sel.risk_consequence})</span></div> })()}\n"

# Residual-risk block. Gated on sel.risk_rating (only shows once an initial
# rating exists). Mirrors the initial selects + save + band pill exactly, using
# residual_* fields. Band/colour thresholds identical to the initial pill.
INSERT = (
    "          {sel.risk_rating && (<div style={{marginTop:16,paddingTop:14,borderTop:'1px solid var(--border2)'}}>\n"
    "            <div style={{fontSize:12,color:'var(--t3)',marginBottom:6,fontWeight:600}}>Residual risk (after corrective actions)</div>\n"
    "            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>\n"
    "              <div>\n"
    "                <div style={{fontSize:12,color:'var(--t3)',marginBottom:4}}>Likelihood (1\u20135)</div>\n"
    "                <select id=\"inc-res-likelihood\" defaultValue={sel.residual_likelihood||''}\n"
    "                  style={{width:'100%',padding:'8px',borderRadius:8,border:'1px solid var(--border2)',background:'var(--card)',color:'var(--text)'}}>\n"
    "                  <option value=\"\">\u2014</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}\n"
    "                </select>\n"
    "              </div>\n"
    "              <div>\n"
    "                <div style={{fontSize:12,color:'var(--t3)',marginBottom:4}}>Consequence (1\u20135)</div>\n"
    "                <select id=\"inc-res-consequence\" defaultValue={sel.residual_consequence||''}\n"
    "                  style={{width:'100%',padding:'8px',borderRadius:8,border:'1px solid var(--border2)',background:'var(--card)',color:'var(--text)'}}>\n"
    "                  <option value=\"\">\u2014</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}\n"
    "                </select>\n"
    "              </div>\n"
    "            </div>\n"
    "            <button className=\"btn btn-secondary btn-sm\" style={{marginTop:8}} disabled={busy} onClick={()=>{\n"
    "              const l=+document.getElementById('inc-res-likelihood').value||null\n"
    "              const c=+document.getElementById('inc-res-consequence').value||null\n"
    "              const rating=(l&&c)?l*c:null\n"
    "              patchIncident({ residual_likelihood:l, residual_consequence:c, residual_rating:rating },\n"
    "                'residual_risk_rated', { to: rating?String(rating):null, details:{likelihood:l,consequence:c} })\n"
    "            }}>Save residual risk</button>\n"
    "            {sel.residual_rating && (()=>{ const r=sel.residual_rating; const band=r>=15?'Extreme':r>=9?'High':r>=4?'Moderate':'Low'; const bg=r>=15?'#DC2626':r>=9?'#EA580C':r>=4?'#EAB308':'#16A34A'; return <div style={{marginTop:8,fontSize:13,display:'flex',alignItems:'center',gap:8}}>Residual rating: <strong>{r}</strong> <span style={{background:bg,color:'#fff',fontWeight:700,fontSize:12,padding:'2px 8px',borderRadius:12}}>{band}</span> <span style={{color:'var(--t2)',fontSize:12}}>({sel.residual_likelihood}\u00d7{sel.residual_consequence})</span></div> })()}\n"
    "          </div>)}\n"
)

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        src = f.read()

    count = src.count(ANCHOR)
    if count != 1:
        print(f"ABORT: anchor matched {count} times (expected exactly 1). No changes written.")
        sys.exit(1)

    # Idempotency guard: if the residual block is already present, do nothing.
    if "inc-res-likelihood" in src:
        print("ABORT: residual block already present (inc-res-likelihood found). No changes written.")
        sys.exit(1)

    new_src = src.replace(ANCHOR, ANCHOR + INSERT, 1)

    if new_src == src:
        print("ABORT: replacement produced no change. No changes written.")
        sys.exit(1)

    with open(PATH, "w", encoding="utf-8") as f:
        f.write(new_src)

    print("OK: residual-risk UI inserted after the initial risk pill (1 insertion).")

if __name__ == "__main__":
    main()
