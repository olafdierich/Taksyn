-- Applied to sandbox and live 22 Sep 2026.
-- Code fingerprints after: rate_and_approve_task b7542d4e1a,
-- tasks_supervisor_scope_guard 5587c2986a. Both environments match.
--
-- Ratings now live ONLY in task_rating_events. The task and occurrence rating
-- columns are emptied and the guard refuses any value written into them.
-- The guard requires the LATEST history entry to be a rating before approval,
-- and adds a 'cleared' entry when an approved task is un-approved.
-- The supervisor rules are unchanged in behaviour; select-into was removed
-- because the Supabase editor rewrites it.
--
-- Known and harmless: task_occurrences.rating_source reads 'server' after the
-- clear, stamped by the older occurrence guard. It identifies nobody.
-- The occurrence guard still requires quality_rating to approve an occurrence;
-- occurrence approval has no UI, so nothing currently reaches it.
--
-- The function bodies are as applied; see the session record for the full
-- text. This file keeps the clearing statements for reproducibility.

update tasks
   set quality_rating = null, rating_reason = null, rated_by_id = null,
       rated_by_name = null, rated_at = null, rating_source = null
 where quality_rating is not null or rating_reason is not null or rated_by_id is not null
    or rated_by_name is not null or rated_at is not null or rating_source is not null;

update task_occurrences
   set quality_rating = null, rating_reason = null, rated_by_id = null,
       rated_by_name = null, rated_at = null, rating_source = null
 where quality_rating is not null or rating_reason is not null or rated_by_name is not null;
