-- Source content fingerprint for image sync idempotency and stale-publication guards

ALTER TABLE onec_catalog_image_assets
  ADD COLUMN IF NOT EXISTS source_sha256 TEXT;

CREATE INDEX IF NOT EXISTS onec_catalog_image_assets_source_sha256_idx
  ON onec_catalog_image_assets (source_sha256);

CREATE TABLE IF NOT EXISTS onec_catalog_image_sync_cursor (
  catalog_version_id UUID PRIMARY KEY,
  next_source_path TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onec_catalog_image_sync_queue (
  catalog_version_id UUID NOT NULL,
  source_path TEXT NOT NULL,
  last_outcome TEXT NOT NULL CHECK (last_outcome IN ('pending', 'ready', 'failed', 'skipped')),
  last_error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (catalog_version_id, source_path)
);

CREATE INDEX IF NOT EXISTS onec_catalog_image_sync_queue_outcome_idx
  ON onec_catalog_image_sync_queue (catalog_version_id, last_outcome);
