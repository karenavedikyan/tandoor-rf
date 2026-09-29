-- R1.5 review: exchange lifecycle fields and journal linkage

ALTER TABLE onec_exchange_state ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE onec_exchange_state ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
ALTER TABLE onec_exchange_state ADD COLUMN IF NOT EXISTS last_verified_sha256 TEXT;
ALTER TABLE onec_exchange_state ADD COLUMN IF NOT EXISTS apply_blocked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE onec_exchange_state ADD COLUMN IF NOT EXISTS apply_blocked_reason TEXT;

ALTER TABLE onec_client_import_runs ADD COLUMN IF NOT EXISTS parent_run_id UUID
  REFERENCES onec_client_import_runs(id);
ALTER TABLE onec_client_import_runs ADD COLUMN IF NOT EXISTS warning_count INTEGER;
ALTER TABLE onec_client_import_runs ADD COLUMN IF NOT EXISTS warnings JSONB;

CREATE INDEX IF NOT EXISTS onec_client_import_runs_parent_run_id_idx
  ON onec_client_import_runs (parent_run_id)
  WHERE parent_run_id IS NOT NULL;
