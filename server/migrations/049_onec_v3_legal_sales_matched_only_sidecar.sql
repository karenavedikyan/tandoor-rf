-- Draft (not applied in production by this PR): sidecar for matched-only sales bundle import.
-- Unknown catalog GUID rows are NOT stored in the four line tables; counts live here.

CREATE TABLE IF NOT EXISTS onec_v3_legal_sales_import_quarantine_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_hash CHAR(64) NOT NULL,
  dataset TEXT NOT NULL CHECK (
    dataset IN ('sale_aggregate', 'sale_items', 'return_aggregate', 'return_items')
  ),
  source_sha256 CHAR(64) NOT NULL,
  source_row_index INTEGER NOT NULL,
  legal_guid UUID NOT NULL,
  sale_month DATE NOT NULL,
  quarantine_reason TEXT NOT NULL DEFAULT 'unknown_catalog_guid',
  source_path TEXT NOT NULL DEFAULT '/LC/sale/',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS onec_v3_legal_sales_import_quarantine_plan_idx
  ON onec_v3_legal_sales_import_quarantine_rows (plan_hash);

CREATE INDEX IF NOT EXISTS onec_v3_legal_sales_import_quarantine_month_idx
  ON onec_v3_legal_sales_import_quarantine_rows (sale_month, dataset, source_sha256);

CREATE TABLE IF NOT EXISTS onec_v3_legal_sales_import_month_stats (
  dataset TEXT NOT NULL CHECK (
    dataset IN ('sale_aggregate', 'sale_items', 'return_aggregate', 'return_items')
  ),
  sale_month DATE NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  full_row_count INTEGER NOT NULL,
  matched_row_count INTEGER NOT NULL,
  excluded_row_count INTEGER NOT NULL,
  last_plan_hash CHAR(64),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (dataset, sale_month, source_sha256)
);

CREATE TABLE IF NOT EXISTS onec_v3_legal_sales_bundle_apply_runs (
  plan_hash CHAR(64) PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('planned', 'applied', 'rolled_back', 'commit_uncertain')),
  target_db_fingerprint CHAR(64) NOT NULL,
  catalog_fingerprint CHAR(64) NOT NULL,
  backup_sha256 CHAR(64),
  before_state_sha256 CHAR(64) NOT NULL,
  after_state_sha256 CHAR(64),
  receipt_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ
);

COMMENT ON TABLE onec_v3_legal_sales_import_quarantine_rows IS
  'Quarantine manifest for sales bundle rows excluded by matched-only policy (no PII names in row).';
