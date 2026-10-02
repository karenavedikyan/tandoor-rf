-- R1.2-prep: extended all_clients.json snapshot fields (additive only)

ALTER TABLE onec_clients
  ADD COLUMN IF NOT EXISTS is_holding BOOLEAN,
  ADD COLUMN IF NOT EXISTS guid_regional_manager UUID,
  ADD COLUMN IF NOT EXISTS name_regional_manager TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guid_hardware_manager UUID,
  ADD COLUMN IF NOT EXISTS name_hardware_manager TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guid_head_sales UUID,
  ADD COLUMN IF NOT EXISTS name_head_sales TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS extended_format_version TEXT,
  ADD COLUMN IF NOT EXISTS extended_source_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS extended_snapshot JSONB;

ALTER TABLE onec_client_import_runs
  ADD COLUMN IF NOT EXISTS source_format_version TEXT,
  ADD COLUMN IF NOT EXISTS extended_diagnostics JSONB;

CREATE INDEX IF NOT EXISTS onec_clients_is_holding_idx
  ON onec_clients (is_holding)
  WHERE is_holding IS TRUE;

CREATE INDEX IF NOT EXISTS onec_clients_extended_format_idx
  ON onec_clients (extended_format_version)
  WHERE extended_format_version IS NOT NULL;

-- Extended format links holdings by GUID; name_holding may be omitted on child rows.
ALTER TABLE onec_clients DROP CONSTRAINT IF EXISTS onec_clients_holding_pair;
ALTER TABLE onec_clients ADD CONSTRAINT onec_clients_holding_pair CHECK (
  (guid_holding IS NULL AND name_holding = '')
  OR guid_holding IS NOT NULL
);
