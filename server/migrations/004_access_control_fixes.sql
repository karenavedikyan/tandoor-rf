-- R1.3 fixes: active-only uniqueness, explicit denials, delegation change requests, row locking

ALTER TABLE user_onec_employee_links DROP CONSTRAINT IF EXISTS user_onec_employee_links_active_user_uq;

CREATE UNIQUE INDEX IF NOT EXISTS user_onec_employee_links_active_user_uq
  ON user_onec_employee_links (user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS access_denials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('client', 'all_clients')),
  object_id UUID,
  reason TEXT NOT NULL,
  basis TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id UUID REFERENCES users (id),
  revoke_reason TEXT,
  CONSTRAINT access_denials_reason_not_blank CHECK (BTRIM(reason) <> ''),
  CONSTRAINT access_denials_basis_not_blank CHECK (BTRIM(basis) <> ''),
  CONSTRAINT access_denials_object_required CHECK (
    (scope_type = 'client' AND object_id IS NOT NULL)
    OR (scope_type = 'all_clients' AND object_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS access_denials_active_client_uq
  ON access_denials (user_id, scope_type, object_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS access_denials_user_active_idx
  ON access_denials (user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE delegations
  ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE delegations
  ADD COLUMN IF NOT EXISTS business_approver_user_id UUID REFERENCES users (id);

ALTER TABLE access_audit_log
  ADD COLUMN IF NOT EXISTS business_actor_user_id UUID REFERENCES users (id);

CREATE TABLE IF NOT EXISTS delegation_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delegation_id UUID NOT NULL REFERENCES delegations (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (
    status IN ('pending_approval', 'approved', 'rejected', 'superseded')
  ),
  proposed_starts_at TIMESTAMPTZ NOT NULL,
  proposed_ends_at TIMESTAMPTZ NOT NULL,
  requested_by_user_id UUID NOT NULL REFERENCES users (id),
  approved_by_user_id UUID REFERENCES users (id),
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT delegation_change_requests_time_range CHECK (proposed_ends_at > proposed_starts_at)
);

CREATE INDEX IF NOT EXISTS delegation_change_requests_delegation_idx
  ON delegation_change_requests (delegation_id, status);

CREATE TABLE IF NOT EXISTS delegation_change_request_clients (
  change_request_id UUID NOT NULL REFERENCES delegation_change_requests (id) ON DELETE CASCADE,
  guid_client UUID NOT NULL,
  PRIMARY KEY (change_request_id, guid_client)
);
