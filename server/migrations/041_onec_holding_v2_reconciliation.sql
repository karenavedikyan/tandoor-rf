-- Holding v2 link layer (internal reconciliation; legacy onec_clients rows unchanged by default apply path).

CREATE TABLE IF NOT EXISTS onec_holding_v2_reconcile_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'no_changes', 'failed')),
  source_sha256 TEXT NOT NULL,
  normalized_state_sha256 TEXT NOT NULL,
  verification_fingerprint TEXT,
  error_code TEXT,
  legal_links_written INTEGER NOT NULL DEFAULT 0,
  outlet_links_written INTEGER NOT NULL DEFAULT 0,
  type_category_written INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT onec_holding_v2_reconcile_runs_finished_after_start CHECK (
    finished_at IS NULL OR finished_at >= started_at
  )
);

CREATE INDEX IF NOT EXISTS onec_holding_v2_reconcile_runs_started_at_idx
  ON onec_holding_v2_reconcile_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS onec_holding_v2_apply_state (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_normalized_state_sha256 TEXT,
  last_source_sha256 TEXT,
  last_applied_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO onec_holding_v2_apply_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- One active membership row per legal entity (guid_client).
CREATE TABLE IF NOT EXISTS onec_holding_v2_legal_links (
  guid_client UUID PRIMARY KEY REFERENCES onec_clients (guid_client) ON DELETE RESTRICT,
  guid_holding_root UUID NOT NULL,
  is_holding_head BOOLEAN NOT NULL DEFAULT FALSE,
  link_active BOOLEAN NOT NULL DEFAULT TRUE,
  first_source_sha256 TEXT,
  last_source_sha256 TEXT,
  first_applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT onec_holding_v2_legal_head_self CHECK (
    NOT is_holding_head OR guid_client = guid_holding_root
  )
);

CREATE INDEX IF NOT EXISTS onec_holding_v2_legal_links_holding_active_idx
  ON onec_holding_v2_legal_links (guid_holding_root)
  WHERE link_active;

-- One active membership row per retail outlet (guid_store).
CREATE TABLE IF NOT EXISTS onec_holding_v2_outlet_links (
  guid_store UUID PRIMARY KEY,
  guid_holding_root UUID NOT NULL,
  is_closed BOOLEAN,
  closure_known BOOLEAN NOT NULL DEFAULT FALSE,
  link_active BOOLEAN NOT NULL DEFAULT TRUE,
  first_source_sha256 TEXT,
  last_source_sha256 TEXT,
  first_applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS onec_holding_v2_outlet_links_holding_active_idx
  ON onec_holding_v2_outlet_links (guid_holding_root)
  WHERE link_active;

CREATE TABLE IF NOT EXISTS onec_holding_v2_client_type_category (
  guid_client UUID PRIMARY KEY REFERENCES onec_clients (guid_client) ON DELETE CASCADE,
  object_present_in_source BOOLEAN NOT NULL DEFAULT FALSE,
  field_presence JSONB NOT NULL DEFAULT '{}'::jsonb,
  guid_type TEXT,
  name_type TEXT,
  guid_category TEXT,
  name_category TEXT,
  last_source_sha256 TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onec_holding_v2_outlet_type_category (
  guid_store UUID PRIMARY KEY,
  object_present_in_source BOOLEAN NOT NULL DEFAULT FALSE,
  field_presence JSONB NOT NULL DEFAULT '{}'::jsonb,
  guid_type TEXT,
  name_type TEXT,
  guid_category TEXT,
  name_category TEXT,
  last_source_sha256 TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
