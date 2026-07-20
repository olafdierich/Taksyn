#!/usr/bin/env python3
# Finding #3: collapse Investigator into Assigned owner.
# 1) Remove the Investigator column <div> from the "Who is responsible" grid.
# 2) Change that grid from two columns ('1fr 1fr') to one ('1fr') so Assigned
#    owner uses the full width.
# investigator_id column + RLS are untouched. Client-side visibility check at
# ~13192 (assigned_to OR investigator_id) is deliberately LEFT intact so anyone
# already set as investigator on an existing incident keeps access.
# Abort-safe: each edit anchors on an exact, unique string; changes NOTHING
# unless BOTH anchors match exactly once.

import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

# --- Edit 1: the Investigator column block to delete (verbatim from the file) ---
INVESTIGATOR_BLOCK = (
    "            <div>\n"
    "              <div style={{fontSize:12,color:'var(--t3)'}}>Investigator</div>\n"
    "              {isAdmin ? (\n"
    "                <select value={sel.investigator_id||''} disabled={busy}\n"
    "                  onChange={e=>{\n"
    "                    const uid=e.target.value; const m=members.find(x=>x.user_id===uid)\n"
    "                    patchIncident({ investigator_id:uid||null, investigator_name:m?.name||null },\n"
    "                      'assigned', { to: m?.name||null, details:{role:'investigator'} })\n"
    "                  }}\n"
    "                  style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1px solid var(--border2)',background:'var(--card)',color:'var(--text)',marginTop:4}}>\n"
    "                  <option value=\"\">\u2014 none \u2014</option>\n"
    "                  {members.map(m=><option key={m.user_id} value={m.user_id}>{m.name} ({m.role})</option>)}\n"
    "                </select>\n"
    "              ) : (\n"
    "                <div style={{marginTop:4,fontSize:14,fontWeight:600}}>{names[sel.investigator_id]||sel.investigator_name||'\u2014 none \u2014'}</div>\n"
    "              )}\n"
    "            </div>\n"
)

# --- Edit 2: the grid line to collapse. Anchored with the preceding unique
# "Who is responsible" span so it targets ONLY this grid, not the risk grid. ---
GRID_ANCHOR = (
    "          <span style={lbl}>Who is responsible</span>\n"
    "          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>\n"
)
GRID_REPLACEMENT = (
    "          <span style={lbl}>Who is responsible</span>\n"
    "          <div style={{display:'grid',gridTemplateColumns:'1fr',gap:12}}>\n"
)

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        src = f.read()

    # Idempotency guard.
    if "Investigator" not in src and "investigator_id||''" not in src:
        print("ABORT: Investigator field appears already removed. No changes written.")
        sys.exit(1)

    n_block = src.count(INVESTIGATOR_BLOCK)
    if n_block != 1:
        print(f"ABORT: Investigator block matched {n_block} times (expected 1). No changes written.")
        sys.exit(1)

    n_grid = src.count(GRID_ANCHOR)
    if n_grid != 1:
        print(f"ABORT: 'Who is responsible' grid anchor matched {n_grid} times (expected 1). No changes written.")
        sys.exit(1)

    new_src = src.replace(INVESTIGATOR_BLOCK, "", 1)
    new_src = new_src.replace(GRID_ANCHOR, GRID_REPLACEMENT, 1)

    if new_src == src:
        print("ABORT: no change produced. No changes written.")
        sys.exit(1)

    with open(PATH, "w", encoding="utf-8") as f:
        f.write(new_src)

    print("OK: Investigator field removed; grid collapsed to single column (2 edits).")

if __name__ == "__main__":
    main()
