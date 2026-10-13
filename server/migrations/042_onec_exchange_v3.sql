-- Exchange v3: holdings, legal entities, retail outlets (clean replacement model).
-- Does not modify migrations 001–041. Legacy client tables remain until explicit clean-start purge.

CREATE TABLE IF NOT EXISTS onec_v3_exchange_state (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_bundle_fingerprint CHAR(64),
  file_sha256 JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_successful_apply_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  apply_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  apply_blocked_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO onec_v3_exchange_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS onec_v3_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'apply')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'rejected', 'failed')),
  bundle_fingerprint CHAR(64) NOT NULL,
  file_sha256 JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_code TEXT,
  error_message TEXT,
  CONSTRAINT onec_v3_import_runs_finished_after_start CHECK (
    finished_at IS NULL OR finished_at >= started_at
  )
);

CREATE INDEX IF NOT EXISTS onec_v3_import_runs_started_at_idx
  ON onec_v3_import_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS onec_v3_holdings (
  guid_holding UUID PRIMARY KEY,
  name_holding TEXT NOT NULL,
  type_category JSONB NOT NULL DEFAULT '{}'::jsonb,
  retail_chain BOOLEAN NOT NULL DEFAULT FALSE,
  holding_group BOOLEAN NOT NULL DEFAULT FALSE,
  managers JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_source_sha256 CHAR(64),
  last_imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onec_v3_legal_entities (
  guid_client UUID PRIMARY KEY,
  name_client TEXT NOT NULL,
  guid_holding UUID,
  name_holding TEXT,
  type_category JSONB NOT NULL DEFAULT '{}'::jsonb,
  managers JSONB NOT NULL DEFAULT '{}'::jsonb,
  address TEXT NOT NULL DEFAULT '',
  telephone JSONB NOT NULL DEFAULT '[]'::jsonb,
  discount TEXT NOT NULL DEFAULT '',
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  markups JSONB NOT NULL DEFAULT '[]'::jsonb,
  other_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  membership_conflict BOOLEAN NOT NULL DEFAULT FALSE,
  diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_source_sha256 CHAR(64),
  last_imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS onec_v3_legal_entities_holding_idx
  ON onec_v3_legal_entities (guid_holding)
  WHERE guid_holding IS NOT NULL;

CREATE TABLE IF NOT EXISTS onec_v3_retail_outlets (
  guid_store UUID PRIMARY KEY,
  guid_holding UUID,
  warehouse BOOLEAN NOT NULL DEFAULT FALSE,
  closed BOOLEAN NOT NULL DEFAULT FALSE,
  type_category JSONB NOT NULL DEFAULT '{}'::jsonb,
  address JSONB NOT NULL DEFAULT '{}'::jsonb,
  information_loading JSONB NOT NULL DEFAULT '{}'::jsonb,
  managers JSONB NOT NULL DEFAULT '{}'::jsonb,
  contact_information JSONB NOT NULL DEFAULT '{}'::jsonb,
  lpr_information JSONB NOT NULL DEFAULT '{}'::jsonb,
  additional_information JSONB NOT NULL DEFAULT '{}'::jsonb,
  membership_conflict BOOLEAN NOT NULL DEFAULT FALSE,
  diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_source_sha256 CHAR(64),
  last_imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS onec_v3_retail_outlets_holding_idx
  ON onec_v3_retail_outlets (guid_holding)
  WHERE guid_holding IS NOT NULL;

CREATE INDEX IF NOT EXISTS onec_v3_retail_outlets_orphan_idx
  ON onec_v3_retail_outlets (guid_store)
  WHERE guid_holding IS NULL;

CREATE TABLE IF NOT EXISTS onec_v3_holding_composition (
  guid_holding UUID NOT NULL REFERENCES onec_v3_holdings (guid_holding) ON DELETE CASCADE,
  member_kind TEXT NOT NULL CHECK (member_kind IN ('legal', 'retail')),
  member_guid UUID NOT NULL,
  name_retail TEXT NOT NULL DEFAULT '',
  ref_missing BOOLEAN NOT NULL DEFAULT FALSE,
  zero_guid BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (guid_holding, member_kind, member_guid)
);

CREATE INDEX IF NOT EXISTS onec_v3_holding_composition_member_idx
  ON onec_v3_holding_composition (member_kind, member_guid);

-- Retired Bitrix label codes (forbid re-issue after v3 clean start).
CREATE TABLE IF NOT EXISTS bitrix24_label_codes_retired (
  label_code VARCHAR(12) PRIMARY KEY,
  retired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT NOT NULL DEFAULT 'exchange_v3_clean_start'
);
