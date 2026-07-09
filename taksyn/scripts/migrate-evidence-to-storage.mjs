#!/usr/bin/env node
// migrate-evidence-to-storage.mjs
// -----------------------------------------------------------------------------
// Standalone migration: move base64 evidence images out of the `tasks` table and
// into the Supabase Storage `task-evidence` bucket, rewriting each entry from an
// inline base64 `url`/`photo` to a Storage `path`.
//
// SAFETY MODEL (read scripts/README.md before running):
//   • DRY RUN by default — writes NOTHING unless you pass --real.
//   • Idempotent — entries already carrying a `path` (and no base64) are skipped.
//   • Org NAME→ID resolution — the bucket path's first folder MUST be the org id;
//     tasks whose org can't be resolved to a real organisations.id are SKIPPED
//     (never guessed).
//   • Never deletes anything from Storage or the DB — only adds files + rewrites
//     evidence/subtasks base64 → path.
//   • Per-task try/catch — one bad task never aborts the whole run.
//
// Config comes from env vars (NEVER hardcode keys):
//   SUPABASE_URL                 e.g. https://hbsexcighvjeryumodsn.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service role key (bypasses RLS → sees all tasks)
//
// Usage:
//   node scripts/migrate-evidence-to-storage.mjs            # dry run (default)
//   node scripts/migrate-evidence-to-storage.mjs --dry-run  # dry run (explicit)
//   node scripts/migrate-evidence-to-storage.mjs --real     # actually write
// -----------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = 'task-evidence'

// ---- flags: default to the safe path (dry run) --------------------------------
const argv = process.argv.slice(2)
const REAL = argv.includes('--real')
if (REAL && argv.includes('--dry-run')) {
  console.error('Pass either --dry-run or --real, not both.')
  process.exit(1)
}
const DRY = !REAL // default safe: anything other than an explicit --real is a dry run

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env. Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  console.error('(Never hardcode keys — export them in your shell for this run.)')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ---- helpers ------------------------------------------------------------------
// evidence/subtasks are JSONB but the app persists them JSON.stringify'd and reads
// them via a parseSafe that accepts both a real array and a JSON string. Mirror that.
const parseSafe = (val, fallback = []) => {
  if (Array.isArray(val)) return val
  if (typeof val === 'string') { try { return JSON.parse(val) } catch { return fallback } }
  return fallback
}
const isB64 = (v) => typeof v === 'string' && v.startsWith('data:image')
const mimeOf = (d) => (d.split(',')[0].match(/data:([^;]+)/) || [])[1] || 'image/jpeg'
const extOf = (m) =>
  m === 'image/jpeg' ? 'jpg'
    : m === 'image/png' ? 'png'
    : m === 'image/webp' ? 'webp'
    : m === 'image/gif' ? 'gif'
    : m === 'image/svg+xml' ? 'svg'
    : (m.split('/')[1] || 'bin')
const b64Bytes = (d) => {
  const c = d.split(',')[1] || ''
  const pad = c.endsWith('==') ? 2 : c.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(c.length * 3 / 4) - pad)
}
const decode = (d) => Buffer.from((d.split(',')[1] || ''), 'base64')

