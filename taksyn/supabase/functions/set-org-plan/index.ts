// supabase/functions/set-org-plan/index.ts
//
// The ONLY path by which a super admin can change organisations.plan.
//
// WHY THIS EXISTS AS A FUNCTION AND NOT A BROWSER WRITE
// billing_plan_guard_bu (BEFORE UPDATE on organisations) raises on any
// change to plan, plan_status or billing_exempt unless current_user is
// 'service_role'. Proven on LIVE 1 Sep 2026: postgres itself was blocked,
// service_role was allowed. The browser holds no service key -- supabaseAdmin
// in src/supabase.js resolves to null in production, and it must stay that
// way (VITE_-prefixed vars are compiled into the public bundle; that was the
// July key exposure). So the service key lives here or nowhere.
//
// Also: plan_change_log has RLS enabled with ZERO policies, so it is
// unreadable from the browser under any role. The 'history' action below is
// the only way to read it back.
//
// Shape, env var names and the auth gate follow invite-user deliberately.
// SERVICE_ROLE_KEY is the custom name used in this project's Edge Functions
// panel -- NOT the auto-injected SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Lowercase, matching how organisations.plan is stored. planTier() in
// App.jsx normalises these to the capitalised TIERS keys for display, and
// maps the legacy 'pro' to Professional. 'pro' is NOT accepted as an input
// here -- it is a value to be migrated away from, not written afresh.
const VALID_PLANS = ['personal', 'starter', 'growth', 'professional', 'enterprise']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const { action, orgId, newPlan, note } = await req.json()

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Separate client keyed with the publishable/anon key, used ONLY to
    // validate the caller's JWT. The service-role client makes the auth
    // endpoint reject with "Invalid API key" -- same trap as invite-user.
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    // ---- AUTH GATE ----
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Unauthorized' }, 401)

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(token)
    const caller = userData?.user
    if (userErr || !caller) return json({ error: 'Unauthorized' }, 401)

    // super_admin is authoritative ONLY in profiles.role. In org_members the
    // super admin is stored as client_admin against a sentinel org, so a
    // membership-derived role check would read 'client_admin' and pass the
    // wrong person. Same reasoning as invite-user and as the M3 guard.
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles').select('role').eq('id', caller.id).single()

    if (callerProfile?.role !== 'super_admin') {
      return json({ error: 'Forbidden: super admin only' }, 403)
    }
    // ---- END AUTH GATE ----

    if (!orgId) return json({ error: 'orgId is required' }, 400)

    // ---- HISTORY ----
    if (action === 'history') {
      const { data, error } = await supabaseAdmin
        .from('plan_change_log')
        .select('id,org,old_plan,new_plan,source,changed_by,note,created_at')
        .eq('org', orgId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) return json({ error: error.message }, 400)
      return json({ success: true, history: data || [] }, 200)
    }

    // ---- CHANGE PLAN ----
    if (!newPlan || !VALID_PLANS.includes(String(newPlan).toLowerCase())) {
      return json({ error: 'newPlan must be one of: ' + VALID_PLANS.join(', ') }, 400)
    }
    const target = String(newPlan).toLowerCase()

    // A reason is MANDATORY. It slows the click enough to make it deliberate,
    // and it answers "why is this org on Professional?" six months later
    // without anyone reconstructing it. v6 section 18.2 requires this for the
    // exemption toggle; a plan change deserves the same.
    const reason = (note ?? '').toString().trim()
    if (reason.length < 3) {
      return json({ error: 'A reason is required for a plan change' }, 400)
    }

    const { data: orgRow, error: orgErr } = await supabaseAdmin
      .from('organisations').select('id,name,plan,plan_status').eq('id', orgId).single()
    if (orgErr || !orgRow) return json({ error: 'Organisation not found' }, 404)

    const oldPlan = orgRow.plan
    if ((oldPlan || '').toLowerCase() === target) {
      return json({ error: orgRow.name + ' is already on ' + target }, 400)
    }

    // .select() is not optional. PostgREST returns 200/204 with error: null
    // when zero rows match, so an update that changed nothing is
    // indistinguishable from success without inspecting the returned rows.
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('organisations')
      .update({ plan: target })
      .eq('id', orgId)
      .select('id,plan')

    if (updErr) return json({ error: 'Plan update failed: ' + updErr.message }, 400)
    if (!updated || updated.length !== 1) {
      return json({ error: 'Plan update affected ' + (updated?.length ?? 0) + ' rows. Nothing was changed.' }, 400)
    }

    // NOT ATOMIC, and deliberately so. The update and the log are two
    // statements against PostgREST; there is no transaction spanning them.
    // Wrapping both in a Postgres function would not help -- a SECURITY
    // DEFINER function owned by postgres makes current_user 'postgres'
    // inside the function, which the guard blocks.
    //
    // So: if the log write fails, the plan is put back and the caller is
    // told the change did NOT happen. An unlogged plan change is worse than
    // no plan change, because the whole point of this path is traceability.
    const { data: logged, error: logErr } = await supabaseAdmin
      .from('plan_change_log')
      .insert({
        org: orgId,
        old_plan: oldPlan,
        new_plan: target,
        old_status: orgRow.plan_status,
        new_status: orgRow.plan_status,
        source: 'super_admin',
        changed_by: caller.id,
        note: reason,
      })
      .select('id')

    if (logErr || !logged || logged.length !== 1) {
      const { error: revertErr } = await supabaseAdmin
        .from('organisations').update({ plan: oldPlan }).eq('id', orgId).select('id')
      return json({
        error: 'Plan change was REVERTED: the audit log write failed (' +
               (logErr?.message || 'no row returned') + ').' +
               (revertErr ? ' WARNING: the revert also failed (' + revertErr.message +
                            '). ' + orgRow.name + ' may be on ' + target +
                            ' with no log entry. Check manually.' : ''),
      }, 500)
    }

    console.log('[set-org-plan]', orgId, oldPlan, '->', target, 'by', caller.id)

    return json({
      success: true,
      org: orgRow.name,
      oldPlan,
      newPlan: target,
      logId: logged[0].id,
    }, 200)

  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
