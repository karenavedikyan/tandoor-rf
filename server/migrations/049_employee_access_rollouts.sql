-- Explicit, audited director scope for leaders who are not employees in the 1C export.
-- No fake employee IDs; existing employee-link policy remains the default.
CREATE TABLE IF NOT EXISTS director_base_access_grants (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  granted_by_user_id UUID NOT NULL REFERENCES users(id),
  basis TEXT NOT NULL CHECK (length(trim(basis)) >= 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

-- Stage hashed credentials only. Existing accounts remain untouched until the
-- administrator confirms receipt of the one-time credential download.
CREATE TABLE IF NOT EXISTS employee_access_rollouts (
  id UUID PRIMARY KEY,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  basis TEXT NOT NULL CHECK (length(trim(basis)) >= 10),
  state TEXT NOT NULL CHECK (state IN ('staged','applied','cancelled')),
  entries_json JSONB NOT NULL,
  receipt_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  applied_at TIMESTAMPTZ
);
REVOKE ALL ON director_base_access_grants FROM PUBLIC;
REVOKE ALL ON employee_access_rollouts FROM PUBLIC;
