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

// Resolve a stored path to a short-lived signed URL for reading (private bucket).
export async function signedEvidenceUrl(path, expiresInSeconds = 28800) {
  const { data, error } = await supabase.storage
    .from('task-evidence')
    .createSignedUrl(path, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}
