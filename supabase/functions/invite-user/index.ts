import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { action, email, name, role, org, orgId, industry, positions, secret, inviteUrl } = await req.json()

    console.log('[invite-user] received fields:', { email, name, role, org, orgId, secret })

    const inviteSecret = Deno.env.get('INVITE_SECRET')
    if (!inviteSecret || secret !== inviteSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!email) {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    if (action === 'resend') {
      const { error: genError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo: inviteUrl || undefined },
      })
      if (genError) {
        return new Response(JSON.stringify({ error: genError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: inviteUrl || undefined,
      data: { name, role, org, orgId, industry },
    })

    if (inviteError) {
      const msg = inviteError.message.toLowerCase()
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('already been registered')) {
        // User already exists — only add org_members, do NOT touch profiles
        const { data: profileData } = await supabaseAdmin.from('profiles').select('id').eq('email', email).single()
        if (profileData?.id && orgId) {
          await supabaseAdmin.from('org_members').upsert({
            user_id: profileData.id,
            org: orgId,
            role: role || 'member',
            industry: industry || null,
          }, { onConflict: 'user_id,org' })
        }
        return new Response(JSON.stringify({ success: true, alreadyExisted: true, userId: profileData?.id || null }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: inviteError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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

      // orgId (ORG... id) goes to org_members.org_id
      if (orgId) {
        await supabaseAdmin.from('org_members').upsert({
          user_id: userId,
          org: orgId,
          role: role || 'member',
          industry: industry || null,
        }, { onConflict: 'user_id,org' })
      }
    }

    return new Response(JSON.stringify({ success: true, userId }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
