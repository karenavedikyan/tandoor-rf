-- 1C clients import schema (read-only source snapshot, no FK to users)

CREATE TABLE IF NOT EXISTS onec_clients (
  guid_client UUID PRIMARY KEY,
  name_client TEXT NOT NULL,
  guid_holding UUID,
  name_holding TEXT NOT NULL DEFAULT '',
  guid_manager UUID NOT NULL,
  name_manager TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  telephone JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_sha256 TEXT NOT NULL,
  first_imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT onec_clients_name_client_not_blank CHECK (BTRIM(name_client) <> ''),
  CONSTRAINT onec_clients_name_manager_not_blank CHECK (BTRIM(name_manager) <> ''),
  CONSTRAINT onec_clients_holding_pair CHECK (
    (guid_holding IS NULL AND name_holding = '')
    OR (guid_holding IS NOT NULL AND BTRIM(name_holding) <> '')
  ),
  CONSTRAINT onec_clients_telephone_is_array CHECK (jsonb_typeof(telephone) = 'array')
);

CREATE INDEX IF NOT EXISTS onec_clients_guid_manager_idx ON onec_clients (guid_manager);
CREATE INDEX IF NOT EXISTS onec_clients_guid_holding_idx ON onec_clients (guid_holding)
  WHERE guid_holding IS NOT NULL;

CREATE TABLE IF NOT EXISTS onec_client_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (
    status IN ('running', 'success', 'failed', 'validation_failed')
  ),
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'apply')),
  source_sha256 TEXT,
  source_byte_size INTEGER,
  source_record_count INTEGER,
  new_count INTEGER,
  changed_count INTEGER,
  unchanged_count INTEGER,
  error_code TEXT,
  CONSTRAINT onec_client_import_runs_finished_after_start CHECK (
    finished_at IS NULL OR finished_at >= started_at
  )
);

CREATE INDEX IF NOT EXISTS onec_client_import_runs_started_at_idx
  ON onec_client_import_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS onec_client_import_runs_success_idx
  ON onec_client_import_runs (finished_at DESC)
  WHERE status = 'success';
