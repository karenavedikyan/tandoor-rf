-- Additive raw evidence + active pointers. No existing business/access table is reset.
CREATE TABLE IF NOT EXISTS onec_manual_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint CHAR(64) NOT NULL UNIQUE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  operator_job_id UUID,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  issue_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS onec_manual_files (
  batch_id UUID NOT NULL REFERENCES onec_manual_batches(id),
  file_key TEXT NOT NULL,
  source_name TEXT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  source_bytes BYTEA NOT NULL,
  row_count INTEGER NOT NULL,
  PRIMARY KEY(batch_id, file_key)
);
CREATE TABLE IF NOT EXISTS onec_manual_records (
  batch_id UUID NOT NULL REFERENCES onec_manual_batches(id),
  file_key TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_guid UUID,
  record JSONB NOT NULL,
  PRIMARY KEY(batch_id, file_key, row_index)
);
CREATE INDEX IF NOT EXISTS onec_manual_records_entity
  ON onec_manual_records(batch_id, entity_kind, entity_guid);
CREATE TABLE IF NOT EXISTS onec_manual_issues (
  batch_id UUID NOT NULL REFERENCES onec_manual_batches(id),
  issue_key TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_guid UUID,
  file_key TEXT NOT NULL,
  field_name TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  row_indices JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY(batch_id, issue_key)
);
CREATE INDEX IF NOT EXISTS onec_manual_issues_entity
  ON onec_manual_issues(batch_id, entity_kind, entity_guid);
CREATE TABLE IF NOT EXISTS onec_manual_state (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id = 1),
  batch_id UUID REFERENCES onec_manual_batches(id),
  checked_at TIMESTAMPTZ
);
INSERT INTO onec_manual_state(id) VALUES(1) ON CONFLICT DO NOTHING;
-- Retained objects not present in a later file retain their last successful diagnostics.
CREATE TABLE IF NOT EXISTS onec_manual_object_versions (
  entity_kind TEXT NOT NULL,
  entity_guid UUID NOT NULL,
  file_key TEXT NOT NULL,
  batch_id UUID NOT NULL REFERENCES onec_manual_batches(id),
  PRIMARY KEY(entity_kind, entity_guid, file_key)
);
