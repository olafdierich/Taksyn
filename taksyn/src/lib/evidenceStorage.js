import { supabase } from '../supabase'

// Upload one evidence file to the private task-evidence bucket.
// Path convention: {orgId}/{taskId}/{filename}. Returns { path } (NOT a public URL).
export async function uploadEvidence(file, orgId, taskId) {
  const filename = `${Date.now()}_${file.name}`
  const path = `${orgId}/${taskId}/${filename}`
  const { error } = await supabase.storage.from('task-evidence').upload(path, file)
  if (error) throw error
  return { path }
}

// Upload one incident evidence file to the SAME private task-evidence bucket.
// Path convention: {orgId}/incidents/{incidentId}/{filename}. Returns { path }.
//
// Deliberately a sibling of uploadEvidence rather than a shared core: that
// function is live in production for task photo evidence and is not worth
// touching for four lines. The bucket policies key on path segment 1 (the org),
// so the extra "incidents" segment inherits the proven scoping and adds nothing
// to check. signedEvidenceUrl reads these paths unchanged.
export async function uploadIncidentEvidence(file, orgId, incidentId) {
  const filename = `${Date.now()}_${file.name}`
  const path = `${orgId}/incidents/${incidentId}/${filename}`
  const { error } = await supabase.storage.from('task-evidence').upload(path, file)
  if (error) throw error
  return { path }
}

// Resolve a stored path to a short-lived signed URL for reading (private bucket).
export async function signedEvidenceUrl(path, expiresInSeconds = 28800) {
  const { data, error } = await supabase.storage
    .from('task-evidence')
    .createSignedUrl(path, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}
