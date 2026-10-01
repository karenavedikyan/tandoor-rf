-- R3.1: catalog import profiles (full vs distribution)

ALTER TABLE onec_catalog_import_runs
  ADD COLUMN IF NOT EXISTS import_profile TEXT NOT NULL DEFAULT 'full'
    CHECK (import_profile IN ('full', 'distribution'));

ALTER TABLE onec_catalog_import_runs
  ADD COLUMN IF NOT EXISTS distribution_ready BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE onec_catalog_versions
  ADD COLUMN IF NOT EXISTS import_profile TEXT NOT NULL DEFAULT 'full'
    CHECK (import_profile IN ('full', 'distribution'));

ALTER TABLE onec_catalog_versions
  ADD COLUMN IF NOT EXISTS distribution_ready BOOLEAN NOT NULL DEFAULT FALSE;
