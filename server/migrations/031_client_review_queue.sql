-- Client assignment review queue (separate from baseline_status and business status).
-- Numbered 031 to avoid collision with 030_outlet_distribution_markers (parallel PR).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS client_review_records (
  guid_client UUID PRIMARY KEY REFERENCES onec_clients (guid_client) ON DELETE CASCADE,
  review_state TEXT NOT NULL CHECK (
    review_state IN (
      'unreviewed',
      'in_progress',
      'awaiting_1c_fix',
      'completed',
      'needs_recheck'
    )
  ),
  review_decision TEXT CHECK (
    review_decision IS NULL OR review_decision IN (
      'confirm_current_manager',
      'propose_transfer',
      'request_clarification',
      'propose_active',
      'propose_dormant',
      'propose_closed',
      'propose_archive'
    )
  ),
  comment TEXT,
  proposed_manager_guid UUID,
  assigned_reviewer_user_id UUID REFERENCES users (id),
  due_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  basis_manager_guid UUID NOT NULL,
  basis_source_sha256 TEXT,
  basis_data_fingerprint TEXT,
  basis_imported_at TIMESTAMPTZ,
  stale_reason TEXT,
  created_by_user_id UUID NOT NULL REFERENCES users (id),
  updated_by_user_id UUID NOT NULL REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_review_records_state
  ON client_review_records (review_state);

CREATE INDEX IF NOT EXISTS idx_client_review_records_decision
  ON client_review_records (review_decision)
  WHERE review_decision IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_review_records_proposed_manager
  ON client_review_records (proposed_manager_guid)
  WHERE proposed_manager_guid IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_review_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guid_client UUID NOT NULL REFERENCES onec_clients (guid_client) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  changed_by_user_id UUID NOT NULL REFERENCES users (id),
  change_type TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_review_history_client
  ON client_review_history (guid_client, created_at DESC);
