-- Operator-only, one-shot FTP diagnostics. No HTTP routes expose this table.
-- Does not modify client imports, employee mappings, users or permissions.
CREATE TABLE onec_diagnostic_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL DEFAULT 'client_identity_snapshot'
    CHECK (kind = 'client_identity_snapshot'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'success', 'failed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  report JSONB,
  error_code TEXT,
  CHECK (expires_at > requested_at),
  CHECK (expires_at <= requested_at + INTERVAL '2 hours'),
  CHECK (report IS NULL OR pg_column_size(report) <= 2097152)
);
CREATE INDEX onec_diagnostic_jobs_pending ON onec_diagnostic_jobs(requested_at)
  WHERE status = 'pending';
REVOKE ALL ON onec_diagnostic_jobs FROM PUBLIC;
