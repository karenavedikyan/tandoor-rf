-- Wholesale baseline replacement: quarantine records, archived clients, operator runs, live contract gate

ALTER TABLE onec_clients
  ADD COLUMN IF NOT EXISTS baseline_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS baseline_archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS baseline_archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS baseline_archive_source_sha256 CHAR(64);

ALTER TABLE onec_clients
  DROP CONSTRAINT IF EXISTS onec_clients_baseline_status_check;
ALTER TABLE onec_clients
  ADD CONSTRAINT onec_clients_baseline_status_check
  CHECK (baseline_status IN ('active', 'archived_baseline', 'quarantined'));

CREATE INDEX IF NOT EXISTS onec_clients_baseline_status_idx
  ON onec_clients (baseline_status);

COMMENT ON COLUMN onec_clients.baseline_status IS
  'active = in accepted wholesale baseline; archived_baseline = retained but hidden from working APIs; quarantined = excluded by operator manifest';

CREATE TABLE IF NOT EXISTS onec_client_quarantine_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guid_client UUID NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  quarantine_reason TEXT NOT NULL,
  related_guid UUID,
  manifest_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ,
  superseded_by_manifest_sha256 CHAR(64)
);

CREATE INDEX IF NOT EXISTS onec_client_quarantine_records_guid_idx
  ON onec_client_quarantine_records (guid_client);
CREATE INDEX IF NOT EXISTS onec_client_quarantine_records_source_idx
  ON onec_client_quarantine_records (source_sha256, manifest_sha256);

CREATE TABLE IF NOT EXISTS onec_baseline_replacement_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  plan_fingerprint CHAR(64),
  clients_source_sha256 CHAR(64),
  roster_source_sha256 CHAR(64),
  quarantine_manifest_sha256 CHAR(64),
  accepted_composition_sha256 CHAR(64),
  db_baseline_sha256 CHAR(64),
  extended_contract_confirmation_sha256 CHAR(64),
  plan_json JSONB,
  pre_apply_status_snapshot JSONB,
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  operator_note TEXT
);

ALTER TABLE onec_baseline_replacement_runs
  DROP CONSTRAINT IF EXISTS onec_baseline_replacement_runs_mode_check;
ALTER TABLE onec_baseline_replacement_runs
  ADD CONSTRAINT onec_baseline_replacement_runs_mode_check
  CHECK (mode IN ('dry_run', 'apply', 'rollback'));

CREATE TABLE IF NOT EXISTS onec_extended_contract_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clients_source_sha256 CHAR(64) NOT NULL,
  verification_fingerprint CHAR(64) NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  operator_reference TEXT NOT NULL,
  superseded_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS onec_extended_contract_confirmations_active_uq
  ON onec_extended_contract_confirmations (clients_source_sha256, verification_fingerprint)
  WHERE superseded_at IS NULL;
