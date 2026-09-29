-- Operator-only scheduled import jobs. No HTTP routes expose this table.
-- Does not modify users, employee links, grants, or team assignments.
CREATE TABLE onec_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL DEFAULT 'clients_snapshot'
    CHECK (kind = 'clients_snapshot'),
  mode TEXT NOT NULL
    CHECK (mode IN ('dry_run', 'apply')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'success', 'failed')),
  expected_sha256 TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  result JSONB,
  error_code TEXT,
  import_run_id UUID REFERENCES onec_client_import_runs (id),
  CHECK (expires_at > requested_at),
  CHECK (expires_at <= requested_at + INTERVAL '2 hours'),
  CHECK (
    mode = 'dry_run'
    OR (
      expected_sha256 IS NOT NULL
      AND expected_sha256 ~ '^[0-9a-f]{64}$'
    )
  ),
  CHECK (result IS NULL OR pg_column_size(result) <= 2097152)
);

CREATE INDEX onec_import_jobs_pending_idx ON onec_import_jobs (requested_at)
  WHERE status = 'pending';

REVOKE ALL ON onec_import_jobs FROM PUBLIC;
