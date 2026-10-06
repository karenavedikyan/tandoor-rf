-- Admin-triggered regular update jobs (bundle verify + apply via background worker).

ALTER TABLE onec_import_jobs
  DROP CONSTRAINT IF EXISTS onec_import_jobs_kind_check;

ALTER TABLE onec_import_jobs
  ADD CONSTRAINT onec_import_jobs_kind_check
  CHECK (kind IN ('clients_snapshot', 'regular_update_bundle'));

ALTER TABLE onec_import_jobs
  ADD COLUMN IF NOT EXISTS requested_by_user_id UUID REFERENCES users (id);

ALTER TABLE onec_import_jobs
  DROP CONSTRAINT IF EXISTS onec_import_jobs_mode_check;

ALTER TABLE onec_import_jobs
  ADD CONSTRAINT onec_import_jobs_mode_check
  CHECK (mode IN ('dry_run', 'apply'));

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'onec_import_jobs'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%expected_sha256%'
  LOOP
    EXECUTE format('ALTER TABLE onec_import_jobs DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

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
      AND requested_by_user_id IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS onec_import_jobs_regular_update_active_idx
  ON onec_import_jobs (requested_at DESC)
  WHERE kind = 'regular_update_bundle' AND status IN ('pending', 'running');
