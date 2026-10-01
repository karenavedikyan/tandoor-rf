-- Catalog image assets (R3.2 visual): controlled sync from configured source to local storage

CREATE TABLE IF NOT EXISTS onec_catalog_image_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_path TEXT NOT NULL,
  content_sha256 TEXT,
  storage_path TEXT,
  mime_type TEXT,
  byte_size BIGINT,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'failed', 'blocked')),
  last_error TEXT,
  source_byte_size BIGINT,
  prepared_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT onec_catalog_image_assets_source_path_unique UNIQUE (source_path)
);

CREATE INDEX IF NOT EXISTS onec_catalog_image_assets_status_idx
  ON onec_catalog_image_assets (status);

CREATE TABLE IF NOT EXISTS onec_catalog_image_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'apply')),
  status TEXT NOT NULL CHECK (
    status IN ('running', 'success', 'partial', 'failed', 'validation_failed')
  ),
  source_kind TEXT NOT NULL DEFAULT 'local_dir'
    CHECK (source_kind IN ('local_dir', 'ftp')),
  files_seen INTEGER NOT NULL DEFAULT 0,
  files_prepared INTEGER NOT NULL DEFAULT 0,
  files_failed INTEGER NOT NULL DEFAULT 0,
  files_skipped INTEGER NOT NULL DEFAULT 0,
  bytes_processed BIGINT NOT NULL DEFAULT 0,
  error_code TEXT,
  report JSONB,
  CONSTRAINT onec_catalog_image_sync_runs_finished_after_start CHECK (
    finished_at IS NULL OR finished_at >= started_at
  )
);

CREATE INDEX IF NOT EXISTS onec_catalog_image_sync_runs_started_at_idx
  ON onec_catalog_image_sync_runs (started_at DESC);
