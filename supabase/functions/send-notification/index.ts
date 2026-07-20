// send-notification — sends a transactional email via Resend.
// Mirrors invite-user: CORS block, shared-secret auth, service-role client,
// explicit status codes. Adds a recipient allowlist so a leaked client-side
// secret cannot be used to send mail to arbitrary addresses.
//
// Contract (matches sendEmailNotif in src/App.jsx ~line 271):
//   POST { to, subject, body, secret }
//
// Required function secrets (Edge Functions -> Secrets):
//   INVITE_SECRET    - must equal the VITE_INVITE_SECRET the app ships
//   RESEND_API_KEY   - Resend API key
//   NOTIFY_FROM      - verified sender, e.g. "Taksyn <notifications@yourdomain>"
//   SUPABASE_URL     - provided by the platform
//   SERVICE_ROLE_KEY - service role key (same name invite-user uses)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (payload: unknown, status: number) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// Minimal HTML escaping so a plain-text body cannot inject markup.
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;')
   .replace(/</g, '&lt;')
   .replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { to, subject, body, secret } = await req.json()

    // --- auth: shared secret, same model as invite-user ---
    const inviteSecret = Deno.env.get('INVITE_SECRET')
    if (!inviteSecret || secret !== inviteSecret) {
      console.log('[send-notification] rejected: bad or missing secret')
      return json({ error: 'Unauthorized' }, 401)
    }

    // --- validate payload ---
    if (!to || !subject) {
      return json({ error: 'to and subject are required' }, 400)
    }

    // --- config check, before doing any work ---
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const from = Deno.env.get('NOTIFY_FROM')
    if (!resendKey || !from) {
      console.log('[send-notification] misconfigured: RESEND_API_KEY or NOTIFY_FROM missing')
      return json({ error: 'Email not configured' }, 500)
    }

    // --- recipient allowlist ---
    // The secret ships in the client bundle, so it must not confer the ability
    // to mail arbitrary addresses. Only known users can be notified.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const recipient = String(to).trim().toLowerCase()
    const { data: match, error: lookupError } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .ilike('email', recipient)
      .limit(1)

    if (lookupError) {
      console.log('[send-notification] allowlist lookup failed:', lookupError.message)
      return json({ error: 'Recipient check failed' }, 500)
    }
    if (!match || match.length === 0) {
      // Deliberately vague to the caller; specific in the logs.
      console.log('[send-notification] blocked: recipient not a known user')
      return json({ error: 'Recipient not permitted' }, 403)
    }

    // --- send via Resend ---
    const text = String(body ?? '')
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1a2e">`
      + escapeHtml(text).replace(/\n/g, '<br>')
      + `</div>`

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + resendKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject: String(subject),
        text,
        html,
      }),
    })

    const resendBody = await resendRes.json().catch(() => ({}))

    if (!resendRes.ok) {
      console.log('[send-notification] Resend error', resendRes.status, JSON.stringify(resendBody))
      return json({ error: 'Send failed', status: resendRes.status, detail: resendBody }, 502)
    }

    console.log('[send-notification] sent, id:', resendBody?.id)
    return json({ success: true, id: resendBody?.id ?? null }, 200)

  } catch (e) {
    console.log('[send-notification] unhandled error:', e?.message)
    return json({ error: 'Bad request' }, 400)
  }
})
