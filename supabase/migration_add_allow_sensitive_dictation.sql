-- Add allow_sensitive_dictation column to incidents, tasks, issue_reports
-- Default false: mics hidden by default on sensitive information
-- Workers must explicitly toggle per-record to enable dictation

ALTER TABLE incidents ADD COLUMN allow_sensitive_dictation boolean DEFAULT false;
ALTER TABLE tasks ADD COLUMN allow_sensitive_dictation boolean DEFAULT false;
ALTER TABLE issue_reports ADD COLUMN allow_sensitive_dictation boolean DEFAULT false;

-- Verify the columns exist
SELECT 'incidents' as table_name, COUNT(*) as column_count 
FROM information_schema.columns 
WHERE table_name = 'incidents' AND column_name = 'allow_sensitive_dictation'
UNION ALL
SELECT 'tasks', COUNT(*) 
FROM information_schema.columns 
WHERE table_name = 'tasks' AND column_name = 'allow_sensitive_dictation'
UNION ALL
SELECT 'issue_reports', COUNT(*) 
FROM information_schema.columns 
WHERE table_name = 'issue_reports' AND column_name = 'allow_sensitive_dictation';
