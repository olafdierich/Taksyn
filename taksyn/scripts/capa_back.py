#!/usr/bin/env python3
# CAPA "Back" move — ATOMIC abort-safe edit to src/App.jsx
# Edit 1: reconcile-on-open — flip approved-task actions to 'completed' + audit event
# Edit 2: register counter — count 'completed' as done (alongside 'verified'/'done')
# All edits apply together or NOTHING is written. Each anchor must match exactly once.

import sys, io
PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"
with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()
orig = src
edits = []

# ---- Edit 1: reconcile in openIncident, right after actions load ----
A1 = """    const [{ data: ev }, { data: act }] = await Promise.all([
      supabase.from('incident_events').select('*').eq('incident_id', inc.id).order('at',{ascending:false}),
      supabase.from('incident_actions').select('*').eq('incident_id', inc.id).order('created_at',{ascending:true}),
    ])
    setEvents(ev||[]); setActions(act||[])"""

A1_NEW = """    let [{ data: ev }, { data: act }] = await Promise.all([
      supabase.from('incident_events').select('*').eq('incident_id', inc.id).order('at',{ascending:false}),
      supabase.from('incident_actions').select('*').eq('incident_id', inc.id).order('created_at',{ascending:true}),
    ])
    // CAPA "Back": reconcile actions whose linked task is approved -> flip to completed (idempotent, audit-accurate)
    try {
      const pending = (act||[]).filter(a => a.task_id && !['completed','done','verified'].includes(a.status))
      if (pending.length) {
        const ids = [...new Set(pending.map(a => a.task_id))]
        const { data: tks } = await supabase.from('tasks').select('id,status,reviewed_at,approver_id,approver_name').in('id', ids)
        const tmap = Object.fromEntries((tks||[]).map(t => [t.id, t]))
        let changed = false
        for (const a of pending) {
          const t = tmap[a.task_id]
          if (t && t.status === 'approved') {
            const when = t.reviewed_at || new Date().toISOString()
            const { error: uErr } = await supabase.from('incident_actions')
              .update({ status:'completed', verified_at: when, verified_by: t.approver_id || null })
              .eq('id', a.id)
            if (!uErr) {
              changed = true
              await supabase.from('incident_events').insert({
                incident_id: inc.id, org: orgId, event_type:'corrective_action_completed',
                by_id: t.approver_id || null, by_name: t.approver_name || 'System', by_role: 'client_admin',
                to_value: (a.description||'').slice(0,60),
                details: { task_id: a.task_id, action_id: a.id, verified_at: when }
              })
            }
          }
        }
        if (changed) {
          const [{ data: ev2 }, { data: act2 }] = await Promise.all([
            supabase.from('incident_events').select('*').eq('incident_id', inc.id).order('at',{ascending:false}),
            supabase.from('incident_actions').select('*').eq('incident_id', inc.id).order('created_at',{ascending:true}),
          ])
          ev = ev2; act = act2
        }
      }
    } catch (e) { /* reconcile is best-effort; never block opening the incident */ }
    setEvents(ev||[]); setActions(act||[])"""

edits.append(("reconcile in openIncident", A1, A1_NEW))

# ---- Edit 2: register counter includes 'completed' ----
A2 = "if(a.status!=='verified'&&a.status!=='done') c.open++"
A2_NEW = "if(a.status!=='verified'&&a.status!=='done'&&a.status!=='completed') c.open++"
edits.append(("register counter includes completed", A2, A2_NEW))

# verify all anchors match once
for name, anchor, _ in edits:
    c = src.count(anchor)
    if c != 1:
        print(f"ABORT: anchor '{name}' matched {c} times (need 1). No changes written.")
        sys.exit(1)

for name, anchor, repl in edits:
    src = src.replace(anchor, repl)

if src == orig:
    print("ABORT: no net change. Nothing written.")
    sys.exit(1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(src)
print("OK: CAPA Back move applied — 2 edits (reconcile-on-open + register counter).")
