import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Must stay in sync with App.jsx ROLE_LEVEL (line ~113).
// Higher number = more powerful. Used for the invite clamp.
const ROLE_LEVEL: Record<string, number> = {
  super_admin: 5,
  client_admin: 4,
  manager: 3,
  supervisor: 2,
  worker: 1,
}
const CAN_INVITE_ROLES = ['client_admin', 'manager']

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
    // [PATCH:invite-position-v2]
    // `position` is ONE name (Chef). `positions` is a display summary
    // built by the caller and is deliberately not written to any column.
    const { action, email, name, role, org, orgId, industry, position, positions, dateOfBirth, inviteUrl } = await req.json()

    // NOTE: `secret` is intentionally no longer read or trusted.
    console.log('[invite-user] received fields:', { action, email, name, role, org, orgId })

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Separate client keyed with the ANON/publishable key, used ONLY to validate the
    // caller's JWT. Using the service-role client here makes the auth endpoint reject the
    // request with "Invalid API key". SUPABASE_ANON_KEY is auto-injected into functions.
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    // ---- AUTH GATE (replaces shared-secret check) ----
    // 1. Identify the caller from their session token.
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Unauthorized' }, 401)

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(token)
    const caller = userData?.user
    if (userErr || !caller) return json({ error: 'Unauthorized' }, 401)

    // 2. Determine caller's authority.
    //    super_admin is authoritative ONLY in profiles.role (in org_members
    //    the super_admin is stored as client_admin against a sentinel org).
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles').select('role').eq('id', caller.id).single()
    const isSuperAdmin = callerProfile?.role === 'super_admin'

    if (action === 'resend') {
      // resend carries no role/org — can't escalate. Require admin/manager somewhere.
      if (!isSuperAdmin) {
        const { data: memberships } = await supabaseAdmin
          .from('org_members').select('role').eq('user_id', caller.id)
        const ok = (memberships || []).some((m) => CAN_INVITE_ROLES.includes(m.role))
        if (!ok) return json({ error: 'Forbidden' }, 403)
      }
    } else {
      // fresh invite — full org-scoped clamp.
      if (!isSuperAdmin) {
        if (!orgId) return json({ error: 'Forbidden' }, 403)
        // caller must be a member of the TARGET org, with an invite-capable role
        const { data: membership } = await supabaseAdmin
          .from('org_members').select('role').eq('user_id', caller.id).eq('org', orgId).single()
        const callerRole = membership?.role
        if (!callerRole || !CAN_INVITE_ROLES.includes(callerRole)) {
          return json({ error: 'Forbidden' }, 403)
        }
        // clamp: may only grant a role STRICTLY BELOW own level (matches getInvitableRoles)
        const invitedLevel = ROLE_LEVEL[role || 'worker'] ?? 0
        const callerLevel = ROLE_LEVEL[callerRole] ?? 0
        if (invitedLevel >= callerLevel) {
          return json({ error: 'Cannot invite a role at or above your own level' }, 403)
        }
      }
    }
    // ---- END AUTH GATE ----

    if (!email) return json({ error: 'Email is required' }, 400)

    if (action === 'resend') {
      const { error: genError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo: inviteUrl || undefined },
      })
      if (genError) return json({ error: genError.message }, 400)
      return json({ success: true }, 200)
    }

    // FIX-IL-ROW: handle_new_user() resolves the role from invite_links at INSERT
    // time. The trigger fires DURING inviteUserByEmail, so this row must exist
    // first or the role degrades to worker via the CHK-36 clamp. Writing
    // profiles.role afterwards does NOT work - profiles_guard_biu is BEFORE
    // UPDATE and pins it back (auth.uid() is null on a service_role connection).
    if (orgId && role) {
      const { error: ilErr } = await supabaseAdmin.from('invite_links').insert({
        organisation_id: orgId,
        invited_email: email,
        invited_name: name || null,
        invited_role: role,
        invited_industry: industry || null,
        // Recorded only: handle_new_user() reads role and industry from
        // this row, not position.
        invited_position: position || null,
        role: role,
        created_by: caller.id,
        is_active: true,
      })
      if (ilErr) console.error('[invite-user] invite_links insert failed:', ilErr)
    }

    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: inviteUrl || undefined,
      data: { name, role, org, orgId, industry, dateOfBirth: dateOfBirth || null },
    })

    if (inviteError) {
      const msg = inviteError.message.toLowerCase()
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('already been registered')) {
        // User already exists — only add org_members, do NOT touch profiles
        const { data: profileData } = await supabaseAdmin.from('profiles').select('id').eq('email', email).single()
        if (profileData?.id && orgId) {
          // FIX-NULL-OVERWRITE (20 Aug 2026): omit these keys when undefined.
          // The app does not send position or industry in this payload, so
          // `|| null` wrote NULL over values handle_new_user had already
          // sourced from invite_links. An omitted key leaves the existing
          // value untouched on upsert.
          await supabaseAdmin.from('org_members').upsert({
            user_id: profileData.id,
            org: orgId,
            role: role || 'member',
            ...(industry ? { industry } : {}),
            ...(position ? { position } : {}),
          }, { onConflict: 'user_id,org' })
        }
        return json({ success: true, alreadyExisted: true, userId: profileData?.id || null }, 200)
      }
      return json({ error: inviteError.message }, 400)
    }

    const userId = inviteData.user?.id

    if (userId) {
      // org (name) goes to profiles.org
      await supabaseAdmin.from('profiles').upsert({
        id: userId,
        email,
        name,
        role: role || 'member',
        org: org || '',
      }, { onConflict: 'id' })

      // orgId (ORG... id) goes to org_members.org
      if (orgId) {
        // FIX-NULL-OVERWRITE (20 Aug 2026): this is the write the om_audit
        // trigger caught setting position from 'Driver' to NULL about 2.5s
        // after handle_new_user inserted it. The previous comment here claimed
        // this "adds position" - it did the opposite, because the app never
        // sends a position field and `|| null` therefore wrote an explicit
        // NULL. Omitting the key leaves the existing value alone.
        await supabaseAdmin.from('org_members').upsert({
          user_id: userId,
          org: orgId,
          role: role || 'member',
          ...(industry ? { industry } : {}),
          ...(position ? { position } : {}),
        }, { onConflict: 'user_id,org' })
      }
    }

    return json({ success: true, userId }, 200)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
