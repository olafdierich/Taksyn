# Evidence migration — base64 → Supabase Storage

`migrate-evidence-to-storage.mjs` moves inline base64 evidence images out of the
`tasks` table (`evidence[].url` and `subtasks[].photo`) into the private
`task-evidence` Storage bucket, rewriting each entry from base64 to a Storage
`path` (attribution `ts`/`by`/`by_id`/`role` preserved).

> **Highest-stakes tool in this repo.** It eventually transforms real evidence
> data. **Always dry-run first and read the output before a real run.**

## Required env vars (never hardcode keys)

| Var | What |
| --- | --- |
| `SUPABASE_URL` | Project URL, e.g. `https://hbsexcighvjeryumodsn.supabase.co` (sandbox) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Service role** key — bypasses RLS so the script sees every task. Keep it secret; export it only for the run. |

Point these at the **sandbox** first. Only change them to the live project once
you have dry-run + real-run proven in the sandbox.

## How to run

Always from the `taksyn/` directory (so `@supabase/supabase-js` resolves):

```bash
# 1) DRY RUN (default — writes NOTHING). Inspect every planned path first.
export SUPABASE_URL="https://hbsexcighvjeryumodsn.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="…sandbox service role key…"
node scripts/migrate-evidence-to-storage.mjs            # or: --dry-run

# 2) REAL RUN — only after the dry-run output looks correct.
node scripts/migrate-evidence-to-storage.mjs --real
```

Anything other than an explicit `--real` is treated as a dry run.

## Safety guarantees

- **Dry-run by default** — no `--real`, no writes.
- **Idempotent** — entries that already have a `path` (and no base64) are skipped
  and counted as *skipped (already migrated)*. Re-running after a real run should
  report everything skipped, nothing migrated.
- **Org NAME→ID resolution** — the Storage path's first folder must be the org
  **id** (the bucket policy checks `org_members.org`, which holds ids). For each
  task: if `task.org` is already an `organisations.id` it's used as-is; else if it
  matches an `organisations.name` it's resolved to that id; else the task is
  **skipped as UNRESOLVED ORG** (never guessed). The report prints how many tasks
  used the id as-is vs resolved from a name, so you can confirm the name→id path
  was exercised.
- **Never deletes** — only uploads files and rewrites `evidence`/`subtasks`
  base64 → path. Storage files and DB rows are never removed. Uploads use
  `upsert: false` so an existing object is never overwritten.
- **Column-scoped writes** — a real run updates only `{ evidence, subtasks }` per
  task, one update per task, never the whole row.
- **Per-task isolation** — each task is wrapped in try/catch; an error logs
  `TASK <id> ERROR: <msg>` and the run continues to the next task.

## Recommended sequence

1. Dry-run against the **sandbox** → read the output, confirm planned paths and
   that org resolution looks right (as-is vs from-name counts, zero UNRESOLVED).
2. Real-run against the sandbox → verify images render in the app and re-running
   reports everything *skipped*.
3. Only then repeat (dry-run first!) against **live**.