async function main() {
  console.log(DRY ? '── DRY RUN — no changes written ──' : '── REAL RUN — writing to Storage + DB ──')
  console.log(`URL: ${SUPABASE_URL}  ·  bucket: ${BUCKET}`)
  console.log('')

  // 1) organisations → name→id map + id set (loaded once, for resolution below)
  const { data: orgs, error: orgErr } = await supabase.from('organisations').select('id, name')
  if (orgErr) { console.error('FATAL: could not load organisations:', orgErr.message); process.exit(1) }
  const orgIds = new Set()
  const nameToId = new Map()
  for (const o of (orgs || [])) {
    if (o?.id != null) orgIds.add(String(o.id))
    if (o?.name) nameToId.set(String(o.name), String(o.id))
  }
  console.log(`Loaded ${orgs?.length || 0} organisations.`)

  // Fetch all tasks
  const { data: tasks, error: taskErr } = await supabase.from('tasks').select('id, org, evidence, subtasks')
  if (taskErr) { console.error('FATAL: could not load tasks:', taskErr.message); process.exit(1) }
  console.log(`Loaded ${tasks?.length || 0} tasks.`)
  console.log('')

  let gFound = 0, gMig = 0, gSkip = 0, gErr = 0, gBytes = 0
  let gUnresolved = 0, gOrgFromName = 0, gOrgAsIs = 0, gDupSkipped = 0
  const seenIds = new Set()
  // Task ids we have already run a DB update for this run. The tasks table has no PK, so a duplicate
  // id would make .update().eq('id', tid) hit BOTH rows — we refuse to update an id twice (clobber guard).
  const migratedIds = new Set()

  for (const task of (tasks || [])) {
    const tid = task?.id
    if (seenIds.has(tid)) {
      console.warn(`WARNING: duplicate task id seen: ${tid} (table lacks a PK? processing again defensively)`)
    }
    seenIds.add(tid)

    let tFound = 0, tMig = 0, tSkip = 0, tBytes = 0
    try {
      // 2) ORG NAME→ID RESOLUTION — never guess. Unresolved orgs are a safety stop.
      const rawOrg = task.org == null ? '' : String(task.org)
      let resolvedOrgId = null
      let orgWasName = false
      if (orgIds.has(rawOrg)) {
        resolvedOrgId = rawOrg // already an id
      } else if (nameToId.has(rawOrg)) {
        resolvedOrgId = nameToId.get(rawOrg) // resolved a NAME → id
        orgWasName = true
      }
      if (!resolvedOrgId) {
        gUnresolved++
        console.log(`TASK ${tid}: UNRESOLVED ORG "${rawOrg}" — skipped (no organisations.id or .name match)`)
        continue
      }
      if (orgWasName) gOrgFromName++; else gOrgAsIs++

      const newEvidence = parseSafe(task.evidence)
      const newSubtasks = parseSafe(task.subtasks)
      let changed = false

      // 3a) evidence[] — base64 in a `url` field (or a legacy bare string)
      if (Array.isArray(newEvidence)) {
        for (let i = 0; i < newEvidence.length; i++) {
          const e = newEvidence[i]
          const b64 = isB64(e) ? e : (e && typeof e === 'object' && isB64(e.url) ? e.url : null)
          const hasPath = e && typeof e === 'object' && !!e.path
          if (!b64) { if (hasPath) tSkip++; continue } // already migrated → skip
          tFound++
          const bytes = b64Bytes(b64); tBytes += bytes
          const mime = mimeOf(b64)
          const filename = `migrated_${Date.now()}_${i}.${extOf(mime)}`
          const plannedPath = `${resolvedOrgId}/${tid}/${filename}`
          if (DRY) {
            console.log(`  DRY evidence[${i}] ~${bytes}B → ${plannedPath} (org ${orgWasName ? 'from NAME' : 'as-is'})`)
          } else {
            const { error: upErr } = await supabase.storage.from(BUCKET)
              .upload(plannedPath, decode(b64), { contentType: mime, upsert: false })
            if (upErr) throw new Error(`upload evidence[${i}]: ${upErr.message}`)
            const base = (e && typeof e === 'object') ? { ...e } : {}
            delete base.url // drop base64, keep ts/by/by_id/role
            newEvidence[i] = { ...base, path: plannedPath }
            tMig++; changed = true
            console.log(`  OK  evidence[${i}] ~${bytes}B → ${plannedPath}`)
          }
        }
      }

      // 3b) subtasks[].photo — base64 in photo (object.url or a legacy bare string)
      if (Array.isArray(newSubtasks)) {
        for (let j = 0; j < newSubtasks.length; j++) {
          const s = newSubtasks[j]
          if (!s || typeof s !== 'object') continue
          const photo = s.photo
          const b64 = isB64(photo) ? photo : (photo && typeof photo === 'object' && isB64(photo.url) ? photo.url : null)
          const hasPath = photo && typeof photo === 'object' && !!photo.path
          if (!b64) { if (hasPath) tSkip++; continue } // already migrated → skip
          tFound++
          const bytes = b64Bytes(b64); tBytes += bytes
          const mime = mimeOf(b64)
          const filename = `migrated_${Date.now()}_sub${j}.${extOf(mime)}`
          const plannedPath = `${resolvedOrgId}/${tid}/${filename}`
          if (DRY) {
            console.log(`  DRY subtasks[${j}].photo ~${bytes}B → ${plannedPath} (org ${orgWasName ? 'from NAME' : 'as-is'})`)
          } else {
            const { error: upErr } = await supabase.storage.from(BUCKET)
              .upload(plannedPath, decode(b64), { contentType: mime, upsert: false })
            if (upErr) throw new Error(`upload subtasks[${j}].photo: ${upErr.message}`)
            const basePhoto = (photo && typeof photo === 'object') ? { ...photo } : {}
            delete basePhoto.url // drop base64, keep ts/by/by_id/role
            newSubtasks[j] = { ...s, photo: { ...basePhoto, path: plannedPath } }
            tMig++; changed = true
            console.log(`  OK  subtasks[${j}].photo ~${bytes}B → ${plannedPath}`)
          }
        }
      }

      // 4) REAL RUN only: one COLUMN-SCOPED update per task, only if something changed.
      // Written JSON.stringify'd to match how the app persists these JSONB columns (its reader
      // parseSafe accepts both, so migrated rows stay identical in shape to app-written rows).
      if (!DRY && changed) {
        if (migratedIds.has(tid)) {
          // Never update an id twice — on a PK-less table .eq('id', tid) would clobber both rows.
          gDupSkipped++
          console.log(`TASK ${tid} DUPLICATE ID — DB UPDATE SKIPPED (no PK, refusing to clobber)`)
        } else {
          const { error: updErr } = await supabase.from('tasks')
            .update({ evidence: JSON.stringify(newEvidence), subtasks: JSON.stringify(newSubtasks) })
            .eq('id', tid)
          if (updErr) throw new Error(`db update: ${updErr.message}`)
          migratedIds.add(tid)
        }
      }

      if (tFound > 0 || tSkip > 0) {
        console.log(`TASK ${tid}: ${tFound} found, ${tMig} migrated, ${tSkip} skipped, ~${tBytes}B`)
      }
      gFound += tFound; gMig += tMig; gSkip += tSkip; gBytes += tBytes
    } catch (e) {
      // 6) robustness: log and continue to the next task.
      gErr++
      console.log(`TASK ${tid} ERROR: ${e?.message || e}`)
    }
  }

  // 7) report
  console.log('')
  console.log('── GRAND TOTAL ──')
  console.log(`tasks: ${tasks?.length || 0}  ·  org as-is: ${gOrgAsIs}  ·  org from NAME: ${gOrgFromName}  ·  UNRESOLVED ORG: ${gUnresolved}`)
  console.log(`images found: ${gFound}  ·  migrated: ${gMig}  ·  skipped(already): ${gSkip}  ·  duplicate-id updates skipped: ${gDupSkipped}  ·  task errors: ${gErr}  ·  ~${gBytes}B`)
  console.log(DRY
    ? '(DRY RUN — nothing was written. Inspect the output, then re-run with --real to apply.)'
    : '(REAL RUN complete.)')
}

main().catch((e) => { console.error('FATAL:', e?.message || e); process.exit(1) })
