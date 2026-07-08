# Taksyn Multi-Stage Task Engine — Design v0.6
**Status:** Design only. POST-PILOT build. Supersedes v0.2–v0.5.
**Reference use case:** Water testing (plumber test → manager approves → weeks later lab report → manager attaches → client_admin signs off).
**v0.4:** two-stream KPI model (performer vs reviewer).
**v0.5:** photo-storage promoted to prerequisite; reviewer-attribution fields; stage-aware overdue; unified `approveStage()` seam; "waiting on you" queue as requirement; schema-delta appendix (§11).
**v0.6 (code-grounded review):** explicit stage-status→task-status mapping + **stage-aware SLA auto-escalation** (§4a); **append-only `stage_reviews` log** so rejection/resubmit doesn't lose review history (§7e/§11); storage migration means **private bucket + signed URLs**, evidence shape becomes `{path,…}` signed on read (§9b/§11); **computed-not-stored KPI stated as an invariant** (§7).
**v0.6 reconciliation:** §3 brought into line with §11 — evidence is `{path,…}` (not `{url,…}`); review-timing fields removed from the stage object (they live in the `stage_reviews` log); §4a SLA start reads the open `stage_reviews` row, not a stage field. §3 and §11 are now the single consistent source of truth.
---
## 1. Core concept
A task carries an **ordered list of stages**. Each stage is a self-contained unit of work with its own performer, approver, evidence, status, and (optionally) deadline. A "normal" task is simply a **one-stage task** — staging is opt-in and fully backward-compatible.
One compliance obligation = a chain of stages, done by different people at different levels, each independently completed and approved, with evidence attachable at each stage (including evidence that arrives much later).
---
## 2. The six settled decisions
1. **KPI credit is per-stage, fired at stage approval.** The performer of a stage is credited the moment *that stage* is approved — not when the whole task closes.
2. **A distinct `awaiting_stage` status** covers the (possibly long) wait for a later stage's input, keeping the task out of overdue counts and daily nagging.
3. **Each stage's performer attaches that stage's evidence** (worker OR manager OR whoever the stage names), with timestamp + name on every attachment.
4. **Each later stage carries its own deadline** (compliance flag) so a never-arriving document eventually surfaces.
5. **Staging is opt-in.** Existing single-stage tasks are unchanged — a normal task is a one-stage task under the hood.
6. **A rejected stage bounces back to its performer to redo**; KPI credit is withheld until re-approval.
---
## 3. Stage model
Each stage holds:
| Field | Meaning |
|---|---|
| `stage_order` | Position in the chain (1, 2, 3…) |
| `performer_id` / `performer_name` | Who does this stage |
| `approver_role` | Who signs it off (from the ladder: worker → supervisor → manager → client_admin) |
| `evidence[]` | Attributed evidence for this stage: `{path, ts, by, by_id, role}` — `path` = private-bucket object key, signed to a short-lived URL on read (§9b). NOT base64, NOT a durable public URL. |
| `status` | `pending` → `awaiting_review` → `approved` (or `rejected` → back to `pending`) |
| `due_date` (optional) | This stage's own deadline; if set and passed while unmet, flags as a compliance concern |
| `completed_at` | When the performer submitted the stage (performer clock) |
| `approved_at` | When approval finalised (audit) |
| `kpi_credited_to` | Set at approval = the performer, for performer-KPI attribution (a marker, not a counter — see §7f) |
The **task** gains: `stages[]`, a derived `current_stage` pointer, and `is_staged` (bool, **derived on write** from `stages?.length > 1` so it can never disagree with `stages[]`).
> **Review timing/attribution does NOT live on the stage.** It lives in the append-only `stage_reviews` log (§7e / §11) — one row per review action — so a rejected-then-resubmitted stage keeps every round's turnaround. The single source of truth for "who reviewed this stage, when, with what outcome" is `stage_reviews`, never fields on the stage object. Reviewer turnaround (§7b) is derived from that log.
---
## 4. Task-level status (with staging)
Existing statuses are unchanged for single-stage tasks. Staged tasks add one:
- **`awaiting_stage`** — a prior stage is approved, but the current stage has no evidence / isn't ready yet (e.g. waiting for the lab report). NOT overdue, NOT in-progress. Excluded from overdue counts. If the current stage has a `due_date` that passes while still `awaiting_stage`, THEN it flags (compliance concern), otherwise it waits quietly.
> **Overdue must become STAGE-AWARE (code impact).** Commit `4672db9` made dashboard overdue *computed* from `due_date` (not stored status): `status==='pending' && due_date < today`. For a **staged** task, the governing deadline is the **current stage's** `due_date`, not the task's. If the overdue computation keeps reading `task.due_date`, an `awaiting_stage` task whose *task* due_date has passed (but whose *current stage* deadline hasn't) will mis-flag. So the overdue/alert computation (the exact code from the `4672db9` session) must, for staged tasks, read `currentStage.due_date` instead of `task.due_date`. One concept, but it touches the overdue path directly.
## 4a. Explicit stage-status → task-status mapping
Escalation and dashboards read *task* status, so the derivation from stages must be stated, not implied:
- **Task status = the current stage's status** (`pending` / `awaiting_review` / `rejected`) …
- **…except `awaiting_stage`**, which applies when the current stage is `pending` **AND** a prior stage was approved (i.e. "advanced to this stage, performer hasn't started it yet" — the weeks-long lab-report wait).
- Task is `approved`/`completed` only when the **last** stage is approved.
> **SLA auto-escalation must also become stage-aware (the twin of the overdue point, more code-invasive).** The existing SLA auto-escalation loop in `loadTasks` escalates tasks stuck in `awaiting_review` past the SLA window, reading `task.submitted_at`. For staged tasks it must instead act on the *stage* being in review, and measure from the **current open review** = the latest `stage_reviews` row for that stage with `reviewed_at IS NULL`; that row's `review_queued_at` is the SLA clock start. Otherwise it never sees a stage awaiting review, or measures from the wrong timestamp. Treat this identically to the stage-aware overdue change; they're twins.
---
## 5. Lifecycle — the water-testing walkthrough
**Template (2 stages):**
| | Stage 1 | Stage 2 |
|---|---|---|
| Performer | Plumber (worker) | Manager |
| Evidence | Receipt photo | Lab report (delayed) |
| Approver | Manager | Client_admin |
| Deadline | task due date | e.g. test date + 30 days |
| KPI credit on approval | → Plumber | → Manager |
**Flow:**
1. Plumber does the test, attaches receipt → **stage 1 = `awaiting_review`**.
2. Manager **approves stage 1** → **plumber KPI-credited now**; stage 1 = `approved`. Task advances to stage 2 (no evidence yet) → **task = `awaiting_stage`**.
3. Weeks pass. Task sits in `awaiting_stage` — off the overdue radar. Stage 2's 30-day deadline is the only thing that could flag it.
4. Lab report arrives. Manager attaches it (timestamp + manager name) → **stage 2 = `awaiting_review`**.
5. Client_admin **approves stage 2** → **manager KPI-credited now**; stage 2 = `approved`. Last stage → **task = `approved`/`completed`**.
**Rejection branch:** if the manager rejects stage 1 (bad receipt), stage 1 → `rejected` → back to `pending` for the plumber to redo. No KPI credit until re-approved. Same pattern at any stage.
---
## 6. Backward compatibility (critical)
- A task with no stages defined behaves EXACTLY as today (single implicit stage: performer = assignee, approver = existing approval path).
- `is_staged=false` tasks never touch the new status or per-stage logic.
- Migration: existing tasks need no data change — the engine treats absence of `stages[]` as single-stage.
---
## 7. KPI implications — TWO SEPARATE STREAMS
A manager (or supervisor) does two different KPI-bearing things: they **review the worker's stage** AND they **perform later stages** themselves. These are tracked as **two distinct KPIs**, never blended — otherwise someone could look "productive" by rubber-stamping approvals without doing their own work, or vice versa.
### 7a. Performer KPI — "did you complete your assigned work?"
- Fires **per stage, at that stage's approval**, crediting the stage's `performer_id`.
- Measured against the stage's own deadline (on-time completion, to standard).
- A daily/one-off single-stage task credits exactly as today (one stage, one approval, one credit to the performer).
### 7b. Reviewer KPI — "did you review your team's work promptly?"
- **Measures review SPEED / turnaround** (SLA-based) — how quickly a reviewer clears the reviews queued to them. Builds directly on the existing SLA-breach concept (a review is "breached" if not actioned within the priority's SLA window).
- Fires when the reviewer **completes the review** (approve or reject) of a stage.
- **Applies to SUPERVISORS and MANAGERS only. NOT client_admin.**
### 7c. Why client_admin is exempt (deliberate)
Client_admin is the **terminal authority** (final sign-off, often org owner/delegate), not a performance-managed middle-review layer. Holding them to a review-speed KPI doesn't fit their role. **Consequence to accept consciously:** in the water-testing flow the client_admin approves stage 2, and that approval is NOT SLA-tracked — if a client_admin sits on a final sign-off, it won't ding any reviewer KPI. If sign-off delays ever need visibility, use a simple *non-scored* "pending client_admin sign-off" age indicator, not a graded KPI. (Optional, not needed for v1.)
### 7d. Water-testing KPI map
| Person | Act | KPI stream | SLA-tracked? |
|---|---|---|---|
| Plumber | performs stage 1 | **performer** | yes (stage deadline) |
| Manager | reviews/approves stage 1 | **reviewer** | ✅ yes (review turnaround SLA) |
| Manager | performs stage 2 (attaches report) | **performer** | yes (stage 2 deadline) |
| Client_admin | approves stage 2 (final) | — | ❌ exempt (no reviewer KPI) |
- Connects to the leave-accountability principle: every stage has ONE clear accountable/credited performer; every managed review has ONE accountable reviewer.
- **Watch:** the recurring per-occurrence redesign (top post-pilot item) and this must share a coherent performer-KPI model — build order matters (see §9).
### 7e. Review history must be append-only (rejection/resubmit safety)
A stage can be rejected → back to `pending` → resubmitted → reviewed *again*. If reviewer turnaround lived in single overwriteable stage fields (`review_queued_at`/`reviewed_at`), the resubmission would **overwrite round 1**, under-counting a manager who genuinely reviewed twice. Instead, use an **append-only `stage_reviews` log** — one row per review action — mirroring the existing append-only `checklist_completions` pattern. Both KPIs derive from this log; the stage object stays lean. (Schema in §11.)
### 7f. INVARIANT — KPIs are computed, never stored counters
Performer and reviewer KPIs are **derived** (from `approved_at` / the `stage_reviews` log), not incremented counters. This is what makes rejection/re-approval safe: a re-approval just adds/updates timestamps and recomputation stays correct — there is **no double-credit ledger to reverse**. `kpi_credited_to` is a pure **attribution marker**, not mutable state. **Do not** "optimize" KPIs into stored counters — the moment you do, idempotency under rejection/resubmit is lost. Treat this as a hard invariant.
---
## 8. EQ / architecture guardrails (carry forward)
- New fields (`stages[]`, per-stage assignee/approver/evidence/status) must flow through the **fetch+aggregate seam** produced by the App.jsx component split — EQ reads them there.
- Additive schema only — don't rename/restructure existing task columns EQ already reads.
- Preserve the `assigned_by ≠ assigned_to` handoff signal; per-stage performers are a richer version of the same signal.
- Role names stay identical (worker/supervisor/manager/client_admin/super_admin).
---
## 9. Build ordering (why this is POST-PILOT)
This touches the data model, approval flow, evidence system, AND KPI calculation simultaneously — exactly what the pilot freeze exists to keep out. Recommended sequence:
1. **Pilot ends.**
2. **App.jsx component split** first (produces the fetch+aggregate seam; reduces the risk of editing a 13k-line monolith). **Collapse the duplicated approval path here** — see §9a.
3. **Photo-storage migration — PREREQUISITE, not deferral (§9b).** Base64-in-jsonb → Supabase Storage + URL references, BEFORE multi-stage.
4. **Recurring per-occurrence redesign** (settles the performer-KPI/occurrence model this shares).
5. **Reviewer-attached evidence** — the smallest, independently-useful building block (worker OR reviewer attaches attributed evidence). Ship alone first, **already writing to object storage** so multi-stage inherits small rows.
6. **Full multi-stage engine** on top, opt-in, water-testing as the reference template.
7. This same primitive later powers CAPA / audits / approval workflows / dependency chains (QMS roadmap).
### 9a. Unify the approval path before staging it
This session proved approval is **duplicated**: `TasksView` approves via `update(sel.id,{status:'approved'})`, while `EvidenceView` has its own `approve()/reject()` doing a *direct* `supabase.from('tasks').update(...)`. Per-stage approval means every one of those sites needs stage awareness. **Collapse them into a single `approveStage(taskId, stageIndex)` / `rejectStage(...)` seam during the component split (§9.2)** so multi-stage patches ONE place, not N. (This is also the seam that must set `review_queued_at`/`reviewed_by_id`/`reviewed_at` and fire per-stage KPI credit.)
### 9b. Photo storage is a hard prerequisite (grounded in this session)
Rows already hit **~651 KB** because `evidence`/`subtasks` hold **base64 photos in jsonb** — the direct cause of this session's full-table-pull performance saga. Multi-stage makes `stages[]` a **third fat jsonb column with nested `evidence[]` arrays**, multiplying evidence volume by the number of stages. The list fetch (`loadTasks select('*')`) we deliberately did NOT trim (because `EvidenceView` reads `t.evidence`) would balloon further, and per-performer KPI aggregation that scans every task's every stage's every evidence array gets heavier still. **Therefore: migrate photos base64-jsonb → Supabase Storage BEFORE building multi-stage.** Ship reviewer-attached evidence (step 5) already writing to object storage, so the stage engine inherits small rows instead of amplifying the bloat.
> **This is auth work, not "just swap base64 for a URL."** Today RLS is row-level on `tasks`, and evidence rides *inside* the row — so task visibility **is** photo visibility, for free. Once photos live in a Storage bucket that coupling breaks: the bucket needs its **own access policy** mirroring task/org visibility. Compliance photos (care-sector, sensitive) should be a **private bucket + signed URLs**. So `evidence[].url` becomes a stored **`path`** (bucket object key) that is **resolved to a short-lived signed URL at read time** — NOT a durable public URL. Evidence shape becomes `{ path, ts, by, by_id, role }` (sign on read). This also serves the care-sector privacy posture (controlled, non-public access to resident/patient-adjacent imagery). Don't let the "swap base64 for a URL" framing hide the bucket-policy + signed-URL work.
---
## 10. "Waiting on you" queue — REQUIREMENT (not optional)
The entire value proposition depends on the stage-2 performer **remembering** to attach a document that lands *weeks later*. `awaiting_stage` deliberately removes the task from overdue nagging — so without a dedicated surface, delayed documents will silently rot. This is **load-bearing for the reference use case**, not polish. Required for v1:
- A **"waiting on your input"** view/queue for each user, listing stages where they are the performer and the stage is ready for their input (prior stage approved, `awaiting_stage`).
- A **stage-ready notification** when a stage becomes the current stage and its performer differs from the previous stage's performer (e.g. "The water test was approved — attach the lab report when it arrives").
- Optional: a nudge as the stage's own `due_date` approaches (compliance deadline, not daily nag).
## 10a. Open questions for build time (not blocking design)
- Exact UI for defining stages at task creation (template picker vs manual chain builder).
- Whether stage templates are reusable org-level presets (likely yes — "water test" as a saved 2-stage template).
- Full notification matrix: who's told on stage ready / approved / rejected / deadline-near.
---
## 11. Additive schema delta (build-ready appendix)
**All additive — no renames, no restructures of columns EQ already reads.** A task with no `stages` behaves exactly as today.
### Task-level (jsonb, on `tasks`)
```
stages          jsonb   -- ordered array of stage objects (below); absent/null = single-stage legacy task
is_staged       boolean -- derived on write from (stages?.length > 1); cheap query filter, must never disagree with stages[]
```
`current_stage` is **derived, not stored** (first stage whose status ∉ {approved}).
### Stage object shape (elements of `stages[]`)
```
stage_order        int      -- 1,2,3…
performer_id       text     -- auth UUID (via authUserId(), never user-state)
performer_name     text
approver_role      text     -- worker|supervisor|manager|client_admin
evidence           array    -- [{ path, ts, by, by_id, role }]  ← path = private-bucket object key, signed to a short-lived URL on read (§9b). NOT base64, NOT a durable public URL.
status             text     -- pending | awaiting_review | approved | rejected
due_date           date     -- optional; the stage's own compliance deadline
completed_at       timestamptz  -- performer submitted (performer clock)
approved_at        timestamptz  -- finalised (audit)
kpi_credited_to    text         -- performer id, set at approval (attribution marker only — NOT a counter, see §7f)
```
> Reviewer turnaround is NOT stored on the stage (single fields would lose history on resubmit). It lives in the append-only `stage_reviews` log below (§7e).
### Append-only review log (new table, `stage_reviews`)
```
id                text/uuid
task_id           text        -- FK to tasks
stage_order       int         -- which stage
review_queued_at  timestamptz -- stage entered awaiting_review (SLA clock START)
reviewed_by_id    text        -- who reviewed (attribution)
reviewed_at       timestamptz -- review completed (SLA clock STOP)
outcome           text        -- approved | rejected
organisation_id   text        -- scoping, mirrors checklist_completions
```
One row **per review action** (a resubmission reviewed again = a second row). Mirrors the existing append-only `checklist_completions` pattern. Reviewer KPI = derived from this log; performer KPI = derived from stage `approved_at`. Both **computed, never stored counters** (§7f).
### KPI derivations (no stored KPI columns — computed; see §7f invariant)
- **Performer credit:** on stage approval → credit `performer_id`, measured vs stage `due_date`.
- **Reviewer turnaround:** derived from the `stage_reviews` log — `reviewed_at − review_queued_at` per row, attributed to `reviewed_by_id`; scored for supervisor/manager only, NOT client_admin (§7c). Every review action counts (resubmissions included).
### Audit
- Every stage completion, review (approve/reject), and evidence attach → `audit_log` entry (`event_type`, camelCase cols, JSON details) — consistent with existing audit approach.
### Migration notes
- No backfill needed: existing tasks have no `stages` → treated as single-stage.
- **Storage prerequisite (§9b):** `evidence[].path` must reference a private-bucket object (signed on read), not base64 and not a durable public URL, before this ships — otherwise `stages[]` amplifies the row-bloat this session fought.
