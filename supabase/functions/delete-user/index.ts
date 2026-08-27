import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// Must stay in sync with App.jsx ROLE_LEVEL (line ~113). Higher = more powerful.
const ROLE_LEVEL = {
  super_admin: 5,
  client_admin: 4,
  manager: 3,
  supervisor: 2,
  worker: 1
};
// Roles allowed to remove someone from an org (per-org 'remove' mode).
const CAN_REMOVE_ROLES = [
  'client_admin',
  'manager'
];
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  const json = (body, status = 200)=>new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  try {
    // mode: 'remove' (default, per-org) | 'purge' (super_admin only, full wipe)
    // orgId = ORG... id (org_members.org, invite_links.organisation_id)
    // orgName = org NAME (tasks.org, possibly teams.org)
    const { userId, orgId, orgName, mode = 'remove' } = await req.json();
    console.log('[delete-user] received:', {
      userId,
      orgId,
      orgName,
      mode
    });
    if (!userId) return json({
      error: 'userId is required'
    }, 400);
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SERVICE_ROLE_KEY') ?? '');
    // Anon/publishable client used ONLY to validate the caller's JWT.
    const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '');
    // ---- AUTH GATE ----
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({
      error: 'Unauthorized'
    }, 401);
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({
      error: 'Unauthorized'
    }, 401);
    // Cannot delete yourself.
    if (caller.id === userId) {
      return json({
        error: 'You cannot delete your own account.'
      }, 403);
    }
    // super_admin is authoritative ONLY in profiles.role.
    // Duplicate-tolerant: profiles may have >1 row per id (no unique constraint observed).
    // Treat caller as super_admin if ANY of their profile rows says so.
    const { data: callerProfiles } = await supabaseAdmin.from('profiles').select('role').eq('id', caller.id);
    const isSuperAdmin = (callerProfiles || []).some((r)=>r.role === 'super_admin');
    // Target's role level (for the clamp). Read from org_members in the target org
    // when we have one; fall back to profiles.role.
    let targetLevel = 0;
    if (orgId) {
      const { data: tOm } = await supabaseAdmin.from('org_members').select('role').eq('user_id', userId).eq('org', orgId).maybeSingle();
      if (tOm?.role) targetLevel = ROLE_LEVEL[tOm.role] ?? 0;
    }
    if (!targetLevel) {
      // Duplicate-tolerant: take the HIGHEST role level across any profile rows,
      // so the clamp can't be bypassed by a low-role duplicate.
      const { data: tProfs } = await supabaseAdmin.from('profiles').select('role').eq('id', userId);
      targetLevel = (tProfs || []).reduce((max, r)=>Math.max(max, ROLE_LEVEL[r.role ?? ''] ?? 0), 0);
    }
    if (mode === 'purge') {
      // Full account wipe is super_admin ONLY.
      if (!isSuperAdmin) {
        return json({
          error: 'Only a super admin can permanently delete an account.'
        }, 403);
      }
    } else {
      // 'remove' — per-org. Caller must be super_admin, or an invite-capable
      // admin/manager in the TARGET org, and cannot remove someone at or above own level.
      if (!isSuperAdmin) {
        if (!orgId) return json({
          error: 'orgId is required for removal.'
        }, 400);
        const { data: membership } = await supabaseAdmin.from('org_members').select('role').eq('user_id', caller.id).eq('org', orgId).maybeSingle();
        const callerRole = membership?.role;
        if (!callerRole || !CAN_REMOVE_ROLES.includes(callerRole)) {
          return json({
            error: 'Forbidden'
          }, 403);
        }
        const callerLevel = ROLE_LEVEL[callerRole] ?? 0;
        if (targetLevel >= callerLevel) {
          return json({
            error: 'Cannot remove a user at or above your own level.'
          }, 403);
        }
      }
    }
    // ---- END AUTH GATE ----
    const results = {
      mode
    };
    // --- team_members: scope by teams in this org (never trust team_members.org) ---
    if (mode === 'purge') {
      const { error, count } = await supabaseAdmin.from('team_members').delete({
        count: 'exact'
      }).eq('user_id', userId);
      results.team_members = error ? {
        error: error.message
      } : {
        deleted: count
      };
    } else {
      // Find teams belonging to this org (match teams.org against id OR name),
      // then delete only this user's memberships in those teams.
      const orgMatch = [
        orgId,
        orgName
      ].filter(Boolean);
      let teamIds = [];
      if (orgMatch.length) {
        const { data: teamRows } = await supabaseAdmin.from('teams').select('id').in('org', orgMatch);
        teamIds = (teamRows || []).map((t)=>t.id);
      }
      if (teamIds.length) {
        const { error, count } = await supabaseAdmin.from('team_members').delete({
          count: 'exact'
        }).eq('user_id', userId).in('team_id', teamIds);
        results.team_members = error ? {
          error: error.message
        } : {
          deleted: count
        };
      } else {
        results.team_members = {
          deleted: 0,
          note: 'no teams matched org'
        };
      }
    }
    // --- invite_links: by email + org (remove) or by email across all orgs (purge) ---
    {
      // NOTE: profiles may have duplicate rows for one id (no unique constraint observed
      // in sandbox). maybeSingle() returns null on 2+ rows, so we fetch all and pick the
      // first non-null email. Robust to 0/1/many rows.
      const { data: profRows } = await supabaseAdmin.from('profiles').select('email').eq('id', userId);
      const email = (profRows || []).map((r)=>r.email).find(Boolean) || null;
      if (email) {
        let q = supabaseAdmin.from('invite_links').delete({
          count: 'exact'
        }).eq('invited_email', email.trim().toLowerCase());
        if (mode !== 'purge' && orgId) q = q.eq('organisation_id', orgId);
        const { error, count } = await q;
        results.invite_links = error ? {
          error: error.message
        } : {
          deleted: count
        };
      } else {
        results.invite_links = {
          deleted: 0,
          note: 'no email on profile'
        };
      }
    }
    // --- tasks: reassign open tasks off this user (org NAME scoped in remove mode) ---
    {
      let q = supabaseAdmin.from('tasks').update({
        assigned_user_id: null
      }).eq('assigned_user_id', userId).not('status', 'in', '("completed","approved")');
      if (mode !== 'purge' && orgName) q = q.eq('org', orgName);
      const { error } = await q;
      results.tasks_reassigned = error ? {
        error: error.message
      } : {
        ok: true
      };
    }
    // --- org_members ---
    if (mode === 'purge') {
      const { error, count } = await supabaseAdmin.from('org_members').delete({
        count: 'exact'
      }).eq('user_id', userId);
      results.org_members = error ? {
        error: error.message
      } : {
        deleted: count
      };
    } else {
      if (!orgId) {
        results.org_members = {
          error: 'orgId required for remove'
        };
      } else {
        const { error, count } = await supabaseAdmin.from('org_members').delete({
          count: 'exact'
        }).eq('user_id', userId).eq('org', orgId);
        results.org_members = error ? {
          error: error.message
        } : {
          deleted: count
        };
      }
    }
    // --- profiles + auth: ONLY in purge mode ---
    if (mode === 'purge') {
      const { error: pErr, count: pCount } = await supabaseAdmin.from('profiles').delete({
        count: 'exact'
      }).eq('id', userId);
      results.profiles = pErr ? {
        error: pErr.message
      } : {
        deleted: pCount
      };
      const { error: aErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      results.auth = aErr ? {
        error: aErr.message
      } : {
        deleted: true
      };
    } else {
      results.profiles = {
        skipped: 'remove mode — profile kept'
      };
      results.auth = {
        skipped: 'remove mode — login kept'
      };
    }
    return json({
      success: true,
      results
    }, 200);
  } catch (err) {
    return json({
      error: err.message
    }, 500);
  }
});
