// =====================================================================
// Taksyn — task-reminders edge function
// 10 August 2026
//
// Runs on a schedule (once daily). Two phases in one invocation:
//   SCAN     — work out which reminders are due today and INSERT ledger
//              rows. Sends nothing.
//   DISPATCH — read queued rows and send them.
//
// The two are separate so a send failure never loses the knowledge that
// a reminder was owed, and so adding WhatsApp later touches DISPATCH
// only. SCAN has no idea what a channel is.
//
// THE LADDER (decided 10 Aug 2026)
//   BEFORE due, by lead time at scan:
//     0-2 days   -> nothing
//     3-10 days  -> [2]
//     11-30 days -> [7, 2]
//     31+ days   -> [14, 7, 2]
//   AFTER due:
//     1, 3, 7 days overdue, then SILENCE. Escalation is a separate
//     feature and will read this ledger; it is deliberately not here.
//     Do not add a "keep nagging" tier. An uncapped overdue reminder is
//     how a notification system gets filtered to trash.
//
// SCOPE: ONE-OFF TASKS ONLY.
//   App.jsx line 231 comments "This is the FOURTH walk" over the
//   occurrence-stepping logic. This job would be the fifth, in a second
//   runtime, unattended. Recurring waits for the per-occurrence rebuild.
//   The filter MIRRORS isRecurring() at App.jsx 133 exactly.
//
// TIMEZONE: resolved per organisation. Kemrose is Africa/Kampala
// (UTC+3); a job computing "2 days before" in UTC fires on the wrong
// day for them. An org with a null or INVALID timezone is SKIPPED and
// recorded as such — never silently defaulted to UTC. orgTime.js falls
// back to UTC by design, which is right for display and wrong here.
//
// DEPLOY
//   supabase functions deploy task-reminders --no-verify-jwt
//   supabase secrets set RESEND_API_KEY=...
//   Schedule daily via cron. 06:00 UTC = 09:00 Kampala, 16:00 Brisbane.
//
// FIRST RUN MUST BE A DRY RUN. Set DRY_RUN=true, read the output, and
// only then flip reminder_config.enabled to true.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("REMINDER_FROM") ?? "Taksyn <notifications@taksyn.com>";
const APP_URL = Deno.env.get("APP_URL") ?? "";
const DRY_RUN = (Deno.env.get("DRY_RUN") ?? "false").toLowerCase() === "true";

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------
// Date helpers. Deliberately mirrors src/lib/orgTime.js — Intl-based,
// DST-safe, never manual "+N hours" arithmetic.
// ---------------------------------------------------------------------

/** 'YYYY-MM-DD' for `date` in an IANA zone. Throws on an invalid zone. */
function ymdInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Validity, not just presence. 'EAT' and 'Kampala' are not IANA zones
 * and would silently resolve to UTC — the exact failure this guards.
 */
