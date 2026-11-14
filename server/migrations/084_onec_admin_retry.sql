-- Additive metadata only. Existing jobs and business/access identities are untouched.
ALTER TABLE onec_import_jobs ADD COLUMN IF NOT EXISTS request_key UUID;
ALTER TABLE onec_import_jobs ADD COLUMN IF NOT EXISTS retry_of_job_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS onec_import_jobs_request_key
  ON onec_import_jobs(request_key) WHERE request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS onec_import_jobs_retry_of ON onec_import_jobs(retry_of_job_id)
  WHERE retry_of_job_id IS NOT NULL;
