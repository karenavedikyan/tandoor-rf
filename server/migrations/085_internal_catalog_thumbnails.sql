-- Derived media only. Immutable product snapshots and existing photo assets are untouched.
CREATE TABLE IF NOT EXISTS internal_catalog_thumbnails (
  snapshot_id UUID NOT NULL REFERENCES internal_catalog_snapshots(id),
  source_path TEXT NOT NULL,
  recipe TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'unavailable')),
  small_bytes BYTEA,
  small_sha256 TEXT,
  list_bytes BYTEA,
  list_sha256 TEXT,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (snapshot_id, source_path, recipe),
  CHECK (
    (status = 'unavailable' AND small_bytes IS NULL AND list_bytes IS NULL
      AND small_sha256 IS NULL AND list_sha256 IS NULL)
    OR
    (status = 'ready'
      AND small_bytes IS NOT NULL AND list_bytes IS NOT NULL
      AND small_sha256 IS NOT NULL AND list_sha256 IS NOT NULL
      AND octet_length(small_bytes) BETWEEN 1 AND 32768
      AND octet_length(list_bytes) BETWEEN 1 AND 131072
      AND small_sha256 ~ '^[a-f0-9]{64}$' AND list_sha256 ~ '^[a-f0-9]{64}$')
  )
);