function isValidTz(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Whole days between two 'YYYY-MM-DD' strings. Date-only, no clocks. */
function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(fromYmd + "T00:00:00Z");
  const b = Date.parse(toYmd + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

/** Shift a 'YYYY-MM-DD' by n days. */
function addDays(ymd: string, n: number): string {
  const d = new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------

const OVERDUE_THRESHOLDS = [-1, -3, -7];

/**
 * Which thresholds apply to a task, given its lead time in days at the
 * moment it was scanned. Positive = days before due, negative = after.
 *
 * Boundaries are inclusive at the top of each band: 10 -> [2] and
 * 11 -> [7,2]; 30 -> [7,2] and 31 -> [14,7,2]. Decided 10 Aug.
 */
function thresholdsForLead(lead: number): number[] {
  if (lead < 0) return OVERDUE_THRESHOLDS;
  if (lead <= 2) return [];
  if (lead <= 10) return [2];
  if (lead <= 30) return [7, 2];
  return [14, 7, 2];
}

// ---------------------------------------------------------------------

interface LedgerRow {
  task_id: string;
  org: string;
  occurrence_date: string;
  threshold_days: number;
  channel: string;
  recipient_user_id: string;
  task_title: string;
  due_date: string;
  status?: string;
  skip_reason?: string;
}

/**
 * Assignee resolution. assigned_user_ids (array) is authoritative
 * wherever populated; assigned_user_id is the legacy scalar. Same
 * collapse the calendar design settled on — do not reintroduce an
 * either/or branch here.
 */
function recipientsOf(task: Record<string, unknown>): string[] {
  const arr = task.assigned_user_ids;
  if (Array.isArray(arr) && arr.length > 0) {
    return arr.filter((x): x is string => typeof x === "string" && x.length > 0);
  }
  const one = task.assigned_user_id;
  return typeof one === "string" && one.length > 0 ? [one] : [];
}

// ---------------------------------------------------------------------
// PHASE 1 — SCAN
// ---------------------------------------------------------------------

async function scan(log: string[]) {
  const { data: cfg, error: cfgErr } = await db
    .from("reminder_config")
    .select("first_run_date, enabled")
    .eq("id", true)
    .single();
  if (cfgErr) throw new Error("config read failed: " + cfgErr.message);

  if (!cfg.enabled) {
    log.push("DISABLED — reminder_config.enabled is false. Nothing scanned.");
    return { queued: 0, skipped: 0, disabled: true };
  }

  // THE CUTOVER. Written once, never updated. Any threshold whose
  // trigger day falls before it is ignored forever, so the twelve
  // already-overdue tasks never produce a retroactive burst.
  let cutover = cfg.first_run_date as string | null;
  if (!cutover) {
    cutover = new Date().toISOString().slice(0, 10);
    if (!DRY_RUN) {
      const { error } = await db
        .from("reminder_config")
        .update({ first_run_date: cutover, updated_at: new Date().toISOString() })
        .eq("id", true);
      if (error) throw new Error("cutover write failed: " + error.message);
    }
    log.push(`CUTOVER SET to ${cutover} (first run). No retroactive sends.`);
  }

  const { data: orgs, error: orgErr } = await db
    .from("organisations")
    .select("name, timezone");
  if (orgErr) throw new Error("org read failed: " + orgErr.message);

  const tzByOrg = new Map<string, string | null>();
  for (const o of orgs ?? []) tzByOrg.set(o.name as string, o.timezone as string | null);

  // Mirrors isRecurring() at App.jsx 133: null, '' and 'once' are all
  // one-off. Do NOT simplify to eq('recurrence','once').
  const { data: tasks, error: taskErr } = await db
    .from("tasks")
    .select(
      "id, title, org, due_date, status, recurrence, assigned_user_id, assigned_user_ids",
    )
    .or("recurrence.is.null,recurrence.eq.,recurrence.eq.once")
    .not("due_date", "is", null)
    .not("status", "in", '("approved","awaiting_review")');
  if (taskErr) throw new Error("task read failed: " + taskErr.message);

  const rows: LedgerRow[] = [];
  let skipped = 0;

  for (const t of tasks ?? []) {
    const org = t.org as string;
    const tz = tzByOrg.get(org);

    if (!isValidTz(tz)) {
      // Recorded, not silently dropped. A gap in the ledger must never
      // be ambiguous between "not owed" and "we failed to work it out".
      skipped++;
      log.push(`SKIP task=${t.id} org=${org} reason=timezone(${tz ?? "null"})`);
      continue;
    }

    const today = ymdInTz(new Date(), tz);
    const due = String(t.due_date).slice(0, 10);
    const lead = daysBetween(today, due);
    const people = recipientsOf(t);

    if (people.length === 0) {
      skipped++;
      log.push(`SKIP task=${t.id} reason=no-assignee`);
      continue;
    }

    for (const th of thresholdsForLead(lead)) {
      // The day this threshold is meant to fire.
      const triggerDay = addDays(due, -th);

      // Only fire on the day itself. A threshold crossed while the job
      // was down is missed, not caught up — catching up is how a
      // three-day outage becomes a burst of stale mail.
      if (triggerDay !== today) continue;

      // The cutover, applied per threshold.
      if (triggerDay < cutover) continue;

      for (const uid of people) {
        rows.push({
          task_id: t.id as string,
          org,
          occurrence_date: due, // == due_date for one-off tasks
          threshold_days: th,
          channel: "email",
          recipient_user_id: uid,
          task_title: (t.title as string) ?? "(untitled)",
          due_date: due,
        });
      }
    }
  }

  log.push(`SCAN: ${tasks?.length ?? 0} one-off tasks, ${rows.length} reminders due, ${skipped} skipped`);

  if (rows.length === 0) return { queued: 0, skipped, disabled: false };

  if (DRY_RUN) {
    for (const r of rows) {
      log.push(`WOULD QUEUE task=${r.task_id} th=${r.threshold_days} to=${r.recipient_user_id}`);
    }
    return { queued: 0, skipped, disabled: false, dryRun: rows.length };
  }

  // ignoreDuplicates leans on reminder_ledger_unique_send. This is what
  // makes a second invocation on the same day a no-op rather than a
  // second email.
  const { data: inserted, error: insErr } = await db
    .from("reminder_ledger")
    .upsert(rows, {
      onConflict: "task_id,occurrence_date,threshold_days,channel,recipient_user_id",
      ignoreDuplicates: true,
    })
    .select("id");
  if (insErr) throw new Error("ledger insert failed: " + insErr.message);

  return { queued: inserted?.length ?? 0, skipped, disabled: false };
}

// ---------------------------------------------------------------------
// PHASE 2 — DISPATCH
//
// SEAM: sendEmail() is the only place that talks to a provider. Adding
// WhatsApp means a sibling function and a switch on row.channel —
// nothing above this line changes.
//
// NOTE: an Edge Function `send-notification` already exists and owns
// the verified Resend domain. Reusing it would be better than a second
// send path. Its request contract has not been read, so this calls
// Resend directly for now. READ IT AND SWITCH before treating this as
// finished.
// ---------------------------------------------------------------------

function renderEmail(row: Record<string, unknown>) {
  const th = row.threshold_days as number;
  const title = row.task_title as string;
  const due = row.due_date as string;

  const when = th > 0
    ? `due in ${th} day${th === 1 ? "" : "s"}`
    : `${Math.abs(th)} day${Math.abs(th) === 1 ? "" : "s"} overdue`;

  const subject = th > 0
    ? `Reminder: "${title}" is ${when}`
    : `Overdue: "${title}" was due ${due}`;

  // Deliberately short and structured. WhatsApp Business templates take
  // variables, not prose, so keeping the shape tight now avoids a
  // rewrite when that channel arrives.
  const lines = [
    th > 0 ? `Your task is ${when}.` : `Your task is ${when}.`,
    ``,
    `Task: ${title}`,
    `Due: ${due}`,
    APP_URL ? `` : null,
    APP_URL ? `Open Taksyn: ${APP_URL}` : null,
  ].filter((l) => l !== null);

  return { subject, text: lines.join("\n") };
}

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
    .from("reminder_ledger")
    .select("*")
    .in("status", ["queued", "failed"])
    .lt("attempts", 3)
    .order("queued_at", { ascending: true })
    .limit(200);
  if (error) throw new Error("pending read failed: " + error.message);

  let sent = 0, failed = 0;

  for (const row of pending ?? []) {
    if (row.channel !== "email") continue; // whatsapp: not yet

    try {
      // Address resolved NOW, not from tasks.assigned_user_email, which
      // is a denormalised snapshot and goes stale when a user changes
      // their address.
      const { data: prof } = await db
        .from("profiles")
        .select("email")
        .eq("id", row.recipient_user_id)
        .single();

      const to = prof?.email as string | undefined;
      if (!to) {
        await db.from("reminder_ledger").update({
          status: "skipped",
          skip_reason: "no email on profile",
          attempts: (row.attempts ?? 0) + 1,
        }).eq("id", row.id);
        log.push(`SKIP send id=${row.id} reason=no-email`);
        continue;
      }

      const { subject, text } = renderEmail(row);

      if (DRY_RUN) {
        log.push(`WOULD SEND to=${to} subj="${subject}"`);
        continue;
      }

      await sendEmail(to, subject, text);

      await db.from("reminder_ledger").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        recipient_address: to,
        attempts: (row.attempts ?? 0) + 1,
      }).eq("id", row.id);
      sent++;
    } catch (e) {
      await db.from("reminder_ledger").update({
        status: "failed",
        error: String(e).slice(0, 500),
        attempts: (row.attempts ?? 0) + 1,
      }).eq("id", row.id);
      failed++;
      log.push(`FAIL id=${row.id} ${String(e).slice(0, 200)}`);
    }
  }

  return { sent, failed, considered: pending?.length ?? 0 };
}

// ---------------------------------------------------------------------

Deno.serve(async () => {
  const log: string[] = [];
  const startedAt = new Date().toISOString();

  try {
    if (DRY_RUN) log.push("*** DRY RUN — nothing will be written or sent ***");

    const scanResult = await scan(log);
    const dispatchResult = scanResult.disabled
      ? { sent: 0, failed: 0, considered: 0 }
      : await dispatch(log);

    const body = { ok: true, startedAt, dryRun: DRY_RUN, scan: scanResult, dispatch: dispatchResult, log };
    console.log(JSON.stringify(body));
    return new Response(JSON.stringify(body, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const body = { ok: false, startedAt, error: String(e), log };
    console.error(JSON.stringify(body));
    return new Response(JSON.stringify(body, null, 2), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
