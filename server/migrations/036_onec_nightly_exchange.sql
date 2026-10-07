-- Nightly regular_update_bundle jobs: source on import jobs, window dedup, journal trigger.

ALTER TABLE onec_import_jobs
  ADD COLUMN IF NOT EXISTS job_source TEXT NOT NULL DEFAULT 'admin_manual';

ALTER TABLE onec_import_jobs
  DROP CONSTRAINT IF EXISTS onec_import_jobs_job_source_check;

ALTER TABLE onec_import_jobs
  ADD CONSTRAINT onec_import_jobs_job_source_check
  CHECK (job_source IN ('admin_manual', 'nightly'));

ALTER TABLE onec_import_jobs
  DROP CONSTRAINT IF EXISTS onec_import_jobs_apply_requirements_check;

ALTER TABLE onec_import_jobs
  ADD CONSTRAINT onec_import_jobs_apply_requirements_check
  CHECK (
    (
      kind = 'clients_snapshot'
      AND (
        mode = 'dry_run'
        OR (
          expected_sha256 IS NOT NULL
          AND expected_sha256 ~ '^[0-9a-f]{64}$'
        )
      )
    )
    OR (
      kind = 'regular_update_bundle'
      AND mode = 'apply'
      AND expected_sha256 IS NULL
      AND (
        (job_source = 'admin_manual' AND requested_by_user_id IS NOT NULL)
        OR (job_source = 'nightly' AND requested_by_user_id IS NULL)
      )
    )
  );

ALTER TABLE onec_exchange_state
  ADD COLUMN IF NOT EXISTS nightly_exchange_last_window TEXT;

ALTER TABLE onec_client_import_runs DROP CONSTRAINT IF EXISTS onec_client_import_runs_trigger_source_check;
ALTER TABLE onec_client_import_runs ADD CONSTRAINT onec_client_import_runs_trigger_source_check
  CHECK (
    trigger_source IS NULL
    OR trigger_source IN (
      'manual',
      'scheduled',
      'operator_job',
      'regular_update',
      'regular_update_nightly'
    )
  );
