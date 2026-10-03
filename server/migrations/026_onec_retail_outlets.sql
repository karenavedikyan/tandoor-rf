-- Stable retail outlet identity registry (guid_store from 1C).
-- Parent linkage is authoritative; conflicts require explicit resolution.

CREATE TABLE IF NOT EXISTS onec_retail_outlets (
  guid_store UUID PRIMARY KEY,
  guid_client UUID NOT NULL REFERENCES onec_clients (guid_client) ON DELETE CASCADE,
  is_closed BOOLEAN,
  first_source_sha256 TEXT,
  last_source_sha256 TEXT,
  first_imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closure_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onec_retail_outlets_guid_client
  ON onec_retail_outlets (guid_client);
