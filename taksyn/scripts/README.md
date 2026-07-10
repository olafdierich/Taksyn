# Evidence migration — base64 → Supabase Storage

`migrate-evidence-to-storage.mjs` moves inline base64 evidence images out of the
`tasks` table (`evidence[].url` and `subtasks[].photo`) into the private
`task-evidence` Storage bucket, rewriting each entry from base64 to a Storage
`path` (attribution `ts`/`by`/`by_id`/`role` preserved).

> **Highest-stakes tool in this repo.** It eventually transforms real evidence
> data. **ALWAYS dry-run first and read the output before a real run.**

## Required env vars (never hardcode keys)

| Var | What |
| --- | --- |
| `SUPABASE_URL` | Project URL, e.g. `https://hbsexcighvjeryumodsn.supabase.co` (sandbox) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Service role** key — bypasses RLS so the script sees every task. Keep it secret; export it only for the run. |

Point these at the **sandbox** first. Only change them to the live project once
you have dry-run + real-run proven in the sandbox.

## How to run

Run from the `taksyn/` directory so `@supabase/supabase-js` resolves from
`taksyn/node_modules`:

```bash
cd taksyn
export SUPABASE_URL="https://hbsexcighvjeryumodsn.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="…sandbox service role key…"

# 1) DRY RUN (default — writes NOTHING). Inspect every planned path first.
node scripts/migrate-evidence-to-storage.mjs            # or: --dry-run

# 2) REAL RUN — only after the dry-run output looks correct.
node scripts/migrate-evidence-to-storage.mjs --real
```

Anything other than an explicit `--real` is treated as a dry run.

## Safety guarantees

- **Dry-run by default** — no `--real`, no writes.
- **Idempotent** — entries that already have a `path` (and no base64) are skipped.
  Re-running after a real run reports everything skipped, nothing migrated.
- **Org NAME→ID resolution** — the Storage path's first folder must be the org
  **id**. Per task: `task.org` used as-is if it's an `organisations.id`; else
  resolved via `organisations.name`; else the task is **skipped as UNRESOLVED
  ORG** (never guessed). The report prints how many orgs were used as-is vs
  resolved from a name.
- **Duplicate-id safety** — the `tasks` table has no primary key. A pre-scan
  finds any id appearing more than once; those tasks are **skipped entirely in
  both modes** (logged loudly) so a later `.eq('id', id)` update can't clobber
  sibling rows.
- **Never deletes** — only uploads files (`upsert: false`) and rewrites
  `evidence`/`subtasks` base64 → path. Storage files and DB rows are never removed.
- **Column-scoped writes** — a real run updates only `{ evidence, subtasks }` per
  task, one update per task, never the whole row.
- **Per-task isolation** — each task is wrapped in try/catch; an error logs
  `TASK <id> ERROR:` and the run continues.

## Recommended sequence

1. **Dry-run against the sandbox** → read output; confirm planned paths and that
   org resolution looks right (as-is vs from-name counts, zero UNRESOLVED).
2. **Real-run against the sandbox** → verify images render in the app and a
   re-run reports everything *skipped*.
3. Only then repeat (**dry-run first!**) against **live**.
