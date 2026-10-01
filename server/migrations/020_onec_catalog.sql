-- 1C catalog import (R3.1): versioned snapshots, separate from clients exchange

CREATE TABLE IF NOT EXISTS onec_catalog_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (
    status IN ('running', 'success', 'partial', 'failed', 'validation_failed', 'skipped_unchanged')
  ),
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'apply')),
  trigger_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger_source IN ('manual', 'operator_job')),
  manifest_sha256 TEXT,
  source_byte_size BIGINT,
  core_applied BOOLEAN NOT NULL DEFAULT FALSE,
  commercial_ready BOOLEAN NOT NULL DEFAULT FALSE,
  applied_version_id UUID,
  product_count INTEGER,
  quarantine_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  report JSONB,
  CONSTRAINT onec_catalog_import_runs_finished_after_start CHECK (
    finished_at IS NULL OR finished_at >= started_at
  )
);

CREATE INDEX IF NOT EXISTS onec_catalog_import_runs_started_at_idx
  ON onec_catalog_import_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS onec_catalog_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  active_version_id UUID,
  last_successful_manifest_sha256 TEXT,
  apply_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  apply_blocked_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO onec_catalog_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS onec_catalog_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_sha256 TEXT NOT NULL UNIQUE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  product_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS onec_catalog_versions_active_idx
  ON onec_catalog_versions (is_active)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS onec_catalog_groups (
  version_id UUID NOT NULL REFERENCES onec_catalog_versions (id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  parent_code TEXT,
  PRIMARY KEY (version_id, code)
);

CREATE TABLE IF NOT EXISTS onec_catalog_sections (
  version_id UUID NOT NULL REFERENCES onec_catalog_versions (id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_code TEXT,
  PRIMARY KEY (version_id, code)
);

CREATE TABLE IF NOT EXISTS onec_catalog_storages (
  version_id UUID NOT NULL REFERENCES onec_catalog_versions (id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (version_id, code)
);

CREATE TABLE IF NOT EXISTS onec_catalog_price_types (
  version_id UUID NOT NULL REFERENCES onec_catalog_versions (id) ON DELETE CASCADE,
  price_type_code TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (version_id, price_type_code)
);

CREATE TABLE IF NOT EXISTS onec_catalog_products (
  version_id UUID NOT NULL REFERENCES onec_catalog_versions (id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  group_code TEXT,
  activity TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  present_in_snapshot BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (version_id, code)
);

CREATE INDEX IF NOT EXISTS onec_catalog_products_version_code_idx
  ON onec_catalog_products (version_id, code);

CREATE TABLE IF NOT EXISTS onec_catalog_product_properties (
  version_id UUID NOT NULL,
  product_code TEXT NOT NULL,
  property_code TEXT NOT NULL,
  property_name TEXT NOT NULL,
  property_value TEXT NOT NULL,
  PRIMARY KEY (version_id, product_code, property_code),
  FOREIGN KEY (version_id, product_code)
    REFERENCES onec_catalog_products (version_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS onec_catalog_product_images (
  version_id UUID NOT NULL,
  product_code TEXT NOT NULL,
  image_path TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (version_id, product_code, sort_order),
  FOREIGN KEY (version_id, product_code)
    REFERENCES onec_catalog_products (version_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS onec_catalog_product_sections (
  version_id UUID NOT NULL,
  product_code TEXT NOT NULL,
  section_code TEXT NOT NULL,
  PRIMARY KEY (version_id, product_code, section_code),
  FOREIGN KEY (version_id, product_code)
    REFERENCES onec_catalog_products (version_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS onec_catalog_prices_staging (
  version_id UUID NOT NULL REFERENCES onec_catalog_versions (id) ON DELETE CASCADE,
  row_id BIGSERIAL,
  price_type_code TEXT NOT NULL,
  product_code TEXT NOT NULL,
  price_raw TEXT NOT NULL,
  price_numeric NUMERIC(18, 4),
  quarantined BOOLEAN NOT NULL DEFAULT FALSE,
  quarantine_reason TEXT,
  PRIMARY KEY (version_id, row_id)
);

CREATE TABLE IF NOT EXISTS onec_catalog_stock_staging (
  version_id UUID NOT NULL REFERENCES onec_catalog_versions (id) ON DELETE CASCADE,
  row_id BIGSERIAL,
  product_code TEXT NOT NULL,
  storage_code TEXT NOT NULL,
  quantity_raw TEXT NOT NULL,
  quantity_numeric NUMERIC(18, 4),
  quarantined BOOLEAN NOT NULL DEFAULT FALSE,
  quarantine_reason TEXT,
  PRIMARY KEY (version_id, row_id)
);

CREATE TABLE IF NOT EXISTS onec_catalog_stock_expected_staging (
  version_id UUID NOT NULL REFERENCES onec_catalog_versions (id) ON DELETE CASCADE,
  row_id BIGSERIAL,
  product_code TEXT NOT NULL,
  storage_code TEXT NOT NULL,
  quantity_raw TEXT NOT NULL,
  quantity_numeric NUMERIC(18, 4),
  expected_date_raw TEXT,
  expected_at TIMESTAMPTZ,
  expected_expired BOOLEAN NOT NULL DEFAULT FALSE,
  available_raw TEXT,
  quarantined BOOLEAN NOT NULL DEFAULT FALSE,
  quarantine_reason TEXT,
  PRIMARY KEY (version_id, row_id)
);

CREATE TABLE IF NOT EXISTS onec_catalog_quarantine (
  id BIGSERIAL PRIMARY KEY,
  version_id UUID NOT NULL REFERENCES onec_catalog_versions (id) ON DELETE CASCADE,
  layer TEXT NOT NULL CHECK (layer IN ('prices', 'stock', 'stock_expected')),
  reason_code TEXT NOT NULL,
  source_identifiers JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS onec_catalog_quarantine_version_idx
  ON onec_catalog_quarantine (version_id);

CREATE TABLE IF NOT EXISTS onec_catalog_product_presence (
  version_id UUID NOT NULL REFERENCES onec_catalog_versions (id) ON DELETE CASCADE,
  product_code TEXT NOT NULL,
  present_in_snapshot BOOLEAN NOT NULL,
  PRIMARY KEY (version_id, product_code)
);
