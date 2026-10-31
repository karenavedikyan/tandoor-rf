-- Isolated, immutable JSON reference snapshots. Existing 1C/XML catalogue is untouched.
CREATE TABLE IF NOT EXISTS internal_catalog_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 TEXT NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  source_name TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  summary JSONB NOT NULL,
  product_count INTEGER NOT NULL CHECK (product_count > 0)
);
CREATE INDEX IF NOT EXISTS internal_catalog_snapshots_latest
  ON internal_catalog_snapshots(imported_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS internal_catalog_products (
  snapshot_id UUID NOT NULL REFERENCES internal_catalog_snapshots(id),
  guid UUID NOT NULL,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  section_guids UUID[] NOT NULL DEFAULT '{}',
  search_text TEXT NOT NULL,
  record JSONB NOT NULL,
  PRIMARY KEY(snapshot_id, guid)
);
CREATE INDEX IF NOT EXISTS internal_catalog_products_name
  ON internal_catalog_products(snapshot_id, name, guid);
