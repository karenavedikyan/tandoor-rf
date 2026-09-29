-- R1.5: scheduled exchange state and extended import journal fields

CREATE TABLE IF NOT EXISTS onec_exchange_state (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  last_checked_at TIMESTAMPTZ,
  last_checked_sha256 TEXT,
  last_successful_apply_at TIMESTAMPTZ,
  last_successful_apply_sha256 TEXT,
  accepted_baseline_sha256 TEXT,
  last_source_modified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT onec_exchange_state_singleton CHECK (id = 1)
);

INSERT INTO onec_exchange_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE onec_client_import_runs DROP CONSTRAINT IF EXISTS onec_client_import_runs_mode_check;
ALTER TABLE onec_client_import_runs ADD CONSTRAINT onec_client_import_runs_mode_check
  CHECK (mode IN ('dry_run', 'apply', 'scheduled_check'));

ALTER TABLE onec_client_import_runs ADD COLUMN IF NOT EXISTS trigger_source TEXT;
ALTER TABLE onec_client_import_runs DROP CONSTRAINT IF EXISTS onec_client_import_runs_trigger_source_check;
ALTER TABLE onec_client_import_runs ADD CONSTRAINT onec_client_import_runs_trigger_source_check
  CHECK (trigger_source IS NULL OR trigger_source IN ('manual', 'scheduled', 'operator_job'));

ALTER TABLE onec_client_import_runs ADD COLUMN IF NOT EXISTS stage TEXT;
ALTER TABLE onec_client_import_runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

REVOKE ALL ON onec_exchange_state FROM PUBLIC;
