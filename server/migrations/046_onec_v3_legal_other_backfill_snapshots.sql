CREATE TABLE IF NOT EXISTS onec_v3_legal_other_backfill_snapshots (
  guid_client UUID NOT NULL,
  source_sha256 TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  previous_other_fields JSONB NOT NULL,
  expected_post_other_fields JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guid_client, plan_hash)
);

CREATE INDEX IF NOT EXISTS idx_onec_v3_legal_other_backfill_snapshots_plan_hash
  ON onec_v3_legal_other_backfill_snapshots (plan_hash);
