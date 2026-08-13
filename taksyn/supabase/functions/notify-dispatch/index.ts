// =====================================================================
// notify-dispatch
//
// Drains public.notification_queue and sends via Resend. Stage 3 of the
// incident/complaint notification chain:
//
//   Stage 1  notification_queue + resolve_notify_recipients
//   Stage 2  AFTER INSERT triggers on incidents and issue_reports
//   Stage 3  this function
//
// Deliberately mirrors task-reminders/index.ts: same Resend call, same
// FROM default, same attempts<3 cap, same DRY_RUN gate. Copying a proven
// caller beats writing one from the docs.
//
// DEPLOY
//   supabase functions deploy notify-dispatch --no-verify-jwt
//   supabase secrets set RESEND_API_KEY=...        (already set for reminders)
//   Schedule EVERY 5 MINUTES, not daily. A severity-5 incident has a
//   1-hour assign deadline; a daily job would miss it by design.
//
// FIRST RUN MUST BE A DRY RUN. DRY_RUN=true, read the output, then flip.
//
// KEY NAME: SUPABASE_SERVICE_ROLE_KEY (auto-injected), matching
// task-reminders. NOT the custom SERVICE_ROLE_KEY secret that invite-user
// reads — those are two different secrets and mixing them fails at runtime.
//
// ONE EMAIL PER RECIPIENT, never one email with several addresses. Who
// else was notified is internal information; a client_admin should not
// learn the distribution list from a To: header.
//
// sent_to IS THE DUPLICATE GUARD. A row with 3 recipients where 2 succeed
// is left pending with those 2 recorded. The retry sends only to the
// remaining address. Without this, every retry re-mails everyone who
// already received it.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("REMINDER_FROM") ?? "Taksyn <notifications@taksyn.com>";
const APP_URL = Deno.env.get("APP_URL") ?? "";
const DRY_RUN = (Deno.env.get("DRY_RUN") ?? "false").toLowerCase() === "true";
const MAX_ATTEMPTS = 3;
const BATCH = 50;

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function sendEmail(to: string, subject: string, text: string) {
  if (!RESEND_KEY) throw new Error("RESEND_API_KEY not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}

async function dispatch(log: string[]) {
  const { data: pending, error } = await db
    .from("notification_queue")
    .select("id,kind,source_ref,subject,body,recipients,sent_to,attempts")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("id", { ascending: true })
    .limit(BATCH);

  if (error) throw new Error(`queue read failed: ${error.message}`);
  if (!pending || pending.length === 0) {
    log.push("nothing pending");
    return { considered: 0, sent: 0, failed: 0, skipped: 0 };
  }

  let sent = 0, failed = 0, skipped = 0;

  for (const row of pending) {
    const already: string[] = row.sent_to ?? [];
    const targets: string[] = (row.recipients ?? []).filter(
      (r: string) => r && !already.includes(r),
    );

    // Nothing left to send: recipients were empty, or all already done.
    if (targets.length === 0) {
      skipped++;
      if (!DRY_RUN) {
        await db.from("notification_queue").update({
          status: already.length > 0 ? "sent" : "skipped",
          sent_at: new Date().toISOString(),
          last_error: already.length > 0 ? null : "no recipients to send to",
        }).eq("id", row.id);
      }
      log.push(`#${row.id} ${row.kind} — no targets (${already.length} already sent)`);
      continue;
    }

    const text = APP_URL ? `${row.body}\n\nOpen Taksyn: ${APP_URL}` : row.body;
    const delivered: string[] = [...already];
    const errors: string[] = [];

    for (const to of targets) {
      if (DRY_RUN) {
        log.push(`DRY #${row.id} -> ${to} :: ${row.subject}`);
        continue;
      }
      try {
        await sendEmail(to, row.subject, text);
        delivered.push(to);
      } catch (e) {
        errors.push(`${to}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (DRY_RUN) continue;

    const allDone = (row.recipients ?? []).every((r: string) => delivered.includes(r));

    const { error: upErr } = await db.from("notification_queue").update({
      // Partial success stays pending so the remainder is retried, but
      // sent_to records who already got it so they are not re-mailed.
      status: allDone ? "sent" : (row.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending"),
      sent_to: delivered,
      attempts: row.attempts + 1,
      last_error: errors.length ? errors.join(" | ") : null,
      sent_at: allDone ? new Date().toISOString() : null,
    }).eq("id", row.id);

    if (upErr) {
      // The mail went out but the ledger did not move. Say so loudly:
      // the next run would otherwise re-send to the same people.
      log.push(`#${row.id} SENT BUT LEDGER UPDATE FAILED: ${upErr.message}`);
    }

    if (allDone) { sent++; log.push(`#${row.id} ${row.kind} sent to ${targets.length}`); }
    else { failed++; log.push(`#${row.id} ${row.kind} partial/failed: ${errors.join(" | ")}`); }
  }

  return { considered: pending.length, sent, failed, skipped };
}

Deno.serve(async () => {
  const log: string[] = [];
  const started = new Date().toISOString();
  try {
    if (DRY_RUN) log.push("DRY_RUN=true — nothing will be sent or updated");
    const summary = await dispatch(log);
    return new Response(
      JSON.stringify({ ok: true, started, dry_run: DRY_RUN, ...summary, log }, null, 2),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ ok: false, started, error: msg, log }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
